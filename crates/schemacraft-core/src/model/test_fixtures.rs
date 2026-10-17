//! Hand-built snapshots shared by the unit tests of this crate.

use chrono::{Duration, TimeZone, Utc};

use super::{
    AccessCounts, AccessProbe, AccessProfile, CaptureScope, CheckConstraint, Column, Definition,
    ForeignKey, ForeignKeyColumnPair, ForeignKeyToInvisibleTable, Index, IndexKind, PrimaryKey,
    QualifiedName, ReferentialAction, SchemaAccess, SchemaSnapshot, SqlDataType, Table, TypeLength,
    UnknownFields, View,
};

fn column(name: &str, ordinal_position: u32, data_type: SqlDataType, is_nullable: bool) -> Column {
    Column {
        name: name.to_string(),
        ordinal_position,
        data_type,
        is_nullable,
        default_expression: None,
        is_identity: false,
        is_computed: false,
    }
}

fn name_type() -> SqlDataType {
    SqlDataType::with_length("nvarchar", TypeLength::Fixed { value: 120 })
}

fn schema_access(name: &str, can_read_definitions: bool, can_read_data: bool) -> SchemaAccess {
    SchemaAccess {
        name: name.to_string(),
        can_read_definitions,
        can_read_data,
        is_denied: false,
        has_visible_objects: true,
    }
}

/// Profile of a login that reads everything, such as `db_owner`, after capturing `counts`.
pub(crate) fn full_profile(counts: AccessCounts) -> AccessProfile {
    let probe = AccessProbe {
        can_read_definitions: true,
        can_read_data: true,
        explicit_denials: Some(0),
        sees_objects: true,
        schemas: vec![
            schema_access("dbo", true, true),
            schema_access("sales", true, true),
        ],
        database_user: Some("reporting".to_string()),
    };
    AccessProfile::observed(probe, CaptureScope::everything(), counts)
}

/// Profile of a login granted `SELECT` on `schemas` only: it lists every object there, cannot
/// tell what other schemas hold and reads no text.
pub(crate) fn schema_reader_profile(schemas: &[&str], counts: AccessCounts) -> AccessProfile {
    let probe = AccessProbe {
        can_read_definitions: false,
        can_read_data: false,
        explicit_denials: Some(0),
        sees_objects: true,
        schemas: schemas
            .iter()
            .map(|schema| schema_access(schema, false, true))
            .collect(),
        database_user: Some("reporting".to_string()),
    };
    AccessProfile::observed(probe, CaptureScope::everything(), counts)
}

/// `snapshot` with `profile` as its access profile.
pub(crate) fn with_access(snapshot: SchemaSnapshot, profile: AccessProfile) -> SchemaSnapshot {
    SchemaSnapshot {
        access: Some(profile),
        ..snapshot
    }
}

fn customers_table() -> Table {
    Table {
        name: QualifiedName::new("dbo", "Customers"),
        columns: vec![
            Column {
                is_identity: true,
                ..column("CustomerId", 1, SqlDataType::plain("int"), false)
            },
            column("Name", 2, name_type(), false),
            column(
                "Notes",
                3,
                SqlDataType::with_length("nvarchar", TypeLength::Max),
                true,
            ),
        ],
        primary_key: Some(PrimaryKey {
            name: "PK_Customers".to_string(),
            columns: vec!["CustomerId".to_string()],
            is_clustered: true,
        }),
        indexes: vec![Index {
            name: "UX_Customers_Name".to_string(),
            columns: vec!["Name".to_string()],
            kind: IndexKind::UniqueConstraint,
            is_clustered: false,
        }],
        check_constraints: vec![CheckConstraint {
            name: "CK_Customers_Name".to_string(),
            expression: Definition::readable("(len([Name])>(0))"),
            is_enabled: Some(true),
        }],
    }
}

fn orders_table() -> Table {
    Table {
        name: QualifiedName::new("sales", "Orders"),
        columns: vec![
            Column {
                is_identity: true,
                ..column("OrderId", 1, SqlDataType::plain("int"), false)
            },
            column("CustomerId", 2, SqlDataType::plain("int"), false),
            Column {
                default_expression: Some(Definition::readable("(sysutcdatetime())")),
                ..column(
                    "PlacedAt",
                    3,
                    SqlDataType::with_precision("datetime2", 7),
                    false,
                )
            },
            column(
                "Total",
                4,
                SqlDataType::with_precision_and_scale("decimal", 18, 2),
                false,
            ),
        ],
        primary_key: Some(PrimaryKey {
            name: "PK_Orders".to_string(),
            columns: vec!["OrderId".to_string()],
            is_clustered: true,
        }),
        indexes: vec![Index {
            name: "IX_Orders_CustomerId".to_string(),
            columns: vec!["CustomerId".to_string()],
            kind: IndexKind::NonUnique,
            is_clustered: false,
        }],
        check_constraints: vec![],
    }
}

/// A two-table schema (`sales.Orders` references `dbo.Customers`) with one view and one
/// foreign key, read by a login that sees everything.
pub(crate) fn sample_snapshot() -> SchemaSnapshot {
    let recent_orders = View {
        name: QualifiedName::new("sales", "RecentOrders"),
        columns: vec![
            column("OrderId", 1, SqlDataType::plain("int"), false),
            column("CustomerName", 2, name_type(), false),
        ],
    };

    let orders_to_customers = ForeignKey {
        name: "FK_Orders_Customers".to_string(),
        referencing_table: QualifiedName::new("sales", "Orders"),
        referenced_table: QualifiedName::new("dbo", "Customers"),
        column_pairs: vec![ForeignKeyColumnPair {
            referencing_column: "CustomerId".to_string(),
            referenced_column: "CustomerId".to_string(),
        }],
        on_delete: ReferentialAction::NoAction,
        on_update: ReferentialAction::Cascade,
        is_enabled: true,
    };

    let snapshot = SchemaSnapshot {
        database_name: "Northwind".to_string(),
        server_version: Some("Microsoft SQL Server 2022 (RTM) - 16.0.1000.6".to_string()),
        extracted_at: Utc
            .with_ymd_and_hms(2026, 10, 13, 15, 30, 0)
            .single()
            .unwrap_or_default(),
        access: None,
        tables: vec![customers_table(), orders_table()],
        views: vec![recent_orders],
        foreign_keys: vec![orders_to_customers],
        foreign_keys_to_invisible_tables: vec![],
        carried_over: vec![],
        unknown: UnknownFields::new(),
    };
    let counts = AccessCounts::of(&snapshot);
    with_access(snapshot, full_profile(counts))
}

/// The sample schema read a day later by a login granted `SELECT` on `sales` only: it cannot
/// see `dbo.Customers`, so the key to it has no visible target, and it reads no text.
pub(crate) fn reader_snapshot() -> SchemaSnapshot {
    let sample = sample_snapshot();
    let mut tables = sample.tables;
    tables.retain(|table| table.name.schema == "sales");
    for column in tables.iter_mut().flat_map(|table| table.columns.iter_mut()) {
        if column.default_expression.is_some() {
            column.default_expression = Some(Definition::NotVisible);
        }
    }

    let snapshot = SchemaSnapshot {
        extracted_at: sample.extracted_at + Duration::days(1),
        access: None,
        tables,
        foreign_keys: vec![],
        foreign_keys_to_invisible_tables: vec![ForeignKeyToInvisibleTable {
            name: "FK_Orders_Customers".to_string(),
            referencing_table: QualifiedName::new("sales", "Orders"),
            columns: vec!["CustomerId".to_string()],
            on_delete: ReferentialAction::NoAction,
            on_update: ReferentialAction::Cascade,
            is_enabled: true,
        }],
        ..sample
    };
    let counts = AccessCounts::of(&snapshot);
    with_access(snapshot, schema_reader_profile(&["sales"], counts))
}
