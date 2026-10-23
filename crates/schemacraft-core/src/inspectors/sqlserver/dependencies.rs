//! Optional, scoped catalog-reference capture. No module source or remote target is read.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use tiberius::{Row, ToSql};

use super::catalog::{CatalogSession, optional_text, required, required_text};
use super::pool::SqlServerConnection;
use crate::inspectors::{InspectionOptions, InspectorError};
use crate::model::{
    CaptureScope, CaptureState, Completeness, DependencyEdge, DependencyKind, DependencyLimitation,
    DependencyObjectRef, DependencyReferenceStatus, DependencySnapshot, DependencySource,
    DependencyTarget, NotReadReason, QualifiedName, SchemaSnapshot, UnknownFields,
};

const QUERY_NAME: &str = "dependencies";
const MAX_BOUND_SCHEMAS: usize = 2000;
const READ_TIMEOUT: Duration = Duration::from_secs(60);

// The source predicate is bound before execution, and excludes modules when their family is off.
// Unsupported referenced classes are retained as identifier metadata rather than silently lost.
const REFERENCES: &str = "SELECT DISTINCT
 s.name AS source_schema,
 CASE WHEN o.type IN ('C','D') THEN p.name ELSE o.name END AS source_name,
 CASE WHEN o.type IN ('C','D') THEN p.type ELSE o.type END AS source_type,
 ps.name AS parent_schema, p.name AS parent_name,
 d.referenced_server_name AS target_server, d.referenced_database_name AS target_database,
 COALESCE(rs.name, d.referenced_schema_name) AS target_schema,
 COALESCE(r.name, d.referenced_entity_name) AS target_name, r.type AS target_type,
 rps.name AS target_parent_schema, rp.name AS target_parent_name,
 d.referenced_class_desc AS target_class, d.is_schema_bound_reference,
 d.is_caller_dependent, d.is_ambiguous,
 CAST(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') AS int) AS can_read_catalog
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.objects AS p ON p.object_id = o.parent_object_id
LEFT JOIN sys.schemas AS ps ON ps.schema_id = p.schema_id
LEFT JOIN sys.objects AS r ON d.referenced_class = 1 AND r.object_id = d.referenced_id
LEFT JOIN sys.schemas AS rs ON rs.schema_id = r.schema_id
LEFT JOIN sys.objects AS rp ON rp.object_id = r.parent_object_id
LEFT JOIN sys.schemas AS rps ON rps.schema_id = rp.schema_id
WHERE o.is_ms_shipped = 0 AND (
 o.type = 'U' OR (o.type IN ('C','D') AND p.type = 'U') OR (o.type = 'V' AND @P1 = 1) OR
 (@P2 = 1 AND o.type IN ('P','PC','FN','FS','IF','TF','FT','AF')) OR
 (@P2 = 1 AND o.type IN ('TR','TA') AND (p.type = 'U' OR (p.type = 'V' AND @P1 = 1))))
 /* schema filter */;";

/// Raw successful read, or an independent optional-stage failure.
pub(super) struct DependencyRead {
    result: Result<(Vec<ReferenceRow>, bool), NotReadReason>,
}

/// Reads on a dedicated pool lease. A failed or cancelled stream is retired, never reused.
pub(super) async fn fetch_dependencies(
    session: &CatalogSession<'_>,
    options: &InspectionOptions,
) -> DependencyRead {
    if !options.include_dependencies {
        return DependencyRead {
            result: Err(NotReadReason::OptionOff),
        };
    }
    let result = match session.pool.get().await {
        Ok(mut connection) => {
            let result =
                tokio::time::timeout(READ_TIMEOUT, read_references(&mut connection, options)).await;
            match result {
                Ok(Ok(rows)) => Ok(rows),
                Ok(Err(reason)) => {
                    connection.discard();
                    Err(reason)
                }
                Err(_) => {
                    connection.discard();
                    Err(NotReadReason::TimedOut)
                }
            }
        }
        Err(_) => Err(NotReadReason::QueryFailed),
    };
    DependencyRead { result }
}

async fn read_references(
    connection: &mut SqlServerConnection,
    options: &InspectionOptions,
) -> Result<(Vec<ReferenceRow>, bool), NotReadReason> {
    // The view also requires SELECT. A query denial is isolated by fetch_dependencies.
    let permission_rows = connection.simple_query(
        "SELECT CAST(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') AS int) AS permitted;"
    ).await.map_err(|error| driver_reason(&error))?.into_first_result().await.map_err(|error| driver_reason(&error))?;
    let permitted = permission_rows
        .first()
        .is_some_and(|row| row.get::<i32, _>("permitted") == Some(1));
    if !permitted {
        return Err(NotReadReason::PermissionDenied);
    }
    let selected: Vec<String> = options
        .schemas
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let scopes = if selected.is_empty() {
        vec![&[][..]]
    } else {
        selected.chunks(MAX_BOUND_SCHEMAS).collect()
    };
    let mut result = Vec::new();
    for schemas in scopes {
        let filter = if schemas.is_empty() {
            String::new()
        } else {
            format!(
                "AND s.name IN ({})",
                tiberius::Query::placeholders(3, schemas.len())
            )
        };
        let sql = REFERENCES.replace("/* schema filter */", &filter);
        let mut parameters: Vec<&dyn ToSql> =
            vec![&options.include_views, &options.include_programmability];
        parameters.extend(schemas.iter().map(|schema| schema as &dyn ToSql));
        let rows = connection
            .query(sql, &parameters)
            .await
            .map_err(|error| driver_reason(&error))?
            .into_first_result()
            .await
            .map_err(|error| driver_reason(&error))?;
        for row in &rows {
            result.push(ReferenceRow::read(row).map_err(|_| NotReadReason::QueryFailed)?);
        }
    }
    Ok((result, permitted))
}

fn driver_reason(error: &tiberius::error::Error) -> NotReadReason {
    match error {
        tiberius::error::Error::Server(token) if matches!(token.code(), 229 | 230 | 297 | 300) => {
            NotReadReason::PermissionDenied
        }
        tiberius::error::Error::Server(token) if token.code() == 1222 => NotReadReason::TimedOut,
        tiberius::error::Error::Io {
            kind: std::io::ErrorKind::TimedOut,
            ..
        } => NotReadReason::TimedOut,
        _ => NotReadReason::QueryFailed,
    }
}

fn unexpected() -> InspectorError {
    InspectorError::UnexpectedCatalogData {
        query: QUERY_NAME,
        details: "dependency catalog could not be read".to_owned(),
    }
}

struct ReferenceRow {
    source: DependencyObjectRef,
    target: DependencyTarget,
    schema_bound: bool,
}

impl ReferenceRow {
    fn read(row: &Row) -> Result<Self, InspectorError> {
        let source_schema = required_text(row, "source_schema", QUERY_NAME)?;
        let source_name = required_text(row, "source_name", QUERY_NAME)?;
        let source_type = required_text(row, "source_type", QUERY_NAME)?;
        let source = object_ref(
            &source_type,
            source_schema,
            source_name,
            optional_text(row, "parent_schema", QUERY_NAME)?,
            optional_text(row, "parent_name", QUERY_NAME)?,
        )
        .ok_or_else(unexpected)?;
        let server = optional_text(row, "target_server", QUERY_NAME)?;
        let database = optional_text(row, "target_database", QUERY_NAME)?;
        let schema = optional_text(row, "target_schema", QUERY_NAME)?;
        let name = optional_text(row, "target_name", QUERY_NAME)?;
        let class = required_text(row, "target_class", QUERY_NAME)?;
        let target_type = optional_text(row, "target_type", QUERY_NAME)?;
        let caller: bool = required(row, "is_caller_dependent", QUERY_NAME)?;
        let ambiguous: bool = required(row, "is_ambiguous", QUERY_NAME)?;
        let status = if server.is_some() || database.is_some() {
            Some(DependencyReferenceStatus::External)
        } else if ambiguous {
            Some(DependencyReferenceStatus::Ambiguous)
        } else if caller {
            Some(DependencyReferenceStatus::CallerDependent)
        } else if class != "OBJECT_OR_COLUMN" {
            Some(DependencyReferenceStatus::Unsupported)
        } else {
            None
        };
        let resolved = match (&target_type, &schema, &name) {
            (Some(kind), Some(schema), Some(name)) => object_ref(
                kind,
                schema.clone(),
                name.clone(),
                optional_text(row, "target_parent_schema", QUERY_NAME)?,
                optional_text(row, "target_parent_name", QUERY_NAME)?,
            ),
            _ => None,
        };
        let target = match (status, resolved) {
            (None, Some(object)) => DependencyTarget::Object { object },
            (status, _) => DependencyTarget::Reference {
                status: status.unwrap_or(if target_type.is_some() {
                    DependencyReferenceStatus::Unsupported
                } else {
                    DependencyReferenceStatus::Unresolved
                }),
                server,
                database,
                schema,
                name,
                object_class: Some(class),
            },
        };
        Ok(Self {
            source,
            target,
            schema_bound: required(row, "is_schema_bound_reference", QUERY_NAME)?,
        })
    }
}

fn object_ref(
    kind: &str,
    schema: String,
    name: String,
    parent_schema: Option<String>,
    parent_name: Option<String>,
) -> Option<DependencyObjectRef> {
    let qualified = QualifiedName::new(schema, &name);
    match kind.trim() {
        "U" => Some(DependencyObjectRef::Table { name: qualified }),
        "V" => Some(DependencyObjectRef::View { name: qualified }),
        "P" | "PC" | "FN" | "FS" | "IF" | "TF" | "FT" | "AF" => {
            Some(DependencyObjectRef::Routine {
                name: qualified,
                identity_arguments: None,
            })
        }
        "TR" | "TA" => Some(DependencyObjectRef::Trigger {
            parent: QualifiedName::new(parent_schema?, parent_name?),
            name,
        }),
        _ => None,
    }
}

impl DependencyRead {
    /// Number of raw catalog references read, or no count after an optional failure.
    pub(super) fn row_count(&self) -> Option<usize> {
        self.result.as_ref().ok().map(|(rows, _)| rows.len())
    }

    /// Resolves endpoints only against selected objects actually captured by the inspector.
    pub(super) fn assemble(
        self,
        snapshot: &SchemaSnapshot,
        options: &InspectionOptions,
    ) -> DependencySnapshot {
        let observed_at = snapshot.extracted_at;
        let scope = CaptureScope {
            include_programmability: options.include_programmability,
            include_module_definitions: false,
            ..CaptureScope::from(options)
        };
        let mut family = DependencySnapshot {
            capture: CaptureState::Read,
            scope,
            observed_at,
            sources: Vec::new(),
            edges: Vec::new(),
            limitations: vec![DependencyLimitation::RuntimeReferencesNotTracked],
            unknown: UnknownFields::new(),
        };
        let (rows, permitted) = match self.result {
            Ok(result) => result,
            Err(reason) => {
                family.capture = CaptureState::NotRead { reason };
                return family;
            }
        };
        if !permitted {
            family
                .limitations
                .push(DependencyLimitation::PermissionLimited);
        }
        let sources = captured_objects(snapshot);
        family.sources = sources
            .iter()
            .cloned()
            .map(|object| DependencySource {
                object,
                routine_body_tracking: None,
                coverage: if permitted {
                    Completeness::Complete
                } else {
                    Completeness::Partial
                },
                read_at: observed_at,
                retained: false,
            })
            .collect();
        let mut edges = BTreeMap::new();
        for row in rows {
            if !sources.contains(&row.source) {
                continue;
            }
            let target = resolve_target(row.target, &sources, options);
            record_target_limitations(&target, &mut family.limitations);
            let edge = DependencyEdge {
                source: row.source,
                target,
                kind: DependencyKind::CatalogReference,
                is_schema_bound: Some(row.schema_bound),
                read_at: observed_at,
                retained: false,
            };
            edges
                .entry(serde_json::to_string(&edge).unwrap_or_default())
                .or_insert(edge);
        }
        family.edges = edges.into_values().collect();
        family
    }
}

fn resolve_target(
    target: DependencyTarget,
    sources: &BTreeSet<DependencyObjectRef>,
    options: &InspectionOptions,
) -> DependencyTarget {
    let DependencyTarget::Object { object } = target else {
        return target;
    };
    if sources.contains(&object) {
        return DependencyTarget::Object { object };
    }
    let (schema, name) = match &object {
        DependencyObjectRef::Table { name }
        | DependencyObjectRef::View { name }
        | DependencyObjectRef::Routine { name, .. } => {
            (Some(name.schema.clone()), Some(name.name.clone()))
        }
        DependencyObjectRef::Trigger { parent, name } => {
            (Some(parent.schema.clone()), Some(name.clone()))
        }
    };
    let excluded = !options.includes_schema(object.schema())
        || match &object {
            DependencyObjectRef::View { .. } => !options.include_views,
            DependencyObjectRef::Routine { .. } | DependencyObjectRef::Trigger { .. } => {
                !options.include_programmability
            }
            DependencyObjectRef::Table { .. } => false,
        };
    DependencyTarget::Reference {
        status: if excluded {
            DependencyReferenceStatus::OutOfScope
        } else {
            DependencyReferenceStatus::NotVisible
        },
        server: None,
        database: None,
        schema,
        name,
        object_class: None,
    }
}

fn record_target_limitations(
    target: &DependencyTarget,
    limitations: &mut Vec<DependencyLimitation>,
) {
    let limitation = match target {
        DependencyTarget::Reference {
            status: DependencyReferenceStatus::Unsupported,
            ..
        } => DependencyLimitation::UnsupportedTargets,
        DependencyTarget::Reference { .. } => DependencyLimitation::UnresolvedTargets,
        DependencyTarget::Object { .. } => return,
    };
    if !limitations.contains(&limitation) {
        limitations.push(limitation);
    }
}

fn captured_objects(snapshot: &SchemaSnapshot) -> BTreeSet<DependencyObjectRef> {
    snapshot
        .tables
        .iter()
        .map(|table| DependencyObjectRef::Table {
            name: table.name.clone(),
        })
        .chain(snapshot.views.iter().map(|view| DependencyObjectRef::View {
            name: view.name.clone(),
        }))
        .chain(
            snapshot
                .programmability
                .iter()
                .flat_map(|code| code.routines.iter())
                .map(|routine| DependencyObjectRef::Routine {
                    name: routine.name.clone(),
                    identity_arguments: routine.identity_arguments.clone(),
                }),
        )
        .chain(
            snapshot
                .programmability
                .iter()
                .flat_map(|code| code.triggers.iter())
                .map(|trigger| DependencyObjectRef::Trigger {
                    parent: trigger.parent.clone(),
                    name: trigger.name.clone(),
                }),
        )
        .collect()
}
