//! The code stage of an inspection: procedures, functions, DML triggers and the code of views.
//!
//! It runs next to the table catalog on the same pool and can never fail the inspection: a query
//! that fails or runs out of time leaves its family of facts not read, the error is logged by its
//! kind, number and query name, and the tables are read and saved as without code
//! ([`CodeRead`]). The metadata comes first, in five set-based queries; the texts come after it,
//! in one query whose rows are streamed and dropped one by one, and only when the options ask for
//! them. Every query is scoped on the server: the schema filter is bound as parameters, and with
//! views left out neither their code nor their triggers is read.
//!
//! Only catalog columns that SQL Server 2005 and 2012 already had are read; whether a module is
//! encrypted comes from `OBJECTPROPERTY`, which answers `NULL` rather than failing:
//! https://learn.microsoft.com/en-us/sql/t-sql/functions/objectproperty-transact-sql

use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

use futures_util::TryStreamExt;
use tiberius::{Row, ToSql};

use super::catalog::{
    CatalogSession, ColumnRow, column_row, optional, optional_text, required, required_text,
};
use super::pool::{SqlServerConnection, checkout_error};
use crate::diagnostics::{self, CodeFamily, ErrorSummary};
use crate::inspectors::{
    InspectionOptions, InspectionProgress, InspectionStage, InspectorError, InspectorErrorKind,
    ProgressReporter,
};
use crate::model::NotReadReason;

/// The SQL Server error number of a lock request that ran out of time (`SET LOCK_TIMEOUT`).
const LOCK_TIMEOUT: u32 = 1222;

/// Where the schema filter goes in a query, replaced by `AND s.name IN (@P2, …)` or by nothing.
const SCHEMA_FILTER: &str = "/* schema filter */";

/// Schemas bound per request, below SQL Server's 2100-parameter limit. Larger selections
/// are split into scoped requests; no request ever widens the selected schemas.
const MAX_BOUND_SCHEMAS: usize = 2000;

/// A query of the code stage. `@P1` is whether views are read, and the schemas of the filter
/// follow it.
pub(super) struct CodeQuery {
    /// Short identifier for errors and the log.
    pub name: &'static str,
    /// T-SQL text, with [`SCHEMA_FILTER`] where the schema filter goes.
    pub sql: &'static str,
}

/// Views, procedures and functions, with what the catalog says of each without its text: whether
/// a view is created `WITH CHECK OPTION` and whether a module is encrypted. `IsEncrypted` is `1`
/// only for a module created `WITH ENCRYPTION`, whose text is `NULL` for every login, the owner
/// included, and it is known to a login that sees the object without `VIEW DEFINITION`:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-sql-modules-transact-sql
const CODE_OBJECTS: CodeQuery = CodeQuery {
    name: "code objects",
    sql: "SELECT o.object_id, s.name AS schema_name, o.name AS object_name, o.type AS object_type,
       CAST(ISNULL(v.with_check_option, 0) AS bit) AS has_check_option,
       OBJECTPROPERTY(o.object_id, 'IsEncrypted') AS is_encrypted
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.views AS v ON v.object_id = o.object_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF')
  AND (o.type <> 'V' OR @P1 = 1)
  /* schema filter */
ORDER BY s.name, o.name;",
};

/// DML triggers of tables, and of views when views are read: `TR` in T-SQL, `TA` in CLR. Their
/// metadata follows the permissions on the table, so a login that sees a table sees every trigger
/// of it, while the text may still be hidden:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-triggers-transact-sql
const TRIGGERS: CodeQuery = CodeQuery {
    name: "triggers",
    sql: "SELECT t.object_id, t.parent_id, t.name AS trigger_name, t.type AS trigger_type,
       t.is_disabled, t.is_not_for_replication, t.is_instead_of_trigger,
       OBJECTPROPERTY(t.object_id, 'IsEncrypted') AS is_encrypted
FROM sys.triggers AS t
JOIN sys.objects AS p ON p.object_id = t.parent_id
JOIN sys.schemas AS s ON s.schema_id = p.schema_id
WHERE t.parent_class = 1 AND t.is_ms_shipped = 0 AND t.type IN ('TR', 'TA')
  AND p.is_ms_shipped = 0 AND (p.type = 'U' OR (p.type = 'V' AND @P1 = 1))
  /* schema filter */
ORDER BY t.parent_id, t.name;",
};

/// The statements each of those triggers fires on, with the first and last order
/// `sp_settriggerorder` sets per statement:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-trigger-events-transact-sql
const TRIGGER_EVENTS: CodeQuery = CodeQuery {
    name: "trigger events",
    sql: "SELECT te.object_id, te.type_desc AS event_type, te.is_first, te.is_last
FROM sys.trigger_events AS te
JOIN sys.triggers AS t ON t.object_id = te.object_id
JOIN sys.objects AS p ON p.object_id = t.parent_id
JOIN sys.schemas AS s ON s.schema_id = p.schema_id
WHERE t.parent_class = 1 AND t.is_ms_shipped = 0 AND t.type IN ('TR', 'TA')
  AND p.is_ms_shipped = 0 AND (p.type = 'U' OR (p.type = 'V' AND @P1 = 1))
  /* schema filter */
ORDER BY te.object_id, te.type;",
};

/// Parameters of the procedures and functions; `parameter_id` 0 is what a scalar function
/// returns. A T-SQL parameter's default lives only in the module text, so none is read. The type
/// of a parameter may be a user-defined type the login cannot see, so it is joined optionally,
/// and a table type is told by its system type, 243:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-parameters-transact-sql
const PARAMETERS: CodeQuery = CodeQuery {
    name: "parameters",
    sql: "SELECT pr.object_id, pr.parameter_id, pr.name AS parameter_name,
       COALESCE(base_type.name, declared_type.name,
                CASE WHEN pr.system_type_id = 243 THEN N'table' END,
                TYPE_NAME(pr.system_type_id)) AS system_type_name,
       CASE WHEN declared_type.is_user_defined = 1
            THEN SCHEMA_NAME(declared_type.schema_id) + '.' + declared_type.name END AS user_type_name,
       CAST(COALESCE(declared_type.is_table_type,
                     CASE WHEN pr.system_type_id = 243 THEN 1 ELSE 0 END) AS bit) AS is_table_type,
       pr.max_length, pr.precision, pr.scale, pr.is_output, pr.is_readonly
FROM sys.parameters AS pr
JOIN sys.objects AS o ON o.object_id = pr.object_id
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.types AS declared_type ON declared_type.user_type_id = pr.user_type_id
LEFT JOIN sys.types AS base_type ON base_type.user_type_id = declared_type.system_type_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'AF')
  /* schema filter */
ORDER BY pr.object_id, pr.parameter_id;",
};

/// The structure of the table each table function returns. Defaults on a multi-statement
/// function's internal return variable are implementation details kept only in its module text.
/// The empty default fields preserve the shared column-row contract without reading those texts:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-columns-transact-sql
const CODE_COLUMNS: CodeQuery = CodeQuery {
    name: "code columns",
    sql: "SELECT c.object_id, c.column_id, c.name AS column_name,
       COALESCE(base_type.name, declared_type.name) AS system_type_name,
       CASE WHEN declared_type.is_user_defined = 1
            THEN SCHEMA_NAME(declared_type.schema_id) + '.' + declared_type.name END AS user_type_name,
       c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
       CAST(0 AS bit) AS has_default,
       CAST(NULL AS nvarchar(max)) AS default_definition,
       CAST(NULL AS nvarchar(max)) AS bound_default_definition
FROM sys.columns AS c
JOIN sys.objects AS o ON o.object_id = c.object_id AND o.type IN ('IF', 'TF', 'FT') AND o.is_ms_shipped = 0
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.types AS declared_type ON declared_type.user_type_id = c.user_type_id
LEFT JOIN sys.types AS base_type ON base_type.user_type_id = declared_type.system_type_id
WHERE o.object_id IS NOT NULL
  /* schema filter */
ORDER BY c.object_id, c.column_id;",
};

/// The texts of the T-SQL modules of views, procedures, functions and DML triggers. A row with a
/// `NULL` text is an encrypted module or one the login may see but not read; a module with no row
/// at all has no visible text. Database (DDL) triggers are not in `sys.objects`, so they are left out:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-sql-modules-transact-sql
const MODULE_DEFINITIONS: CodeQuery = CodeQuery {
    name: "module definitions",
    sql: "SELECT m.object_id, m.definition
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.objects AS parent ON parent.object_id = o.parent_object_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR')
  AND (o.type <> 'V' OR @P1 = 1)
  AND (o.type <> 'TR' OR parent.type = 'U' OR (parent.type = 'V' AND @P1 = 1))
  /* schema filter */
ORDER BY m.object_id;",
};

/// One row of `sys.objects` for a view, procedure or function.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CodeObjectRow {
    pub object_id: i32,
    pub schema_name: String,
    pub object_name: String,
    /// The type code without its padding, such as `P`, `FN` or `V`.
    pub object_type: String,
    /// Whether a view is created `WITH CHECK OPTION`; `false` for the others.
    pub has_check_option: bool,
    /// `OBJECTPROPERTY(…, 'IsEncrypted')`: `1` encrypted, `0` not, `None` when it did not say.
    pub is_encrypted: Option<i32>,
}

/// One row of `sys.triggers` for a DML trigger.
// The flags mirror independent catalog columns; none of them implies another.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TriggerRow {
    pub object_id: i32,
    /// The table or view the trigger belongs to.
    pub parent_id: i32,
    pub trigger_name: String,
    /// `TR` in T-SQL, `TA` in CLR.
    pub trigger_type: String,
    pub is_disabled: bool,
    pub is_not_for_replication: bool,
    pub is_instead_of_trigger: bool,
    /// As [`CodeObjectRow::is_encrypted`].
    pub is_encrypted: Option<i32>,
}

/// One row of `sys.trigger_events`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TriggerEventRow {
    pub object_id: i32,
    /// Catalog statement name: `INSERT`, `UPDATE` or `DELETE`.
    pub event_type: String,
    pub is_first: bool,
    pub is_last: bool,
}

/// One row of `sys.parameters`.
// The flags mirror independent catalog columns; none of them implies another.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParameterRow {
    pub object_id: i32,
    /// Position in the declaration; `0` is the return value of a scalar function.
    pub parameter_id: i32,
    /// Name with its `@`; empty for the return value.
    pub parameter_name: String,
    /// Underlying system type, `table` for a table type; `None` when the login cannot see it.
    pub system_type_name: Option<String>,
    pub user_type_name: Option<String>,
    pub is_table_type: bool,
    pub max_length: i16,
    pub precision: u8,
    pub scale: u8,
    pub is_output: bool,
    pub is_readonly: bool,
}

/// What the metadata queries of the code stage return.
#[derive(Debug, Default, Clone)]
pub(super) struct CodeRows {
    pub objects: Vec<CodeObjectRow>,
    pub triggers: Vec<TriggerRow>,
    pub trigger_events: Vec<TriggerEventRow>,
    pub parameters: Vec<ParameterRow>,
    pub columns: Vec<ColumnRow>,
}

impl CodeRows {
    /// Procedures, functions and triggers, what the stage reports as its count.
    fn routines_and_triggers(&self) -> usize {
        self.objects
            .iter()
            .filter(|object| object.object_type != "V")
            .count()
            + self.triggers.len()
    }
}

/// The texts the module query returned, by object: `Some` text, or `None` for a module the login
/// sees without its text.
pub(super) type ModuleTexts = BTreeMap<i32, Option<String>>;

/// What a family of code facts came to.
#[derive(Debug, Clone)]
pub(super) enum CodePart<T> {
    /// It was read.
    Read(T),
    /// It was not read, for this reason.
    NotRead(NotReadReason),
}

/// Everything the code stage read, and what it could not.
#[derive(Debug, Clone)]
pub(super) struct CodeRead {
    /// Procedures, functions, triggers, their parameters and events, and the facts of views.
    pub objects: CodePart<CodeRows>,
    /// The texts of the modules.
    pub definitions: CodePart<ModuleTexts>,
    /// Time the stage took, texts included.
    pub elapsed: Duration,
}

impl CodeRead {
    /// Nothing read, because the options leave code out.
    pub(super) fn option_off() -> Self {
        Self {
            objects: CodePart::NotRead(NotReadReason::OptionOff),
            definitions: CodePart::NotRead(NotReadReason::OptionOff),
            elapsed: Duration::ZERO,
        }
    }
}

/// One bounded request within the selected schema scope. Empty means the user chose all schemas.
struct CodeScope {
    include_views: bool,
    schemas: Vec<String>,
}

impl CodeScope {
    fn chunks(options: &InspectionOptions) -> Vec<Self> {
        let schemas: Vec<String> = options
            .schemas
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if schemas.is_empty() {
            return vec![Self {
                include_views: options.include_views,
                schemas,
            }];
        }
        schemas
            .chunks(MAX_BOUND_SCHEMAS)
            .map(|chunk| Self {
                include_views: options.include_views,
                schemas: chunk.to_vec(),
            })
            .collect()
    }

    fn sql(&self, query: &CodeQuery) -> String {
        let filter = if self.schemas.is_empty() {
            String::new()
        } else {
            format!(
                "AND s.name IN ({})",
                tiberius::Query::placeholders(2, self.schemas.len())
            )
        };
        query.sql.replace(SCHEMA_FILTER, &filter)
    }

    fn parameters(&self) -> Vec<&dyn ToSql> {
        let mut parameters: Vec<&dyn ToSql> = Vec::with_capacity(self.schemas.len() + 1);
        parameters.push(&self.include_views);
        parameters.extend(self.schemas.iter().map(|schema| schema as &dyn ToSql));
        parameters
    }
}

/// Only the failure classification crosses this boundary. Query messages can contain SQL and
/// names, so neither progress nor diagnostics receives them.
struct CodeFailure {
    reason: NotReadReason,
    summary: ErrorSummary<InspectorErrorKind>,
}

impl CodeFailure {
    fn driver(query: &'static str, error: &tiberius::error::Error) -> Self {
        let error_number = match error {
            tiberius::error::Error::Server(token) => Some(token.code()),
            _ => None,
        };
        let timed_out = matches!(
            error,
            tiberius::error::Error::Io {
                kind: std::io::ErrorKind::TimedOut,
                ..
            }
        ) || error_number == Some(LOCK_TIMEOUT);
        Self {
            reason: if timed_out {
                NotReadReason::TimedOut
            } else {
                NotReadReason::QueryFailed
            },
            summary: ErrorSummary {
                kind: if timed_out {
                    InspectorErrorKind::Timeout
                } else {
                    InspectorErrorKind::QueryFailed
                },
                error_number,
                query: Some(query),
            },
        }
    }

    fn inspection(error: &InspectorError) -> Self {
        Self {
            reason: if matches!(error, InspectorError::Timeout { .. }) {
                NotReadReason::TimedOut
            } else {
                NotReadReason::QueryFailed
            },
            summary: error.log_summary(),
        }
    }

    fn record(&self, family: CodeFamily) -> NotReadReason {
        diagnostics::code_not_read(family, &self.summary);
        self.reason
    }
}

/// Reads code on one lease of the existing pool. A failed code read retires that session before
/// releasing its lease, so an outstanding table query cannot inherit a broken response stream.
pub(super) async fn fetch_code_stage(
    session: &CatalogSession<'_>,
    progress: &dyn ProgressReporter,
    options: &InspectionOptions,
) -> CodeRead {
    if !options.include_programmability {
        return CodeRead::option_off();
    }
    let started = Instant::now();
    let scopes = CodeScope::chunks(options);
    let (objects, definitions) = match session.pool.get().await {
        Ok(mut connection) => {
            let result = read_code(&mut connection, &scopes, progress, options).await;
            if failed(&result.0) || failed(&result.1) {
                connection.discard();
            }
            result
        }
        Err(error) => {
            let failure = CodeFailure::inspection(&checkout_error(
                error,
                session.target,
                session.connect_timeout,
            ));
            report_failed(progress, options);
            let reason = failure.record(CodeFamily::Objects);
            (
                CodePart::NotRead(reason),
                CodePart::NotRead(if options.reads_module_definitions() {
                    reason
                } else {
                    NotReadReason::OptionOff
                }),
            )
        }
    };
    CodeRead {
        objects,
        definitions,
        elapsed: started.elapsed(),
    }
}

fn failed<T>(part: &CodePart<T>) -> bool {
    matches!(
        part,
        CodePart::NotRead(NotReadReason::QueryFailed | NotReadReason::TimedOut)
    )
}

fn report_failed(progress: &dyn ProgressReporter, options: &InspectionOptions) {
    progress.report(InspectionProgress::stage(
        InspectionStage::ReadingProgrammability,
    ));
    if options.reads_module_definitions() {
        progress.report(InspectionProgress::stage(
            InspectionStage::ReadingModuleDefinitions,
        ));
    }
}

async fn read_code(
    connection: &mut SqlServerConnection,
    scopes: &[CodeScope],
    progress: &dyn ProgressReporter,
    options: &InspectionOptions,
) -> (CodePart<CodeRows>, CodePart<ModuleTexts>) {
    let objects = match fetch_code_rows(connection, scopes).await {
        Ok(rows) => {
            progress.report(InspectionProgress::counted(
                InspectionStage::ReadingProgrammability,
                rows.routines_and_triggers(),
            ));
            rows
        }
        Err(failure) => {
            report_failed(progress, options);
            let reason = failure.record(CodeFamily::Objects);
            return (
                CodePart::NotRead(reason),
                CodePart::NotRead(if options.reads_module_definitions() {
                    reason
                } else {
                    NotReadReason::OptionOff
                }),
            );
        }
    };
    if !options.reads_module_definitions() {
        return (
            CodePart::Read(objects),
            CodePart::NotRead(NotReadReason::OptionOff),
        );
    }
    let definitions = match fetch_module_texts(connection, scopes).await {
        Ok(texts) => {
            progress.report(InspectionProgress::counted(
                InspectionStage::ReadingModuleDefinitions,
                texts.values().filter(|text| text.is_some()).count(),
            ));
            CodePart::Read(texts)
        }
        Err(failure) => {
            progress.report(InspectionProgress::stage(
                InspectionStage::ReadingModuleDefinitions,
            ));
            CodePart::NotRead(failure.record(CodeFamily::Definitions))
        }
    };
    (CodePart::Read(objects), definitions)
}

async fn fetch_code_rows(
    connection: &mut SqlServerConnection,
    scopes: &[CodeScope],
) -> Result<CodeRows, CodeFailure> {
    let mut rows = CodeRows {
        objects: run_code_query(connection, scopes, &CODE_OBJECTS, map_code_object_row).await?,
        triggers: run_code_query(connection, scopes, &TRIGGERS, map_trigger_row).await?,
        trigger_events: run_code_query(connection, scopes, &TRIGGER_EVENTS, map_trigger_event_row)
            .await?,
        parameters: run_code_query(connection, scopes, &PARAMETERS, map_parameter_row).await?,
        columns: run_code_query(connection, scopes, &CODE_COLUMNS, |row| {
            column_row(row, CODE_COLUMNS.name)
        })
        .await?,
    };
    // Different user spellings may resolve to the same schema under the server's collation.
    // Identity, rather than client-side name comparison, removes overlap across request chunks.
    rows.objects.sort_by_key(|row| row.object_id);
    rows.objects.dedup_by_key(|row| row.object_id);
    rows.triggers.sort_by_key(|row| row.object_id);
    rows.triggers.dedup_by_key(|row| row.object_id);
    rows.parameters
        .sort_by_key(|row| (row.object_id, row.parameter_id));
    rows.parameters
        .dedup_by_key(|row| (row.object_id, row.parameter_id));
    rows.columns
        .sort_by_key(|row| (row.object_id, row.column_id));
    rows.columns
        .dedup_by_key(|row| (row.object_id, row.column_id));
    rows.trigger_events
        .sort_by(|a, b| (a.object_id, &a.event_type).cmp(&(b.object_id, &b.event_type)));
    rows.trigger_events
        .dedup_by(|a, b| a.object_id == b.object_id && a.event_type == b.event_type);
    Ok(rows)
}

async fn run_code_query<T>(
    connection: &mut SqlServerConnection,
    scopes: &[CodeScope],
    query: &CodeQuery,
    map_row: fn(&Row) -> Result<T, InspectorError>,
) -> Result<Vec<T>, CodeFailure> {
    let started = Instant::now();
    let mut mapped = Vec::new();
    for scope in scopes {
        let sql = scope.sql(query);
        let parameters = scope.parameters();
        let rows = connection
            .query(sql, &parameters)
            .await
            .map_err(|error| CodeFailure::driver(query.name, &error))?
            .into_first_result()
            .await
            .map_err(|error| CodeFailure::driver(query.name, &error))?;
        for row in &rows {
            mapped.push(map_row(row).map_err(|error| CodeFailure::inspection(&error))?);
        }
    }
    diagnostics::catalog_query(query.name, mapped.len(), started.elapsed());
    Ok(mapped)
}

async fn fetch_module_texts(
    connection: &mut SqlServerConnection,
    scopes: &[CodeScope],
) -> Result<ModuleTexts, CodeFailure> {
    let query = &MODULE_DEFINITIONS;
    let started = Instant::now();
    let mut texts = ModuleTexts::new();
    for scope in scopes {
        let sql = scope.sql(query);
        let parameters = scope.parameters();
        let mut rows = connection
            .query(sql, &parameters)
            .await
            .map_err(|error| CodeFailure::driver(query.name, &error))?
            .into_row_stream();
        while let Some(row) = rows
            .try_next()
            .await
            .map_err(|error| CodeFailure::driver(query.name, &error))?
        {
            let object_id = required(&row, "object_id", query.name)
                .map_err(|error| CodeFailure::inspection(&error))?;
            let definition = optional_text(&row, "definition", query.name)
                .map_err(|error| CodeFailure::inspection(&error))?;
            texts.insert(object_id, definition);
        }
    }
    diagnostics::catalog_query(query.name, texts.len(), started.elapsed());
    Ok(texts)
}

fn map_code_object_row(row: &Row) -> Result<CodeObjectRow, InspectorError> {
    let query = CODE_OBJECTS.name;
    Ok(CodeObjectRow {
        object_id: required(row, "object_id", query)?,
        schema_name: required_text(row, "schema_name", query)?,
        object_name: required_text(row, "object_name", query)?,
        object_type: required_text(row, "object_type", query)?.trim().to_string(),
        has_check_option: required(row, "has_check_option", query)?,
        is_encrypted: optional(row, "is_encrypted", query)?,
    })
}

fn map_trigger_row(row: &Row) -> Result<TriggerRow, InspectorError> {
    let query = TRIGGERS.name;
    Ok(TriggerRow {
        object_id: required(row, "object_id", query)?,
        parent_id: required(row, "parent_id", query)?,
        trigger_name: required_text(row, "trigger_name", query)?,
        trigger_type: required_text(row, "trigger_type", query)?
            .trim()
            .to_string(),
        is_disabled: required(row, "is_disabled", query)?,
        is_not_for_replication: required(row, "is_not_for_replication", query)?,
        is_instead_of_trigger: required(row, "is_instead_of_trigger", query)?,
        is_encrypted: optional(row, "is_encrypted", query)?,
    })
}

fn map_trigger_event_row(row: &Row) -> Result<TriggerEventRow, InspectorError> {
    let query = TRIGGER_EVENTS.name;
    Ok(TriggerEventRow {
        object_id: required(row, "object_id", query)?,
        event_type: required_text(row, "event_type", query)?,
        is_first: required(row, "is_first", query)?,
        is_last: required(row, "is_last", query)?,
    })
}

fn map_parameter_row(row: &Row) -> Result<ParameterRow, InspectorError> {
    let query = PARAMETERS.name;
    Ok(ParameterRow {
        object_id: required(row, "object_id", query)?,
        parameter_id: required(row, "parameter_id", query)?,
        parameter_name: optional_text(row, "parameter_name", query)?.unwrap_or_default(),
        system_type_name: optional_text(row, "system_type_name", query)?,
        user_type_name: optional_text(row, "user_type_name", query)?,
        is_table_type: required(row, "is_table_type", query)?,
        max_length: required(row, "max_length", query)?,
        precision: required(row, "precision", query)?,
        scale: required(row, "scale", query)?,
        is_output: required(row, "is_output", query)?,
        is_readonly: required(row, "is_readonly", query)?,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]
    use super::*;

    #[test]
    fn schema_names_are_always_bound_and_large_selections_stay_scoped() {
        let mut schemas: Vec<String> = (0..3000).map(|number| format!("schema_{number}")).collect();
        schemas.push("x'); DROP TABLE t; --".to_string());
        schemas.push(schemas[0].clone());
        let scopes = CodeScope::chunks(&InspectionOptions {
            schemas,
            ..InspectionOptions::default()
        });
        assert_eq!(scopes.len(), 2);
        assert_eq!(
            scopes
                .iter()
                .map(|scope| scope.schemas.len())
                .sum::<usize>(),
            3001
        );
        for scope in &scopes {
            assert!(scope.parameters().len() <= 2001);
            for query in [
                &CODE_OBJECTS,
                &TRIGGERS,
                &TRIGGER_EVENTS,
                &PARAMETERS,
                &CODE_COLUMNS,
                &MODULE_DEFINITIONS,
            ] {
                let sql = scope.sql(query);
                assert!(sql.contains("AND s.name IN (@P2"));
                assert!(!sql.contains("DROP") && !sql.contains("schema_0"));
                assert!(!sql.contains(SCHEMA_FILTER));
            }
        }
        let all = CodeScope::chunks(&InspectionOptions::default());
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].schemas, Vec::<String>::new());
        assert!(!all[0].sql(&MODULE_DEFINITIONS).contains("s.name IN"));
    }

    #[test]
    fn a_driver_timeout_keeps_its_reason_and_query_without_its_message() {
        let failure = CodeFailure::driver(
            "module definitions",
            &tiberius::error::Error::Io {
                kind: std::io::ErrorKind::TimedOut,
                message: "sentinel private SQL".to_string(),
            },
        );
        assert_eq!(failure.reason, NotReadReason::TimedOut);
        assert_eq!(failure.summary.kind, InspectorErrorKind::Timeout);
        assert_eq!(failure.summary.query, Some("module definitions"));
        assert_eq!(failure.summary.error_number, None);
        assert!(!format!("{:?}", failure.summary).contains("sentinel"));
    }
}
