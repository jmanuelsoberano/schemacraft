//! Catalog queries against the `sys` views and their typed row mappings.
//!
//! Every query is set based: one round trip per object family, never one per table. Rows are
//! kept close to the catalog shape; [`super::assembly`] turns them into the domain model.

use std::time::Duration;

use tiberius::{FromSql, Row};

use super::errors::query_error;
use super::pool::{ConnectionPool, SqlServerConnection, checkout_error};
use crate::diagnostics;
use crate::inspectors::{
    InspectionProgress, InspectionStage, InspectorError, ProgressReporter, ServerInformation,
};

/// A named catalog query, so failures can say which one broke.
pub(super) struct CatalogQuery {
    /// Short identifier used in error messages.
    pub name: &'static str,
    /// T-SQL text.
    pub sql: &'static str,
}

pub(super) const SERVER_INFORMATION: CatalogQuery = CatalogQuery {
    name: "server information",
    sql: "SELECT @@VERSION AS version_banner,
       CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS product_version,
       CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
       CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS server_name,
       DB_NAME() AS database_name;",
};

pub(super) const DATABASES: CatalogQuery = CatalogQuery {
    name: "databases",
    sql: "SELECT d.name AS database_name
FROM sys.databases AS d
WHERE d.state = 0
  AND d.name NOT IN ('master', 'tempdb', 'model', 'msdb')
  AND HAS_DBACCESS(d.name) = 1
ORDER BY d.name;",
};

const OBJECTS: CatalogQuery = CatalogQuery {
    name: "objects",
    sql: "SELECT o.object_id, s.name AS schema_name, o.name AS object_name, o.type AS object_type
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name;",
};

/// Columns with their types and defaults. Whether a column has a default comes from
/// `default_object_id`, which every login that sees the column can read; the text of a
/// `DEFAULT` constraint needs `VIEW DEFINITION` and is `NULL` without it. A legacy default bound
/// with `sp_bindefault` has no row in `sys.default_constraints`, so its text is read with
/// `OBJECT_DEFINITION`.
const COLUMNS: CatalogQuery = CatalogQuery {
    name: "columns",
    sql: "SELECT c.object_id, c.column_id, c.name AS column_name,
       COALESCE(base_type.name, declared_type.name) AS system_type_name,
       CASE WHEN declared_type.is_user_defined = 1
            THEN SCHEMA_NAME(declared_type.schema_id) + '.' + declared_type.name END AS user_type_name,
       c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
       CAST(CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END AS bit) AS has_default,
       dc.definition AS default_definition,
       CASE WHEN c.default_object_id <> 0 AND dc.object_id IS NULL
            THEN OBJECT_DEFINITION(c.default_object_id) END AS bound_default_definition
FROM sys.columns AS c
JOIN sys.objects AS o ON o.object_id = c.object_id AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.types AS declared_type ON declared_type.user_type_id = c.user_type_id
LEFT JOIN sys.types AS base_type ON base_type.user_type_id = declared_type.system_type_id
LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
ORDER BY c.object_id, c.column_id;",
};

const INDEXES: CatalogQuery = CatalogQuery {
    name: "indexes",
    sql: "SELECT i.object_id, i.index_id, i.name AS index_name, i.type AS index_type,
       i.is_unique, i.is_primary_key, i.is_unique_constraint
FROM sys.indexes AS i
JOIN sys.objects AS o ON o.object_id = i.object_id AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
WHERE i.index_id > 0 AND i.is_hypothetical = 0 AND i.type IN (1, 2)
ORDER BY i.object_id, i.index_id;",
};

const INDEX_COLUMNS: CatalogQuery = CatalogQuery {
    name: "index columns",
    sql: "SELECT ic.object_id, ic.index_id, c.name AS column_name, ic.key_ordinal, ic.is_included_column
FROM sys.index_columns AS ic
JOIN sys.indexes AS i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
     AND i.index_id > 0 AND i.is_hypothetical = 0 AND i.type IN (1, 2)
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.objects AS o ON o.object_id = ic.object_id AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
ORDER BY ic.object_id, ic.index_id, ic.key_ordinal;",
};

const FOREIGN_KEYS: CatalogQuery = CatalogQuery {
    name: "foreign keys",
    sql: "SELECT fk.object_id, fk.name AS constraint_name, fk.parent_object_id, fk.referenced_object_id,
       fk.delete_referential_action, fk.update_referential_action, fk.is_disabled
FROM sys.foreign_keys AS fk
WHERE fk.is_ms_shipped = 0
ORDER BY fk.parent_object_id, fk.name;",
};

/// Column pairs of foreign keys. The columns of a referenced table the login cannot see are
/// not visible either, so they are joined optionally and the pair survives without them.
const FOREIGN_KEY_COLUMNS: CatalogQuery = CatalogQuery {
    name: "foreign key columns",
    sql: "SELECT fkc.constraint_object_id, fkc.constraint_column_id,
       parent_column.name AS referencing_column, referenced_column.name AS referenced_column
FROM sys.foreign_key_columns AS fkc
JOIN sys.columns AS parent_column
     ON parent_column.object_id = fkc.parent_object_id AND parent_column.column_id = fkc.parent_column_id
LEFT JOIN sys.columns AS referenced_column
     ON referenced_column.object_id = fkc.referenced_object_id AND referenced_column.column_id = fkc.referenced_column_id
ORDER BY fkc.constraint_object_id, fkc.constraint_column_id;",
};

/// `CHECK` constraints. `definition` is `NULL` for a login without `VIEW DEFINITION`.
const CHECK_CONSTRAINTS: CatalogQuery = CatalogQuery {
    name: "check constraints",
    sql: "SELECT cc.parent_object_id, cc.name AS constraint_name, cc.definition, cc.is_disabled
FROM sys.check_constraints AS cc
WHERE cc.is_ms_shipped = 0
ORDER BY cc.parent_object_id, cc.name;",
};

/// Whether a catalog object is a base table or a view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ObjectKind {
    /// `sys.objects.type = 'U'`.
    Table,
    /// `sys.objects.type = 'V'`.
    View,
}

/// One row of `sys.objects` restricted to tables and views.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ObjectRow {
    pub object_id: i32,
    pub schema_name: String,
    pub object_name: String,
    pub kind: ObjectKind,
}

/// One row of `sys.columns` joined with its type and default.
// The flags mirror independent catalog columns; none of them implies another.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ColumnRow {
    pub object_id: i32,
    pub column_id: i32,
    pub column_name: String,
    pub system_type_name: String,
    pub user_type_name: Option<String>,
    pub max_length: i16,
    pub precision: u8,
    pub scale: u8,
    pub is_nullable: bool,
    pub is_identity: bool,
    pub is_computed: bool,
    /// Whether the column has a default, readable or not.
    pub has_default: bool,
    /// Text of the `DEFAULT` constraint; `None` without one or without `VIEW DEFINITION`.
    pub default_definition: Option<String>,
    /// `CREATE DEFAULT` statement of a legacy bound default.
    pub bound_default_definition: Option<String>,
}

/// One row of `sys.indexes` for clustered and nonclustered indexes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct IndexRow {
    pub object_id: i32,
    pub index_id: i32,
    pub index_name: String,
    /// `1` clustered, `2` nonclustered.
    pub index_type: u8,
    pub is_unique: bool,
    pub is_primary_key: bool,
    pub is_unique_constraint: bool,
}

/// One row of `sys.index_columns`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct IndexColumnRow {
    pub object_id: i32,
    pub index_id: i32,
    pub column_name: String,
    /// Position in the key; `0` for included columns.
    pub key_ordinal: u8,
    pub is_included_column: bool,
}

/// One row of `sys.foreign_keys`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ForeignKeyRow {
    pub object_id: i32,
    pub constraint_name: String,
    pub parent_object_id: i32,
    pub referenced_object_id: i32,
    pub delete_referential_action: u8,
    pub update_referential_action: u8,
    pub is_disabled: bool,
}

/// One row of `sys.foreign_key_columns`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ForeignKeyColumnRow {
    pub constraint_object_id: i32,
    pub constraint_column_id: i32,
    pub referencing_column: String,
    /// `None` when the referenced table is not visible to the login.
    pub referenced_column: Option<String>,
}

/// One row of `sys.check_constraints`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CheckConstraintRow {
    pub parent_object_id: i32,
    pub constraint_name: String,
    /// `None` when the login cannot read the text.
    pub definition: Option<String>,
    pub is_disabled: bool,
}

/// Everything the catalog queries return for one database.
#[derive(Debug, Default, Clone)]
pub(super) struct CatalogRows {
    pub objects: Vec<ObjectRow>,
    pub columns: Vec<ColumnRow>,
    pub indexes: Vec<IndexRow>,
    pub index_columns: Vec<IndexColumnRow>,
    pub foreign_keys: Vec<ForeignKeyRow>,
    pub foreign_key_columns: Vec<ForeignKeyColumnRow>,
    pub check_constraints: Vec<CheckConstraintRow>,
}

/// Runs a catalog query on a session and maps every row.
pub(super) async fn run_query<T>(
    connection: &mut SqlServerConnection,
    query: &CatalogQuery,
    map_row: fn(&Row) -> Result<T, InspectorError>,
) -> Result<Vec<T>, InspectorError> {
    let rows = connection
        .simple_query(query.sql)
        .await
        .map_err(|error| query_error(query.name, &error))?
        .into_first_result()
        .await
        .map_err(|error| query_error(query.name, &error))?;

    rows.iter().map(map_row).collect()
}

/// Runs a catalog batch that returns several result sets and keeps the rows of each, in order.
pub(super) async fn run_batch(
    connection: &mut SqlServerConnection,
    query: &CatalogQuery,
) -> Result<Vec<Vec<Row>>, InspectorError> {
    connection
        .simple_query(query.sql)
        .await
        .map_err(|error| query_error(query.name, &error))?
        .into_results()
        .await
        .map_err(|error| query_error(query.name, &error))
}

/// Identifies the server and the database the session landed in.
pub(super) async fn fetch_server_information(
    connection: &mut SqlServerConnection,
) -> Result<ServerInformation, InspectorError> {
    run_query(connection, &SERVER_INFORMATION, map_server_information_row)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| InspectorError::UnexpectedCatalogData {
            query: SERVER_INFORMATION.name,
            details: "the server returned no row".to_string(),
        })
}

/// Names of the databases the login can open.
pub(super) async fn fetch_database_names(
    connection: &mut SqlServerConnection,
) -> Result<Vec<String>, InspectorError> {
    run_query(connection, &DATABASES, |row| {
        required_text(row, "database_name", DATABASES.name)
    })
    .await
}

/// How to reach the pool when a stage needs a session.
pub(super) struct CatalogSession<'a> {
    /// Pool to borrow sessions from.
    pub pool: &'a ConnectionPool,
    /// Server as the user typed it, for error messages.
    pub target: &'a str,
    /// Time allowed per connection attempt.
    pub connect_timeout: Duration,
}

/// Runs every catalog query concurrently and reports each one as it completes.
pub(super) async fn fetch_catalog(
    session: &CatalogSession<'_>,
    progress: &dyn ProgressReporter,
) -> Result<CatalogRows, InspectorError> {
    let (
        objects,
        columns,
        indexes,
        index_columns,
        foreign_keys,
        foreign_key_columns,
        check_constraints,
    ) = tokio::try_join!(
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingObjects,
            &OBJECTS,
            map_object_row,
            true
        ),
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingColumns,
            &COLUMNS,
            map_column_row,
            true
        ),
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingIndexes,
            &INDEXES,
            map_index_row,
            true
        ),
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingIndexes,
            &INDEX_COLUMNS,
            map_index_column_row,
            false
        ),
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingForeignKeys,
            &FOREIGN_KEYS,
            map_foreign_key_row,
            true
        ),
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingForeignKeys,
            &FOREIGN_KEY_COLUMNS,
            map_foreign_key_column_row,
            false
        ),
        fetch_stage(
            session,
            progress,
            InspectionStage::ReadingConstraints,
            &CHECK_CONSTRAINTS,
            map_check_constraint_row,
            true
        ),
    )?;

    Ok(CatalogRows {
        objects,
        columns,
        indexes,
        index_columns,
        foreign_keys,
        foreign_key_columns,
        check_constraints,
    })
}

/// Borrows a session, runs one query and reports the stage when the query carries its count.
async fn fetch_stage<T>(
    session: &CatalogSession<'_>,
    progress: &dyn ProgressReporter,
    stage: InspectionStage,
    query: &CatalogQuery,
    map_row: fn(&Row) -> Result<T, InspectorError>,
    reports_count: bool,
) -> Result<Vec<T>, InspectorError> {
    let started = std::time::Instant::now();
    let mut connection = session
        .pool
        .get()
        .await
        .map_err(|error| checkout_error(error, session.target, session.connect_timeout))?;

    let rows = run_query(&mut connection, query, map_row).await?;
    diagnostics::catalog_query(query.name, rows.len(), started.elapsed());

    if reports_count {
        progress.report(InspectionProgress::counted(stage, rows.len()));
    }
    Ok(rows)
}

fn map_server_information_row(row: &Row) -> Result<ServerInformation, InspectorError> {
    let query = SERVER_INFORMATION.name;
    let banner = required_text(row, "version_banner", query)?;
    Ok(ServerInformation {
        product: banner.lines().next().unwrap_or_default().trim().to_string(),
        product_version: required_text(row, "product_version", query)?,
        edition: required_text(row, "edition", query)?,
        server_name: required_text(row, "server_name", query)?,
        database_name: required_text(row, "database_name", query)?,
    })
}

fn map_object_row(row: &Row) -> Result<ObjectRow, InspectorError> {
    let query = OBJECTS.name;
    let object_type = required_text(row, "object_type", query)?;
    let kind = match object_type.trim() {
        "U" => ObjectKind::Table,
        "V" => ObjectKind::View,
        other => {
            return Err(InspectorError::UnexpectedCatalogData {
                query,
                details: format!("unknown object type {other:?}"),
            });
        }
    };
    Ok(ObjectRow {
        object_id: required(row, "object_id", query)?,
        schema_name: required_text(row, "schema_name", query)?,
        object_name: required_text(row, "object_name", query)?,
        kind,
    })
}

fn map_column_row(row: &Row) -> Result<ColumnRow, InspectorError> {
    let query = COLUMNS.name;
    Ok(ColumnRow {
        object_id: required(row, "object_id", query)?,
        column_id: required(row, "column_id", query)?,
        column_name: required_text(row, "column_name", query)?,
        system_type_name: required_text(row, "system_type_name", query)?,
        user_type_name: optional_text(row, "user_type_name", query)?,
        max_length: required(row, "max_length", query)?,
        precision: required(row, "precision", query)?,
        scale: required(row, "scale", query)?,
        is_nullable: optional(row, "is_nullable", query)?.unwrap_or(true),
        is_identity: required(row, "is_identity", query)?,
        is_computed: required(row, "is_computed", query)?,
        has_default: required(row, "has_default", query)?,
        default_definition: optional_text(row, "default_definition", query)?,
        bound_default_definition: optional_text(row, "bound_default_definition", query)?,
    })
}

fn map_index_row(row: &Row) -> Result<IndexRow, InspectorError> {
    let query = INDEXES.name;
    Ok(IndexRow {
        object_id: required(row, "object_id", query)?,
        index_id: required(row, "index_id", query)?,
        index_name: required_text(row, "index_name", query)?,
        index_type: required(row, "index_type", query)?,
        is_unique: required(row, "is_unique", query)?,
        is_primary_key: required(row, "is_primary_key", query)?,
        is_unique_constraint: required(row, "is_unique_constraint", query)?,
    })
}

fn map_index_column_row(row: &Row) -> Result<IndexColumnRow, InspectorError> {
    let query = INDEX_COLUMNS.name;
    Ok(IndexColumnRow {
        object_id: required(row, "object_id", query)?,
        index_id: required(row, "index_id", query)?,
        column_name: required_text(row, "column_name", query)?,
        key_ordinal: required(row, "key_ordinal", query)?,
        is_included_column: required(row, "is_included_column", query)?,
    })
}

fn map_foreign_key_row(row: &Row) -> Result<ForeignKeyRow, InspectorError> {
    let query = FOREIGN_KEYS.name;
    Ok(ForeignKeyRow {
        object_id: required(row, "object_id", query)?,
        constraint_name: required_text(row, "constraint_name", query)?,
        parent_object_id: required(row, "parent_object_id", query)?,
        referenced_object_id: required(row, "referenced_object_id", query)?,
        delete_referential_action: required(row, "delete_referential_action", query)?,
        update_referential_action: required(row, "update_referential_action", query)?,
        is_disabled: required(row, "is_disabled", query)?,
    })
}

fn map_foreign_key_column_row(row: &Row) -> Result<ForeignKeyColumnRow, InspectorError> {
    let query = FOREIGN_KEY_COLUMNS.name;
    Ok(ForeignKeyColumnRow {
        constraint_object_id: required(row, "constraint_object_id", query)?,
        constraint_column_id: required(row, "constraint_column_id", query)?,
        referencing_column: required_text(row, "referencing_column", query)?,
        referenced_column: optional_text(row, "referenced_column", query)?,
    })
}

fn map_check_constraint_row(row: &Row) -> Result<CheckConstraintRow, InspectorError> {
    let query = CHECK_CONSTRAINTS.name;
    Ok(CheckConstraintRow {
        parent_object_id: required(row, "parent_object_id", query)?,
        constraint_name: required_text(row, "constraint_name", query)?,
        definition: optional_text(row, "definition", query)?,
        is_disabled: required(row, "is_disabled", query)?,
    })
}

pub(super) fn required<'a, T: FromSql<'a>>(
    row: &'a Row,
    column: &'static str,
    query: &'static str,
) -> Result<T, InspectorError> {
    optional(row, column, query)?.ok_or_else(|| InspectorError::UnexpectedCatalogData {
        query,
        details: format!("column {column} is NULL"),
    })
}

pub(super) fn optional<'a, T: FromSql<'a>>(
    row: &'a Row,
    column: &'static str,
    query: &'static str,
) -> Result<Option<T>, InspectorError> {
    row.try_get::<T, _>(column)
        .map_err(|error| InspectorError::UnexpectedCatalogData {
            query,
            details: format!("column {column}: {error}"),
        })
}

pub(super) fn required_text(
    row: &Row,
    column: &'static str,
    query: &'static str,
) -> Result<String, InspectorError> {
    required::<&str>(row, column, query).map(str::to_string)
}

pub(super) fn optional_text(
    row: &Row,
    column: &'static str,
    query: &'static str,
) -> Result<Option<String>, InspectorError> {
    optional::<&str>(row, column, query).map(|value| value.map(str::to_string))
}
