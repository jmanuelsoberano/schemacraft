//! Turns catalog rows into a [`SchemaSnapshot`]. Pure and deterministic, so it is unit tested
//! without a database.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};

use super::catalog::{
    CatalogRows, CheckConstraintRow, ColumnRow, ForeignKeyColumnRow, ForeignKeyRow, IndexColumnRow,
    IndexRow, ObjectKind, ObjectRow,
};
use super::data_types::{CatalogTypeInformation, data_type_from_catalog};
use crate::inspectors::InspectionOptions;
use crate::model::{
    CheckConstraint, Column, ForeignKey, ForeignKeyColumnPair, Index, IndexKind, PrimaryKey,
    QualifiedName, ReferentialAction, SchemaSnapshot, Table, View,
};

const CLUSTERED_INDEX_TYPE: u8 = 1;

/// Facts about the extraction that are not part of the catalog rows.
pub(super) struct SnapshotIdentity {
    /// Database the rows came from.
    pub database_name: String,
    /// Server product string, when known.
    pub server_version: Option<String>,
    /// Moment the extraction finished.
    pub extracted_at: DateTime<Utc>,
}

/// Builds the snapshot, applying the schema and view filters of `options`.
///
/// Foreign keys whose other end is outside the selection are dropped: a relationship edge
/// needs both tables in the diagram.
pub(super) fn assemble_snapshot(
    rows: &CatalogRows,
    options: &InspectionOptions,
    identity: SnapshotIdentity,
) -> SchemaSnapshot {
    let included = included_objects(&rows.objects, options);
    let mut columns = group_columns(&rows.columns, &included);
    let mut primary_keys = BTreeMap::new();
    let mut indexes: BTreeMap<i32, Vec<Index>> = BTreeMap::new();
    let index_columns = group_index_columns(&rows.index_columns);

    for index_row in &rows.indexes {
        if !included.contains_key(&index_row.object_id) {
            continue;
        }
        let key_columns = key_columns_of(&index_columns, index_row);
        if index_row.is_primary_key {
            primary_keys.insert(
                index_row.object_id,
                PrimaryKey {
                    name: index_row.index_name.clone(),
                    columns: key_columns,
                    is_clustered: index_row.index_type == CLUSTERED_INDEX_TYPE,
                },
            );
        } else {
            indexes.entry(index_row.object_id).or_default().push(Index {
                name: index_row.index_name.clone(),
                columns: key_columns,
                kind: index_kind(index_row),
                is_clustered: index_row.index_type == CLUSTERED_INDEX_TYPE,
            });
        }
    }

    let mut check_constraints = group_check_constraints(&rows.check_constraints, &included);

    let mut tables = Vec::new();
    let mut views = Vec::new();
    for (object_id, object) in &included {
        let object_columns = columns.remove(object_id).unwrap_or_default();
        match object.kind {
            ObjectKind::Table => tables.push(Table {
                name: object.name.clone(),
                columns: object_columns,
                primary_key: primary_keys.remove(object_id),
                indexes: indexes.remove(object_id).unwrap_or_default(),
                check_constraints: check_constraints.remove(object_id).unwrap_or_default(),
            }),
            ObjectKind::View => views.push(View {
                name: object.name.clone(),
                columns: object_columns,
            }),
        }
    }
    tables.sort_by(|left, right| left.name.cmp(&right.name));
    views.sort_by(|left, right| left.name.cmp(&right.name));

    let mut foreign_keys =
        assemble_foreign_keys(&rows.foreign_keys, &rows.foreign_key_columns, &included);
    foreign_keys.sort_by(|left, right| {
        (&left.referencing_table, &left.name).cmp(&(&right.referencing_table, &right.name))
    });

    SchemaSnapshot {
        database_name: identity.database_name,
        server_version: identity.server_version,
        extracted_at: identity.extracted_at,
        tables,
        views,
        foreign_keys,
    }
}

struct IncludedObject {
    name: QualifiedName,
    kind: ObjectKind,
}

fn included_objects(
    objects: &[ObjectRow],
    options: &InspectionOptions,
) -> BTreeMap<i32, IncludedObject> {
    objects
        .iter()
        .filter(|object| options.includes_schema(&object.schema_name))
        .filter(|object| object.kind == ObjectKind::Table || options.include_views)
        .map(|object| {
            (
                object.object_id,
                IncludedObject {
                    name: QualifiedName::new(&object.schema_name, &object.object_name),
                    kind: object.kind,
                },
            )
        })
        .collect()
}

fn group_columns(
    rows: &[ColumnRow],
    included: &BTreeMap<i32, IncludedObject>,
) -> BTreeMap<i32, Vec<Column>> {
    let mut grouped: BTreeMap<i32, Vec<(i32, Column)>> = BTreeMap::new();
    for row in rows
        .iter()
        .filter(|row| included.contains_key(&row.object_id))
    {
        grouped
            .entry(row.object_id)
            .or_default()
            .push((row.column_id, column_from_row(row)));
    }

    grouped
        .into_iter()
        .map(|(object_id, mut columns)| {
            columns.sort_by_key(|(column_id, _)| *column_id);
            let ordered = columns
                .into_iter()
                .enumerate()
                .map(|(position, (_, mut column))| {
                    column.ordinal_position = u32::try_from(position + 1).unwrap_or(u32::MAX);
                    column
                })
                .collect();
            (object_id, ordered)
        })
        .collect()
}

fn column_from_row(row: &ColumnRow) -> Column {
    Column {
        name: row.column_name.clone(),
        ordinal_position: 0,
        data_type: data_type_from_catalog(CatalogTypeInformation {
            system_type_name: &row.system_type_name,
            user_defined_type_name: row.user_type_name.as_deref(),
            max_length: row.max_length,
            precision: row.precision,
            scale: row.scale,
        }),
        is_nullable: row.is_nullable,
        default_expression: row.default_definition.clone(),
        is_identity: row.is_identity,
        is_computed: row.is_computed,
    }
}

fn group_index_columns(rows: &[IndexColumnRow]) -> BTreeMap<(i32, i32), Vec<&IndexColumnRow>> {
    let mut grouped: BTreeMap<(i32, i32), Vec<&IndexColumnRow>> = BTreeMap::new();
    for row in rows.iter().filter(|row| !row.is_included_column) {
        grouped
            .entry((row.object_id, row.index_id))
            .or_default()
            .push(row);
    }
    for columns in grouped.values_mut() {
        columns.sort_by_key(|row| row.key_ordinal);
    }
    grouped
}

fn key_columns_of(
    index_columns: &BTreeMap<(i32, i32), Vec<&IndexColumnRow>>,
    index: &IndexRow,
) -> Vec<String> {
    index_columns
        .get(&(index.object_id, index.index_id))
        .map(|rows| rows.iter().map(|row| row.column_name.clone()).collect())
        .unwrap_or_default()
}

fn index_kind(index: &IndexRow) -> IndexKind {
    if index.is_unique_constraint {
        IndexKind::UniqueConstraint
    } else if index.is_unique {
        IndexKind::UniqueIndex
    } else {
        IndexKind::NonUnique
    }
}

fn group_check_constraints(
    rows: &[CheckConstraintRow],
    included: &BTreeMap<i32, IncludedObject>,
) -> BTreeMap<i32, Vec<CheckConstraint>> {
    let mut grouped: BTreeMap<i32, Vec<CheckConstraint>> = BTreeMap::new();
    for row in rows
        .iter()
        .filter(|row| included.contains_key(&row.parent_object_id))
    {
        grouped
            .entry(row.parent_object_id)
            .or_default()
            .push(CheckConstraint {
                name: row.constraint_name.clone(),
                expression: row.definition.clone(),
            });
    }
    grouped
}

fn assemble_foreign_keys(
    rows: &[ForeignKeyRow],
    column_rows: &[ForeignKeyColumnRow],
    included: &BTreeMap<i32, IncludedObject>,
) -> Vec<ForeignKey> {
    let mut pairs: BTreeMap<i32, Vec<&ForeignKeyColumnRow>> = BTreeMap::new();
    for row in column_rows {
        pairs.entry(row.constraint_object_id).or_default().push(row);
    }
    for rows in pairs.values_mut() {
        rows.sort_by_key(|row| row.constraint_column_id);
    }

    rows.iter()
        .filter_map(|row| {
            let referencing = included.get(&row.parent_object_id)?;
            let referenced = included.get(&row.referenced_object_id)?;
            let column_pairs = pairs
                .get(&row.object_id)
                .map(|rows| {
                    rows.iter()
                        .map(|pair| ForeignKeyColumnPair {
                            referencing_column: pair.referencing_column.clone(),
                            referenced_column: pair.referenced_column.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default();

            Some(ForeignKey {
                name: row.constraint_name.clone(),
                referencing_table: referencing.name.clone(),
                referenced_table: referenced.name.clone(),
                column_pairs,
                on_delete: referential_action(row.delete_referential_action),
                on_update: referential_action(row.update_referential_action),
                is_enabled: !row.is_disabled,
            })
        })
        .collect()
}

/// Maps `sys.foreign_keys.*_referential_action` codes.
fn referential_action(code: u8) -> ReferentialAction {
    match code {
        1 => ReferentialAction::Cascade,
        2 => ReferentialAction::SetNull,
        3 => ReferentialAction::SetDefault,
        _ => ReferentialAction::NoAction,
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )]

    use chrono::{TimeZone, Utc};

    use super::{SnapshotIdentity, assemble_snapshot};
    use crate::inspectors::InspectionOptions;
    use crate::inspectors::sqlserver::catalog::{
        CatalogRows, CheckConstraintRow, ColumnRow, ForeignKeyColumnRow, ForeignKeyRow,
        IndexColumnRow, IndexRow, ObjectKind, ObjectRow,
    };
    use crate::model::{IndexKind, QualifiedName, ReferentialAction, SchemaSnapshot};

    const CUSTOMERS: i32 = 100;
    const ORDERS: i32 = 200;
    const EMPLOYEES: i32 = 300;
    const RECENT_ORDERS_VIEW: i32 = 400;

    fn object(object_id: i32, schema: &str, name: &str, kind: ObjectKind) -> ObjectRow {
        ObjectRow {
            object_id,
            schema_name: schema.to_string(),
            object_name: name.to_string(),
            kind,
        }
    }

    fn column(object_id: i32, column_id: i32, name: &str, type_name: &str) -> ColumnRow {
        ColumnRow {
            object_id,
            column_id,
            column_name: name.to_string(),
            system_type_name: type_name.to_string(),
            user_type_name: None,
            max_length: 4,
            precision: 10,
            scale: 0,
            is_nullable: false,
            is_identity: false,
            is_computed: false,
            default_definition: None,
        }
    }

    fn index(
        object_id: i32,
        index_id: i32,
        name: &str,
        is_primary_key: bool,
        is_unique: bool,
    ) -> IndexRow {
        IndexRow {
            object_id,
            index_id,
            index_name: name.to_string(),
            index_type: if index_id == 1 { 1 } else { 2 },
            is_unique,
            is_primary_key,
            is_unique_constraint: false,
        }
    }

    fn index_column(object_id: i32, index_id: i32, name: &str, key_ordinal: u8) -> IndexColumnRow {
        IndexColumnRow {
            object_id,
            index_id,
            column_name: name.to_string(),
            key_ordinal,
            is_included_column: key_ordinal == 0,
        }
    }

    fn sample_rows() -> CatalogRows {
        CatalogRows {
            objects: vec![
                object(ORDERS, "sales", "Orders", ObjectKind::Table),
                object(CUSTOMERS, "dbo", "Customers", ObjectKind::Table),
                object(EMPLOYEES, "hr", "Employees", ObjectKind::Table),
                object(
                    RECENT_ORDERS_VIEW,
                    "sales",
                    "RecentOrders",
                    ObjectKind::View,
                ),
            ],
            columns: vec![
                // Deliberately out of order to prove ordinal sorting.
                column(CUSTOMERS, 2, "Name", "nvarchar"),
                column(CUSTOMERS, 1, "CustomerId", "int"),
                column(ORDERS, 1, "OrderId", "int"),
                column(ORDERS, 2, "CustomerId", "int"),
                column(ORDERS, 3, "LineNumber", "int"),
                column(EMPLOYEES, 1, "EmployeeId", "int"),
                column(EMPLOYEES, 2, "ManagerId", "int"),
                column(RECENT_ORDERS_VIEW, 1, "OrderId", "int"),
            ],
            indexes: vec![
                index(CUSTOMERS, 1, "PK_Customers", true, true),
                IndexRow {
                    is_unique_constraint: true,
                    ..index(CUSTOMERS, 2, "UQ_Customers_Name", false, true)
                },
                index(ORDERS, 1, "PK_Orders", true, true),
                index(ORDERS, 3, "IX_Orders_CustomerId", false, false),
                index(EMPLOYEES, 1, "PK_Employees", true, true),
            ],
            index_columns: vec![
                index_column(CUSTOMERS, 1, "CustomerId", 1),
                index_column(CUSTOMERS, 2, "Name", 1),
                // Composite key listed out of order, plus an included column that must be ignored.
                index_column(ORDERS, 1, "LineNumber", 2),
                index_column(ORDERS, 1, "OrderId", 1),
                index_column(ORDERS, 3, "CustomerId", 1),
                index_column(ORDERS, 3, "LineNumber", 0),
                index_column(EMPLOYEES, 1, "EmployeeId", 1),
            ],
            foreign_keys: vec![
                ForeignKeyRow {
                    object_id: 1000,
                    constraint_name: "FK_Orders_Customers".to_string(),
                    parent_object_id: ORDERS,
                    referenced_object_id: CUSTOMERS,
                    delete_referential_action: 1,
                    update_referential_action: 0,
                    is_disabled: false,
                },
                ForeignKeyRow {
                    object_id: 1001,
                    constraint_name: "FK_Employees_Manager".to_string(),
                    parent_object_id: EMPLOYEES,
                    referenced_object_id: EMPLOYEES,
                    delete_referential_action: 2,
                    update_referential_action: 3,
                    is_disabled: true,
                },
            ],
            foreign_key_columns: vec![
                ForeignKeyColumnRow {
                    constraint_object_id: 1000,
                    constraint_column_id: 1,
                    referencing_column: "CustomerId".to_string(),
                    referenced_column: "CustomerId".to_string(),
                },
                ForeignKeyColumnRow {
                    constraint_object_id: 1001,
                    constraint_column_id: 1,
                    referencing_column: "ManagerId".to_string(),
                    referenced_column: "EmployeeId".to_string(),
                },
            ],
            check_constraints: vec![CheckConstraintRow {
                parent_object_id: ORDERS,
                constraint_name: "CK_Orders_LineNumber".to_string(),
                definition: "([LineNumber]>(0))".to_string(),
            }],
        }
    }

    fn assemble(options: &InspectionOptions) -> SchemaSnapshot {
        assemble_snapshot(
            &sample_rows(),
            options,
            SnapshotIdentity {
                database_name: "Northwind".to_string(),
                server_version: Some("Microsoft SQL Server 2022".to_string()),
                extracted_at: Utc
                    .with_ymd_and_hms(2026, 10, 13, 12, 0, 0)
                    .single()
                    .unwrap_or_default(),
            },
        )
    }

    fn table_names(snapshot: &SchemaSnapshot) -> Vec<String> {
        snapshot
            .tables
            .iter()
            .map(|table| table.name.to_string())
            .collect()
    }

    #[test]
    fn orders_tables_by_schema_and_name_and_columns_by_ordinal() {
        let snapshot = assemble(&InspectionOptions::default());

        assert_eq!(
            table_names(&snapshot),
            ["dbo.Customers", "hr.Employees", "sales.Orders"]
        );
        let customers = &snapshot.tables[0];
        let column_names: Vec<&str> = customers
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect();
        assert_eq!(column_names, ["CustomerId", "Name"]);
        assert_eq!(customers.columns[1].ordinal_position, 2);
    }

    #[test]
    fn builds_primary_keys_indexes_and_check_constraints() {
        let snapshot = assemble(&InspectionOptions::default());
        let orders = snapshot
            .table(&QualifiedName::new("sales", "Orders"))
            .unwrap_or_else(|| panic!("orders"));

        let primary_key = orders
            .primary_key
            .as_ref()
            .unwrap_or_else(|| panic!("primary key"));
        assert_eq!(primary_key.name, "PK_Orders");
        assert_eq!(primary_key.columns, ["OrderId", "LineNumber"]);
        assert!(primary_key.is_clustered);

        assert_eq!(orders.indexes.len(), 1);
        assert_eq!(orders.indexes[0].name, "IX_Orders_CustomerId");
        assert_eq!(orders.indexes[0].columns, ["CustomerId"]);
        assert_eq!(orders.indexes[0].kind, IndexKind::NonUnique);
        assert!(!orders.indexes[0].is_clustered);

        assert_eq!(orders.check_constraints.len(), 1);
        assert_eq!(orders.check_constraints[0].expression, "([LineNumber]>(0))");

        let customers = snapshot
            .table(&QualifiedName::new("dbo", "Customers"))
            .unwrap_or_else(|| panic!("customers"));
        assert_eq!(customers.indexes[0].kind, IndexKind::UniqueConstraint);
    }

    #[test]
    fn builds_foreign_keys_with_actions_and_enabled_flag() {
        let snapshot = assemble(&InspectionOptions::default());
        assert_eq!(snapshot.foreign_keys.len(), 2);

        let manager = &snapshot.foreign_keys[0];
        assert_eq!(manager.name, "FK_Employees_Manager");
        assert!(manager.is_self_referencing());
        assert!(!manager.is_enabled);
        assert_eq!(manager.on_delete, ReferentialAction::SetNull);
        assert_eq!(manager.on_update, ReferentialAction::SetDefault);

        let orders = &snapshot.foreign_keys[1];
        assert_eq!(
            orders.referencing_table,
            QualifiedName::new("sales", "Orders")
        );
        assert_eq!(
            orders.referenced_table,
            QualifiedName::new("dbo", "Customers")
        );
        assert_eq!(orders.on_delete, ReferentialAction::Cascade);
        assert_eq!(orders.on_update, ReferentialAction::NoAction);
        assert_eq!(orders.column_pairs[0].referencing_column, "CustomerId");
    }

    #[test]
    fn includes_views_with_their_columns_by_default() {
        let snapshot = assemble(&InspectionOptions::default());
        assert_eq!(snapshot.views.len(), 1);
        assert_eq!(snapshot.views[0].name.to_string(), "sales.RecentOrders");
        assert_eq!(snapshot.views[0].columns[0].name, "OrderId");
    }

    #[test]
    fn schema_filter_drops_objects_and_dangling_foreign_keys() {
        let options = InspectionOptions {
            schemas: vec!["sales".to_string()],
            include_views: false,
        };
        let snapshot = assemble(&options);

        assert_eq!(table_names(&snapshot), ["sales.Orders"]);
        assert_eq!(snapshot.views, []);
        // The Orders -> Customers key loses its referenced table and must not survive.
        assert_eq!(snapshot.foreign_keys, []);
    }

    #[test]
    fn carries_identity_through() {
        let snapshot = assemble(&InspectionOptions::default());
        assert_eq!(snapshot.database_name, "Northwind");
        assert_eq!(
            snapshot.server_version.as_deref(),
            Some("Microsoft SQL Server 2022")
        );
    }
}
