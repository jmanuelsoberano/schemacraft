//! Hand-built snapshots shared by the unit tests of this crate.

use chrono::{TimeZone, Utc};

use super::{
    Column, ForeignKey, ForeignKeyColumnPair, Index, IndexKind, PrimaryKey, QualifiedName,
    ReferentialAction, SchemaSnapshot, SqlDataType, Table, TypeLength, View,
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

/// A two-table schema (`sales.Orders` references `dbo.Customers`) with one view and one
/// foreign key.
pub(crate) fn sample_snapshot() -> SchemaSnapshot {
    let customers = Table {
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
        check_constraints: vec![],
    };

    let orders = Table {
        name: QualifiedName::new("sales", "Orders"),
        columns: vec![
            Column {
                is_identity: true,
                ..column("OrderId", 1, SqlDataType::plain("int"), false)
            },
            column("CustomerId", 2, SqlDataType::plain("int"), false),
            Column {
                default_expression: Some("(sysutcdatetime())".to_string()),
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
    };

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

    SchemaSnapshot {
        database_name: "Northwind".to_string(),
        server_version: Some("Microsoft SQL Server 2022 (RTM) - 16.0.1000.6".to_string()),
        extracted_at: Utc
            .with_ymd_and_hms(2026, 10, 13, 15, 30, 0)
            .single()
            .unwrap_or_default(),
        tables: vec![customers, orders],
        views: vec![recent_orders],
        foreign_keys: vec![orders_to_customers],
    }
}
