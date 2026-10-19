//! Turns catalog rows into a [`SchemaSnapshot`]. Pure and deterministic, so it is unit tested
//! without a database.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};

use super::bound_defaults::bound_default_expression;
use super::catalog::{
    CatalogRows, CheckConstraintRow, ColumnRow, ForeignKeyColumnRow, ForeignKeyRow, IndexColumnRow,
    IndexRow, ObjectKind, ObjectRow,
};
use super::data_types::{CatalogTypeInformation, data_type_from_catalog};
use crate::inspectors::InspectionOptions;
use crate::model::{
    AccessCounts, AccessProbe, AccessProfile, CaptureScope, CheckConstraint, Column, Definition,
    ForeignKey, ForeignKeyColumnPair, ForeignKeyToInvisibleTable, Index, IndexKind, PrimaryKey,
    QualifiedName, ReferentialAction, SchemaSnapshot, Table, UnknownFields, View,
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

/// Builds the snapshot, applying the schema and view filters of `options`, and records what the
/// login could see: the `probe` it was read with and what it found.
///
/// A text the login cannot read becomes [`Definition::NotVisible`], never an empty text. A
/// foreign key whose referenced table is visible but outside the selection is dropped: a
/// relationship edge needs both tables in the diagram. One whose referenced table the login
/// cannot see is kept in [`SchemaSnapshot::foreign_keys_to_invisible_tables`], because dropping
/// it would say the relationship does not exist.
pub(super) fn assemble_snapshot(
    rows: &CatalogRows,
    probe: AccessProbe,
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
        let IndexColumns {
            key,
            included: included_columns,
        } = index_columns
            .get(&(index_row.object_id, index_row.index_id))
            .map(|rows| IndexColumns::of(rows))
            .unwrap_or_default();
        if index_row.is_primary_key {
            primary_keys.insert(
                index_row.object_id,
                PrimaryKey {
                    name: index_row.index_name.clone(),
                    columns: key,
                    is_clustered: index_row.index_type == CLUSTERED_INDEX_TYPE,
                    is_enabled: Some(!index_row.is_disabled),
                },
            );
        } else {
            indexes.entry(index_row.object_id).or_default().push(Index {
                name: index_row.index_name.clone(),
                columns: key,
                kind: index_kind(index_row),
                is_clustered: index_row.index_type == CLUSTERED_INDEX_TYPE,
                included_columns: Some(included_columns),
                is_filtered: Some(index_row.has_filter),
                is_enabled: Some(!index_row.is_disabled),
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

    let AssembledForeignKeys {
        mut foreign_keys,
        mut to_invisible_tables,
    } = assemble_foreign_keys(rows, &included);
    foreign_keys.sort_by(|left, right| {
        (&left.referencing_table, &left.name).cmp(&(&right.referencing_table, &right.name))
    });
    to_invisible_tables.sort_by(|left, right| {
        (&left.referencing_table, &left.name).cmp(&(&right.referencing_table, &right.name))
    });

    let mut snapshot = SchemaSnapshot {
        database_name: identity.database_name,
        server_version: identity.server_version,
        extracted_at: identity.extracted_at,
        access: None,
        tables,
        views,
        foreign_keys,
        foreign_keys_to_invisible_tables: to_invisible_tables,
        carried_over: Vec::new(),
        // No code is read: absent says it was not captured, never that there is none.
        programmability: None,
        unknown: UnknownFields::new(),
    };
    let counts = AccessCounts::of(&snapshot);
    snapshot.access = Some(AccessProfile::observed(
        probe,
        CaptureScope::from(options),
        counts,
    ));
    snapshot
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
        default_expression: default_of(row),
        is_identity: row.is_identity,
        is_computed: row.is_computed,
    }
}

/// The default of a column: none, its text, or the fact that one exists whose text the login
/// cannot read.
fn default_of(row: &ColumnRow) -> Option<Definition> {
    if !row.has_default {
        return None;
    }
    let text = row.default_definition.clone().or_else(|| {
        row.bound_default_definition
            .as_deref()
            .map(bound_default_expression)
    });
    Some(text.map_or(Definition::NotVisible, Definition::readable))
}

fn group_index_columns(rows: &[IndexColumnRow]) -> BTreeMap<(i32, i32), Vec<&IndexColumnRow>> {
    let mut grouped: BTreeMap<(i32, i32), Vec<&IndexColumnRow>> = BTreeMap::new();
    for row in rows {
        grouped
            .entry((row.object_id, row.index_id))
            .or_default()
            .push(row);
    }
    grouped
}

/// The columns of one index, split as `CREATE INDEX` lists them.
#[derive(Default)]
struct IndexColumns {
    /// Key columns in key order: those with a `key_ordinal` from 1. The partitioning column SQL
    /// Server adds on its own to an aligned index has `key_ordinal` 0 and is not one of them.
    key: Vec<String>,
    /// `INCLUDE` columns in the order of the index.
    included: Vec<String>,
}

impl IndexColumns {
    fn of(rows: &[&IndexColumnRow]) -> Self {
        let mut key: Vec<&IndexColumnRow> = rows
            .iter()
            .copied()
            .filter(|row| row.key_ordinal > 0)
            .collect();
        key.sort_by_key(|row| row.key_ordinal);
        let mut included: Vec<&IndexColumnRow> = rows
            .iter()
            .copied()
            .filter(|row| row.is_included_column)
            .collect();
        included.sort_by_key(|row| row.index_column_id);
        let names = |rows: Vec<&IndexColumnRow>| -> Vec<String> {
            rows.into_iter()
                .map(|row| row.column_name.clone())
                .collect()
        };
        Self {
            key: names(key),
            included: names(included),
        }
    }
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
                expression: row
                    .definition
                    .clone()
                    .map_or(Definition::NotVisible, Definition::readable),
                is_enabled: Some(!row.is_disabled),
                is_trusted: Some(!row.is_not_trusted),
            });
    }
    grouped
}

/// Foreign keys of the included tables, split by whether the login sees the referenced table.
struct AssembledForeignKeys {
    foreign_keys: Vec<ForeignKey>,
    to_invisible_tables: Vec<ForeignKeyToInvisibleTable>,
}

fn assemble_foreign_keys(
    rows: &CatalogRows,
    included: &BTreeMap<i32, IncludedObject>,
) -> AssembledForeignKeys {
    let visible_objects: BTreeSet<i32> = rows.objects.iter().map(|row| row.object_id).collect();
    let mut pairs: BTreeMap<i32, Vec<&ForeignKeyColumnRow>> = BTreeMap::new();
    for row in &rows.foreign_key_columns {
        pairs.entry(row.constraint_object_id).or_default().push(row);
    }
    for key_columns in pairs.values_mut() {
        key_columns.sort_by_key(|row| row.constraint_column_id);
    }

    let mut assembled = AssembledForeignKeys {
        foreign_keys: Vec::new(),
        to_invisible_tables: Vec::new(),
    };
    for row in &rows.foreign_keys {
        // Foreign key rows follow their referencing table, so a key of a table the login
        // cannot see is never listed.
        let Some(referencing) = included.get(&row.parent_object_id) else {
            continue;
        };
        let column_rows = pairs.get(&row.object_id).map_or(&[][..], Vec::as_slice);
        match included.get(&row.referenced_object_id) {
            Some(referenced) => match column_pairs(column_rows) {
                Some(column_pairs) => assembled.foreign_keys.push(ForeignKey {
                    name: row.constraint_name.clone(),
                    referencing_table: referencing.name.clone(),
                    referenced_table: referenced.name.clone(),
                    column_pairs,
                    on_delete: referential_action(row.delete_referential_action),
                    on_update: referential_action(row.update_referential_action),
                    is_enabled: !row.is_disabled,
                    is_trusted: Some(!row.is_not_trusted),
                }),
                // A referenced column the login cannot see leaves the edge without an end, so
                // the key is kept the way keys to invisible tables are.
                None => assembled.to_invisible_tables.push(to_invisible_table(
                    row,
                    referencing,
                    column_rows,
                )),
            },
            // Visible but outside the selection: the edge has no other end in the diagram.
            None if visible_objects.contains(&row.referenced_object_id) => {}
            None => assembled.to_invisible_tables.push(to_invisible_table(
                row,
                referencing,
                column_rows,
            )),
        }
    }
    assembled
}

/// The column pairs of a key, or `None` when a referenced column is not visible.
fn column_pairs(rows: &[&ForeignKeyColumnRow]) -> Option<Vec<ForeignKeyColumnPair>> {
    rows.iter()
        .map(|pair| {
            Some(ForeignKeyColumnPair {
                referencing_column: pair.referencing_column.clone(),
                referenced_column: pair.referenced_column.clone()?,
            })
        })
        .collect()
}

fn to_invisible_table(
    row: &ForeignKeyRow,
    referencing: &IncludedObject,
    column_rows: &[&ForeignKeyColumnRow],
) -> ForeignKeyToInvisibleTable {
    ForeignKeyToInvisibleTable {
        name: row.constraint_name.clone(),
        referencing_table: referencing.name.clone(),
        columns: column_rows
            .iter()
            .map(|pair| pair.referencing_column.clone())
            .collect(),
        on_delete: referential_action(row.delete_referential_action),
        on_update: referential_action(row.update_referential_action),
        is_enabled: !row.is_disabled,
        is_trusted: Some(!row.is_not_trusted),
    }
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
    use crate::model::{
        AccessCounts, AccessLevel, AccessProbe, CaptureScope, Completeness, Definition, IndexKind,
        QualifiedName, ReferentialAction, SchemaAccess, SchemaSnapshot,
    };

    const CUSTOMERS: i32 = 100;
    const ORDERS: i32 = 200;
    const EMPLOYEES: i32 = 300;
    const RECENT_ORDERS_VIEW: i32 = 400;
    /// A table the login cannot see: referenced by keys, absent from the object rows.
    const REGIONS: i32 = 500;

    fn probe(can_read_definitions: bool) -> AccessProbe {
        let schema = |name: &str| SchemaAccess {
            name: name.to_string(),
            can_read_definitions,
            can_read_data: true,
            is_denied: false,
            has_visible_objects: true,
            has_visible_programmability: false,
            is_execute_denied: false,
        };
        AccessProbe {
            can_read_definitions,
            can_read_data: true,
            explicit_denials: Some(0),
            execute_denials: None,
            sees_objects: true,
            schemas: vec![schema("dbo"), schema("hr"), schema("sales")],
            database_user: Some("reporting".to_string()),
        }
    }

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
            has_default: false,
            default_definition: None,
            bound_default_definition: None,
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
            is_disabled: false,
            has_filter: false,
        }
    }

    /// A key column at `key_ordinal`, or an included column when it is 0.
    fn index_column(
        object_id: i32,
        index_id: i32,
        index_column_id: i32,
        name: &str,
        key_ordinal: u8,
    ) -> IndexColumnRow {
        IndexColumnRow {
            object_id,
            index_id,
            index_column_id,
            column_name: name.to_string(),
            key_ordinal,
            is_included_column: key_ordinal == 0,
        }
    }

    // One row per catalog row the tests read, listed in full so each test can change one.
    #[allow(clippy::too_many_lines)]
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
                column(ORDERS, 4, "RegionId", "int"),
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
                index_column(CUSTOMERS, 1, 1, "CustomerId", 1),
                index_column(CUSTOMERS, 2, 1, "Name", 1),
                // Composite key listed out of order, plus an included column that is no key.
                index_column(ORDERS, 1, 2, "LineNumber", 2),
                index_column(ORDERS, 1, 1, "OrderId", 1),
                index_column(ORDERS, 3, 1, "CustomerId", 1),
                index_column(ORDERS, 3, 2, "LineNumber", 0),
                index_column(EMPLOYEES, 1, 1, "EmployeeId", 1),
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
                    is_not_trusted: false,
                },
                ForeignKeyRow {
                    object_id: 1001,
                    constraint_name: "FK_Employees_Manager".to_string(),
                    parent_object_id: EMPLOYEES,
                    referenced_object_id: EMPLOYEES,
                    delete_referential_action: 2,
                    update_referential_action: 3,
                    is_disabled: true,
                    is_not_trusted: true,
                },
                ForeignKeyRow {
                    object_id: 1002,
                    constraint_name: "FK_Orders_Regions".to_string(),
                    parent_object_id: ORDERS,
                    referenced_object_id: REGIONS,
                    delete_referential_action: 0,
                    update_referential_action: 1,
                    is_disabled: false,
                    is_not_trusted: false,
                },
            ],
            foreign_key_columns: vec![
                ForeignKeyColumnRow {
                    constraint_object_id: 1000,
                    constraint_column_id: 1,
                    referencing_column: "CustomerId".to_string(),
                    referenced_column: Some("CustomerId".to_string()),
                },
                ForeignKeyColumnRow {
                    constraint_object_id: 1001,
                    constraint_column_id: 1,
                    referencing_column: "ManagerId".to_string(),
                    referenced_column: Some("EmployeeId".to_string()),
                },
                // The columns of a table the login cannot see are not visible either.
                ForeignKeyColumnRow {
                    constraint_object_id: 1002,
                    constraint_column_id: 1,
                    referencing_column: "RegionId".to_string(),
                    referenced_column: None,
                },
            ],
            check_constraints: vec![CheckConstraintRow {
                parent_object_id: ORDERS,
                constraint_name: "CK_Orders_LineNumber".to_string(),
                definition: Some("([LineNumber]>(0))".to_string()),
                is_disabled: false,
                is_not_trusted: false,
            }],
        }
    }

    fn assemble(options: &InspectionOptions) -> SchemaSnapshot {
        assemble_with(&sample_rows(), probe(true), options)
    }

    fn assemble_with(
        rows: &CatalogRows,
        probe: AccessProbe,
        options: &InspectionOptions,
    ) -> SchemaSnapshot {
        assemble_snapshot(
            rows,
            probe,
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
        assert_eq!(
            orders.check_constraints[0].expression,
            Definition::readable("([LineNumber]>(0))")
        );
        assert_eq!(orders.check_constraints[0].is_enabled, Some(true));

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
            ..InspectionOptions::default()
        };
        let snapshot = assemble(&options);

        assert_eq!(table_names(&snapshot), ["sales.Orders"]);
        assert_eq!(snapshot.views, []);
        // The Orders -> Customers key loses its referenced table and must not survive.
        assert_eq!(snapshot.foreign_keys, []);
        // The key to a table nobody can see is not the filter's doing, so it stays.
        let invisible: Vec<&str> = snapshot
            .foreign_keys_to_invisible_tables
            .iter()
            .map(|key| key.name.as_str())
            .collect();
        assert_eq!(invisible, ["FK_Orders_Regions"]);
    }

    #[test]
    fn keeps_foreign_keys_to_tables_the_login_cannot_see() {
        let snapshot = assemble(&InspectionOptions::default());

        let [regions] = snapshot.foreign_keys_to_invisible_tables.as_slice() else {
            panic!(
                "expected one key to an invisible table, got {:?}",
                snapshot.foreign_keys_to_invisible_tables
            );
        };
        assert_eq!(regions.name, "FK_Orders_Regions");
        assert_eq!(
            regions.referencing_table,
            QualifiedName::new("sales", "Orders")
        );
        assert_eq!(regions.columns, ["RegionId"]);
        assert_eq!(regions.on_delete, ReferentialAction::NoAction);
        assert_eq!(regions.on_update, ReferentialAction::Cascade);
        assert!(regions.is_enabled);
        assert!(snapshot.is_foreign_key_column(&QualifiedName::new("sales", "Orders"), "RegionId"));
    }

    #[test]
    fn a_key_whose_referenced_columns_are_hidden_is_kept_without_an_edge() {
        let mut rows = sample_rows();
        rows.foreign_key_columns[0].referenced_column = None;

        let snapshot = assemble_with(&rows, probe(false), &InspectionOptions::default());

        assert!(
            !snapshot
                .foreign_keys
                .iter()
                .any(|key| key.name == "FK_Orders_Customers")
        );
        assert!(
            snapshot
                .foreign_keys_to_invisible_tables
                .iter()
                .any(|key| key.name == "FK_Orders_Customers" && key.columns == ["CustomerId"])
        );
    }

    #[test]
    fn a_hidden_check_text_is_not_visible_and_never_empty() {
        let mut rows = sample_rows();
        rows.check_constraints[0].definition = None;
        rows.check_constraints[0].is_disabled = true;

        let snapshot = assemble_with(&rows, probe(false), &InspectionOptions::default());
        let orders = snapshot
            .table(&QualifiedName::new("sales", "Orders"))
            .unwrap();

        assert_eq!(
            orders.check_constraints[0].expression,
            Definition::NotVisible
        );
        assert_eq!(orders.check_constraints[0].is_enabled, Some(false));
    }

    #[test]
    fn defaults_tell_a_hidden_text_from_no_default() {
        let mut rows = sample_rows();
        let position = |rows: &CatalogRows, object_id: i32, name: &str| {
            rows.columns
                .iter()
                .position(|row| row.object_id == object_id && row.column_name == name)
                .unwrap()
        };
        let hidden = position(&rows, CUSTOMERS, "Name");
        rows.columns[hidden].has_default = true;
        let readable = position(&rows, ORDERS, "LineNumber");
        rows.columns[readable].has_default = true;
        rows.columns[readable].default_definition = Some("((1))".to_string());
        let bound = position(&rows, EMPLOYEES, "ManagerId");
        rows.columns[bound].has_default = true;
        rows.columns[bound].bound_default_definition =
            Some("CREATE DEFAULT dbo.NoManager AS 0;\r\n".to_string());

        let snapshot = assemble_with(&rows, probe(false), &InspectionOptions::default());
        let default_of = |table: &str, schema: &str, column: &str| {
            snapshot
                .table(&QualifiedName::new(schema, table))
                .and_then(|table| table.column(column))
                .unwrap()
                .default_expression
                .clone()
        };

        assert_eq!(
            default_of("Customers", "dbo", "Name"),
            Some(Definition::NotVisible)
        );
        assert_eq!(default_of("Customers", "dbo", "CustomerId"), None);
        assert_eq!(
            default_of("Orders", "sales", "LineNumber"),
            Some(Definition::readable("((1))"))
        );
        assert_eq!(
            default_of("Employees", "hr", "ManagerId"),
            Some(Definition::readable("0"))
        );
    }

    #[test]
    fn records_the_state_of_indexes_keys_and_constraints() {
        let mut rows = sample_rows();
        rows.indexes[1].is_disabled = true;
        rows.indexes[3].has_filter = true;
        rows.foreign_keys[0].is_not_trusted = true;
        rows.foreign_keys[2].is_not_trusted = true;
        rows.check_constraints[0].is_not_trusted = true;

        let snapshot = assemble_with(&rows, probe(true), &InspectionOptions::default());
        let customers = snapshot
            .table(&QualifiedName::new("dbo", "Customers"))
            .unwrap();
        let orders = snapshot
            .table(&QualifiedName::new("sales", "Orders"))
            .unwrap();

        assert_eq!(
            customers.primary_key.as_ref().unwrap().is_enabled,
            Some(true)
        );
        let unique = &customers.indexes[0];
        assert_eq!(
            (
                &unique.included_columns,
                unique.is_filtered,
                unique.is_enabled
            ),
            (&Some(vec![]), Some(false), Some(false))
        );
        let by_customer = &orders.indexes[0];
        assert_eq!(
            (
                &by_customer.included_columns,
                by_customer.is_filtered,
                by_customer.is_enabled
            ),
            (
                &Some(vec!["LineNumber".to_string()]),
                Some(true),
                Some(true)
            )
        );
        assert_eq!(orders.check_constraints[0].is_enabled, Some(true));
        assert_eq!(orders.check_constraints[0].is_trusted, Some(false));
        let trust: Vec<(&str, Option<bool>)> = snapshot
            .foreign_keys
            .iter()
            .map(|key| (key.name.as_str(), key.is_trusted))
            .collect();
        assert_eq!(
            trust,
            [
                ("FK_Employees_Manager", Some(false)),
                ("FK_Orders_Customers", Some(false))
            ]
        );
        assert_eq!(
            snapshot.foreign_keys_to_invisible_tables[0].is_trusted,
            Some(false)
        );
    }

    #[test]
    fn keeps_included_columns_in_index_order_and_drops_an_implicit_partition_column() {
        let mut rows = sample_rows();
        // An index aligned with a partitioned table: SQL Server lists the partitioning column it
        // added first, with key_ordinal 0 and not as an included column.
        rows.index_columns
            .retain(|row| !(row.object_id == ORDERS && row.index_id == 3));
        rows.index_columns.extend([
            IndexColumnRow {
                is_included_column: false,
                ..index_column(ORDERS, 3, 1, "RegionId", 0)
            },
            index_column(ORDERS, 3, 4, "OrderId", 0),
            index_column(ORDERS, 3, 2, "CustomerId", 1),
            index_column(ORDERS, 3, 3, "LineNumber", 0),
        ]);

        let snapshot = assemble_with(&rows, probe(true), &InspectionOptions::default());
        let index = &snapshot
            .table(&QualifiedName::new("sales", "Orders"))
            .unwrap()
            .indexes[0];

        assert_eq!(index.columns, ["CustomerId"]);
        assert_eq!(
            index.included_columns,
            Some(vec!["LineNumber".to_string(), "OrderId".to_string()])
        );
    }

    #[test]
    fn records_no_code_it_did_not_read() {
        let snapshot = assemble(&InspectionOptions::default());

        assert_eq!(snapshot.programmability, None);
        let access = snapshot.access.as_ref().unwrap();
        assert_eq!(access.probe.execute_denials, None);
        assert_eq!(access.coverage.programmability, None);
        assert_eq!(access.coverage.module_definitions, None);
        assert!(!access.scope.include_programmability);
    }

    #[test]
    fn records_what_the_login_could_see() {
        let mut rows = sample_rows();
        rows.check_constraints[0].definition = None;
        rows.columns[0].has_default = true;
        let options = InspectionOptions {
            schemas: vec!["dbo".to_string(), "sales".to_string()],
            include_views: true,
            ..InspectionOptions::default()
        };

        let snapshot = assemble_with(&rows, probe(false), &options);
        let access = snapshot.access.as_ref().unwrap();

        assert_eq!(
            access.counts,
            AccessCounts {
                definitions: 2,
                definitions_not_visible: 2,
                foreign_keys_to_invisible_tables: 1,
                ..AccessCounts::default()
            }
        );
        assert_eq!(access.scope, CaptureScope::from(&options));
        assert_eq!(access.level, AccessLevel::Partial);
        assert_eq!(access.coverage.objects, Completeness::Partial);
        assert_eq!(access.coverage.definitions, Completeness::NotAvailable);
        assert_eq!(access.probe, probe(false));
    }

    #[test]
    fn a_login_that_reads_everything_gets_a_full_profile() {
        let mut rows = sample_rows();
        rows.foreign_keys
            .retain(|row| row.referenced_object_id != REGIONS);

        let snapshot = assemble_with(&rows, probe(true), &InspectionOptions::default());
        let access = snapshot.access.as_ref().unwrap();

        assert_eq!(access.level, AccessLevel::Full);
        assert_eq!(access.counts.definitions, 1);
        assert_eq!(snapshot.foreign_keys_to_invisible_tables, []);
    }

    #[test]
    fn carries_identity_through() {
        let snapshot = assemble(&InspectionOptions::default());
        assert_eq!(snapshot.database_name, "Northwind");
        assert_eq!(
            snapshot.server_version.as_deref(),
            Some("Microsoft SQL Server 2022")
        );
        assert_eq!(snapshot.carried_over, []);
    }
}
