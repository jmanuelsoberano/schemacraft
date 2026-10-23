//! Read-only PostgreSQL 15–18 catalog inspection, independent of module source storage.

mod assembly;
mod catalog;
mod session;
mod settings;

use crate::diagnostics::{self, CodeCapture, InspectionCompleted};
use async_trait::async_trait;
use chrono::Utc;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::inspectors::{
    DatabaseDescription, DatabaseInspector, InspectionOptions, InspectionProgress, InspectionStage,
    InspectorError, ProgressReporter, ServerInformation,
};
use crate::model::{
    AccessCounts, AccessProfile, CaptureScope, CaptureState, NotReadReason,
    PostgreSqlAccessEvidence, PostgreSqlSchemaAccess, SchemaSnapshot,
};
use session::{Session, field};

pub use settings::{PostgreSqlConnectionSettings, PostgreSqlEncryptionMode, format_target};

/// An operation-scoped PostgreSQL inspector; it keeps no idle server connection.
pub struct PostgreSqlInspector {
    settings: PostgreSqlConnectionSettings,
}

impl PostgreSqlInspector {
    /// Validate settings without connecting or resolving credentials.
    pub fn new(settings: PostgreSqlConnectionSettings) -> Result<Self, InspectorError> {
        settings.validate()?;
        Ok(Self { settings })
    }

    async fn read_snapshot(
        &self,
        options: &InspectionOptions,
        progress: &dyn ProgressReporter,
    ) -> Result<SchemaSnapshot, InspectorError> {
        let started = Instant::now();
        progress.report(InspectionProgress::stage(InspectionStage::Connecting));
        let session = Session::connect(&self.settings).await?;
        let information = server_information(&session, &self.settings).await?;
        let connected = started.elapsed();
        let evidence = access_evidence(&session).await?;
        progress.report(InspectionProgress::stage(InspectionStage::CheckingAccess));
        let mut rows = read_structure(&session, options, progress).await?;
        let code_started = Instant::now();
        read_programmability(&session, &mut rows, options, progress).await;
        let reading_code = code_started.elapsed();
        let (references, dependency_state) = read_dependencies(&session, options, progress).await;
        let read = started.elapsed();
        progress.report(InspectionProgress::stage(InspectionStage::Assembling));
        let dependencies =
            assembly::dependencies(&rows, &references, options, dependency_state, Utc::now());
        let mut snapshot = assembly::assemble(&rows, information, options, evidence);
        snapshot.dependencies = Some(dependencies);
        record_completion(&snapshot, connected, read, reading_code, started.elapsed());
        progress.report(InspectionProgress::counted(
            InspectionStage::Completed,
            snapshot.tables.len(),
        ));
        Ok(snapshot)
    }
}

async fn read_structure(
    session: &Session,
    options: &InspectionOptions,
    progress: &dyn ProgressReporter,
) -> Result<assembly::CatalogRows, InspectorError> {
    let objects = catalog::read(
        session,
        "objects",
        catalog::OBJECTS,
        &options.schemas,
        options.include_views,
    )
    .await?;
    progress.report(InspectionProgress::counted(
        InspectionStage::ReadingObjects,
        objects.len(),
    ));
    let columns = catalog::read(
        session,
        "columns",
        catalog::COLUMNS,
        &options.schemas,
        options.include_views,
    )
    .await?;
    progress.report(InspectionProgress::counted(
        InspectionStage::ReadingColumns,
        columns.len(),
    ));
    let indexes = catalog::read(
        session,
        "indexes",
        catalog::INDEXES,
        &options.schemas,
        options.include_views,
    )
    .await?;
    progress.report(InspectionProgress::counted(
        InspectionStage::ReadingIndexes,
        indexes.len(),
    ));
    let constraints = catalog::read::<catalog::ConstraintRow>(
        session,
        "constraints",
        catalog::CONSTRAINTS,
        &options.schemas,
        options.include_views,
    )
    .await?;
    progress.report(InspectionProgress::counted(
        InspectionStage::ReadingForeignKeys,
        constraints.iter().filter(|row| row.kind == "f").count(),
    ));
    progress.report(InspectionProgress::counted(
        InspectionStage::ReadingConstraints,
        constraints.iter().filter(|row| row.kind == "c").count(),
    ));
    let rows = assembly::CatalogRows {
        objects,
        columns,
        indexes,
        constraints,
        routines: Vec::new(),
        triggers: Vec::new(),
        definitions: Vec::new(),
        objects_state: CaptureState::NotRead {
            reason: NotReadReason::OptionOff,
        },
        definitions_state: CaptureState::NotRead {
            reason: NotReadReason::OptionOff,
        },
    };
    Ok(rows)
}

async fn read_programmability(
    session: &Session,
    rows: &mut assembly::CatalogRows,
    options: &InspectionOptions,
    progress: &dyn ProgressReporter,
) {
    if options.include_programmability {
        match tokio::try_join!(
            catalog::optional::<catalog::RoutineRow>(
                session,
                catalog::ROUTINES,
                &options.schemas,
                options.include_views
            ),
            catalog::optional::<catalog::TriggerRow>(
                session,
                catalog::TRIGGERS,
                &options.schemas,
                options.include_views
            ),
        ) {
            Ok((routines, triggers)) => {
                rows.routines = routines;
                rows.triggers = triggers;
                rows.objects_state = CaptureState::Read;
                progress.report(InspectionProgress::counted(
                    InspectionStage::ReadingProgrammability,
                    rows.routines.len() + rows.triggers.len(),
                ));
            }
            Err(reason) => {
                rows.objects_state = CaptureState::NotRead { reason };
                if options.include_module_definitions {
                    rows.definitions_state = CaptureState::NotRead { reason };
                }
                tracing::warn!(
                    ?reason,
                    "optional PostgreSQL programmability catalog was not read"
                );
                progress.report(InspectionProgress::stage(
                    InspectionStage::ReadingProgrammability,
                ));
            }
        }
        if rows.objects_state == CaptureState::Read && options.include_module_definitions {
            match catalog::optional(
                session,
                catalog::DEFINITIONS,
                &options.schemas,
                options.include_views,
            )
            .await
            {
                Ok(definitions) => {
                    rows.definitions = definitions;
                    rows.definitions_state = CaptureState::Read;
                }
                Err(reason) => {
                    rows.definitions_state = CaptureState::NotRead { reason };
                    tracing::warn!(
                        ?reason,
                        "optional PostgreSQL module definitions were not read"
                    );
                }
            }
        }
    }
    progress.report(if rows.definitions_state == CaptureState::Read {
        InspectionProgress::counted(
            InspectionStage::ReadingModuleDefinitions,
            rows.definitions.len(),
        )
    } else {
        InspectionProgress::stage(InspectionStage::ReadingModuleDefinitions)
    });
}

async fn read_dependencies(
    session: &Session,
    options: &InspectionOptions,
    progress: &dyn ProgressReporter,
) -> (Vec<catalog::DependencyRow>, CaptureState) {
    // Every optional query has its own implicit transaction; one denial cannot poison the
    // structural catalog or the following dependency read.
    if options.include_dependencies {
        progress.report(InspectionProgress::stage(
            InspectionStage::ReadingDependencies,
        ));
        match catalog::optional::<catalog::DependencyRow>(
            session,
            catalog::DEPENDENCIES,
            &options.schemas,
            options.include_views,
        )
        .await
        {
            Ok(references) => (references, CaptureState::Read),
            Err(reason) => {
                tracing::warn!(
                    ?reason,
                    "optional PostgreSQL dependency catalog was not read"
                );
                (Vec::new(), CaptureState::NotRead { reason })
            }
        }
    } else {
        (
            Vec::new(),
            CaptureState::NotRead {
                reason: NotReadReason::OptionOff,
            },
        )
    }
}

fn record_completion(
    snapshot: &SchemaSnapshot,
    connected: std::time::Duration,
    read: std::time::Duration,
    reading_code: std::time::Duration,
    total: std::time::Duration,
) {
    if let Some(family) = &snapshot.dependencies {
        diagnostics::dependencies_captured(
            CodeCapture::from(&family.capture),
            family.sources.len(),
            family.edges.len(),
        );
    }
    let code = snapshot.programmability.as_ref();
    diagnostics::inspection_completed(&InspectionCompleted {
        tables: snapshot.tables.len(),
        views: snapshot.views.len(),
        foreign_keys: snapshot.foreign_keys.len(),
        foreign_keys_to_invisible_tables: 0,
        access: snapshot.access.as_ref().map(|profile| profile.level),
        code: code.map_or(CodeCapture::Unknown, |code| {
            CodeCapture::from(&code.capture.objects)
        }),
        code_texts: code.map_or(CodeCapture::Unknown, |code| {
            CodeCapture::from(&code.capture.definitions)
        }),
        routines: code.map_or(0, |code| code.routines.len()),
        triggers: code.map_or(0, |code| code.triggers.len()),
        view_modules: code.map_or(0, |code| code.views.len()),
        module_texts: code.map_or(0, |code| {
            code.module_definitions()
                .filter(|definition| definition.text().is_some())
                .count()
        }),
        module_texts_not_visible: 0,
        module_texts_encrypted: 0,
        connecting: connected,
        reading: read.saturating_sub(connected),
        reading_code,
        assembling: total.saturating_sub(read),
        total,
    });
}

#[async_trait]
impl DatabaseInspector for PostgreSqlInspector {
    async fn test_connection(&self) -> Result<ServerInformation, InspectorError> {
        let session = Session::connect(&self.settings).await?;
        server_information(&session, &self.settings).await
    }

    async fn list_databases(&self) -> Result<Vec<String>, InspectorError> {
        let session = Session::connect(&self.settings).await?;
        session.query("databases","SELECT datname::text AS name FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate AND pg_catalog.has_database_privilege(oid,'CONNECT') ORDER BY datname",&[]).await?
            .iter().map(|row|field(row,"name","databases")).collect()
    }

    async fn describe_database(&self) -> Result<DatabaseDescription, InspectorError> {
        let session = Session::connect(&self.settings).await?;
        let _ = server_information(&session, &self.settings).await?;
        let evidence = access_evidence(&session).await?;
        let schemas = evidence
            .schemas
            .iter()
            .filter(|schema| schema.has_visible_objects)
            .map(|schema| schema.name.clone())
            .collect();
        let programmability_only_schemas = evidence
            .schemas
            .iter()
            .filter(|schema| schema.has_visible_programmability && !schema.has_visible_objects)
            .map(|schema| schema.name.clone())
            .collect();
        let has_objects = evidence
            .schemas
            .iter()
            .any(|schema| schema.has_visible_objects);
        let access = AccessProfile::from_postgresql(
            evidence,
            CaptureScope::everything_with_code(),
            AccessCounts::default(),
            has_objects,
        );
        Ok(DatabaseDescription {
            schemas,
            programmability_only_schemas,
            access,
        })
    }

    async fn inspect(
        &self,
        options: &InspectionOptions,
        progress: &dyn ProgressReporter,
        cancellation: CancellationToken,
    ) -> Result<SchemaSnapshot, InspectorError> {
        tokio::select! {biased; ()=cancellation.cancelled()=>Err(InspectorError::Cancelled), result=self.read_snapshot(options,progress)=>result}
    }
}

async fn server_information(
    session: &Session,
    settings: &PostgreSqlConnectionSettings,
) -> Result<ServerInformation, InspectorError> {
    let rows=session.query("server_information","SELECT pg_catalog.current_setting('server_version') AS version, pg_catalog.current_setting('server_version_num')::integer AS version_number, pg_catalog.current_database()::text AS database_name",&[]).await?;
    let row = rows
        .first()
        .ok_or_else(|| InspectorError::UnexpectedCatalogData {
            query: "server_information",
            details: "the server returned no identity row".into(),
        })?;
    let version_number: i32 = field(row, "version_number", "server_information")?;
    if !(150_000..190_000).contains(&version_number) {
        return Err(InspectorError::InvalidSettings {
            reason: "this release supports PostgreSQL server versions 15 through 18".into(),
        });
    }
    let version: String = field(row, "version", "server_information")?;
    Ok(ServerInformation {
        product: format!("PostgreSQL {version}"),
        product_version: version,
        edition: "PostgreSQL".into(),
        server_name: settings.host.clone(),
        database_name: field(row, "database_name", "server_information")?,
    })
}

async fn access_evidence(session: &Session) -> Result<PostgreSqlAccessEvidence, InspectorError> {
    let rows=session.query("access",r"
SELECT n.nspname::text AS name,pg_catalog.has_schema_privilege(n.oid,'USAGE') AS has_usage,
 EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m')) AS has_objects
FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY n.nspname
",&[]).await?;
    let mut schemas = rows
        .iter()
        .map(|row| {
            Ok(PostgreSqlSchemaAccess {
                name: field(row, "name", "access")?,
                has_usage: field(row, "has_usage", "access")?,
                has_visible_objects: field(row, "has_objects", "access")?,
                has_visible_programmability: false,
            })
        })
        .collect::<Result<Vec<_>, InspectorError>>()?;
    // Program catalog permissions are optional even during the probe; a pg_proc denial
    // must not prevent a table-only capture or fabricate an empty procedure list.
    let code=session.query("access_programmability","SELECT DISTINCT n.nspname::text AS name FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",&[]).await;
    let programmability_catalog_read = code.is_ok();
    if let Ok(code) = code {
        for row in code {
            let name: String = field(&row, "name", "access_programmability")?;
            if let Some(schema) = schemas.iter_mut().find(|schema| schema.name == name) {
                schema.has_visible_programmability = true;
            }
        }
    }
    Ok(PostgreSqlAccessEvidence {
        object_catalog_read: true,
        programmability_catalog_read,
        definitions: CaptureState::Unknown,
        schemas,
    })
}
