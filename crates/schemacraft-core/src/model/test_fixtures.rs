//! Hand-built snapshots shared by the unit tests of this crate.

use chrono::{Duration, TimeZone, Utc};

use super::{
    AccessCounts, AccessProbe, AccessProfile, CaptureScope, CaptureState, CarriedCode, CarriedFact,
    CarriedPart, CheckConstraint, CodeCapture, CodeObjectRef, Column, Completeness, Definition,
    DmlEvent, FiringOrder, ForeignKey, ForeignKeyColumnPair, ForeignKeyToInvisibleTable, Index,
    IndexKind, ModuleBody, Parameter, PrimaryKey, Programmability, QualifiedName,
    ReferentialAction, Routine, RoutineKind, SchemaAccess, SchemaSnapshot, SnapshotFact,
    SqlDataType, Table, Trigger, TriggerEvent, TriggerTiming, TypeLength, UnknownFields, View,
    ViewModule,
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
        has_visible_programmability: false,
        is_execute_denied: false,
    }
}

/// Profile of a login that reads everything, such as `db_owner`, after capturing `counts`.
pub(crate) fn full_profile(counts: AccessCounts) -> AccessProfile {
    let probe = AccessProbe {
        can_read_definitions: true,
        can_read_data: true,
        explicit_denials: Some(0),
        execute_denials: None,
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
        execute_denials: None,
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
            is_enabled: None,
        }),
        indexes: vec![Index {
            name: "UX_Customers_Name".to_string(),
            columns: vec!["Name".to_string()],
            kind: IndexKind::UniqueConstraint,
            is_clustered: false,
            included_columns: None,
            is_filtered: None,
            is_enabled: None,
        }],
        check_constraints: vec![CheckConstraint {
            name: "CK_Customers_Name".to_string(),
            expression: Definition::readable("(len([Name])>(0))"),
            is_enabled: Some(true),
            is_trusted: None,
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
            is_enabled: None,
        }),
        indexes: vec![Index {
            name: "IX_Orders_CustomerId".to_string(),
            columns: vec!["CustomerId".to_string()],
            kind: IndexKind::NonUnique,
            is_clustered: false,
            included_columns: None,
            is_filtered: None,
            is_enabled: None,
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
        is_trusted: None,
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
        programmability: None,
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
            is_trusted: None,
        }],
        ..sample
    };
    let counts = AccessCounts::of(&snapshot);
    with_access(snapshot, schema_reader_profile(&["sales"], counts))
}

fn parameter(name: &str, ordinal_position: u32, data_type: SqlDataType) -> Parameter {
    Parameter {
        name: name.to_string(),
        ordinal_position,
        data_type,
        is_output: false,
        is_read_only: false,
    }
}

/// A T-SQL and a CLR procedure, an encrypted scalar function and an inline table function whose
/// text the login cannot see, with a table-valued parameter.
fn sample_routines() -> Vec<Routine> {
    vec![
        Routine {
            name: QualifiedName::new("sales", "usp_PlaceOrder"),
            kind: RoutineKind::Procedure,
            body: ModuleBody::Sql {
                definition: Definition::readable(
                    "CREATE PROCEDURE sales.usp_PlaceOrder @CustomerId int, @OrderId int OUTPUT AS SET NOCOUNT ON;",
                ),
            },
            parameters: vec![
                parameter("@CustomerId", 1, SqlDataType::plain("int")),
                Parameter {
                    is_output: true,
                    ..parameter("@OrderId", 2, SqlDataType::plain("int"))
                },
            ],
            returns: None,
            columns: vec![],
        },
        Routine {
            name: QualifiedName::new("sales", "usp_ExportOrders"),
            kind: RoutineKind::Procedure,
            body: ModuleBody::Clr,
            parameters: vec![],
            returns: None,
            columns: vec![],
        },
        Routine {
            name: QualifiedName::new("dbo", "fn_CustomerName"),
            kind: RoutineKind::ScalarFunction,
            body: ModuleBody::Sql {
                definition: Definition::Encrypted,
            },
            parameters: vec![parameter("@CustomerId", 1, SqlDataType::plain("int"))],
            returns: Some(name_type()),
            columns: vec![],
        },
        Routine {
            name: QualifiedName::new("sales", "tvf_OrdersOf"),
            kind: RoutineKind::InlineTableFunction,
            body: ModuleBody::Sql {
                definition: Definition::NotVisible,
            },
            parameters: vec![Parameter {
                is_read_only: true,
                ..parameter(
                    "@Customers",
                    1,
                    SqlDataType {
                        user_defined_type_name: Some("dbo.IdList".to_string()),
                        ..SqlDataType::plain("table type")
                    },
                )
            }],
            returns: None,
            columns: vec![
                column("OrderId", 1, SqlDataType::plain("int"), false),
                column(
                    "Total",
                    2,
                    SqlDataType::with_precision_and_scale("decimal", 18, 2),
                    true,
                ),
            ],
        },
    ]
}

/// An `AFTER` trigger with an order per statement and a disabled `INSTEAD OF` trigger on the view,
/// whose text was not recorded.
fn sample_triggers(orders: &QualifiedName) -> Vec<Trigger> {
    vec![
        Trigger {
            parent: orders.clone(),
            name: "TR_Orders_Audit".to_string(),
            timing: TriggerTiming::After,
            events: vec![
                TriggerEvent {
                    event: DmlEvent::Insert,
                    order: FiringOrder::First,
                },
                TriggerEvent {
                    event: DmlEvent::Update,
                    order: FiringOrder::Last,
                },
                TriggerEvent {
                    event: DmlEvent::Delete,
                    order: FiringOrder::Unspecified,
                },
            ],
            is_enabled: true,
            is_not_for_replication: false,
            body: ModuleBody::Sql {
                definition: Definition::readable(
                    "CREATE TRIGGER sales.TR_Orders_Audit ON sales.Orders AFTER INSERT, UPDATE, DELETE AS SET NOCOUNT ON;",
                ),
            },
        },
        Trigger {
            parent: QualifiedName::new("sales", "RecentOrders"),
            name: "TR_RecentOrders_Insert".to_string(),
            timing: TriggerTiming::InsteadOf,
            events: vec![TriggerEvent {
                event: DmlEvent::Insert,
                order: FiringOrder::Unspecified,
            }],
            is_enabled: false,
            is_not_for_replication: true,
            body: ModuleBody::Sql {
                definition: Definition::NotRecorded,
            },
        },
    ]
}

/// Code of the sample schema with every kind of module and every text state: a view module, a
/// T-SQL and a CLR procedure, an encrypted scalar function, an inline table function whose text
/// the login cannot see, and two triggers, one with an order per event and one whose text was
/// not recorded. Three items were kept from an earlier read.
pub(crate) fn sample_programmability() -> Programmability {
    let read_at = Utc
        .with_ymd_and_hms(2026, 10, 12, 9, 0, 0)
        .single()
        .unwrap_or_default();
    let orders = QualifiedName::new("sales", "Orders");
    Programmability {
        capture: CodeCapture {
            objects: CaptureState::Read,
            definitions: CaptureState::Read,
        },
        views: vec![ViewModule {
            view: QualifiedName::new("sales", "RecentOrders"),
            definition: Definition::readable(
                "CREATE VIEW sales.RecentOrders WITH SCHEMABINDING AS\r\nSELECT o.OrderId FROM sales.Orders AS o",
            ),
            has_check_option: true,
            is_indexed: false,
        }],
        routines: sample_routines(),
        triggers: sample_triggers(&orders),
        carried_over: vec![
            CarriedCode {
                object: CodeObjectRef::Trigger {
                    parent: orders,
                    name: "TR_Orders_Audit".to_string(),
                },
                part: CarriedPart::Whole,
                read_at,
            },
            CarriedCode {
                object: CodeObjectRef::Routine {
                    name: QualifiedName::new("sales", "usp_PlaceOrder"),
                },
                part: CarriedPart::Definition,
                read_at,
            },
            CarriedCode {
                object: CodeObjectRef::View {
                    name: QualifiedName::new("sales", "RecentOrders"),
                },
                part: CarriedPart::Whole,
                read_at,
            },
        ],
        unknown: UnknownFields::new(),
    }
}

/// The sample schema, read by the `sales` reader, with every fact SchemaCraft 1.2 added
/// recorded: the code, the state of every index, key and constraint, and the code facts of the
/// access profile, which is judged again as a capture that read the code would judge it.
pub(crate) fn fully_populated_snapshot() -> SchemaSnapshot {
    fully_populated_from(reader_snapshot(), &Definition::NotVisible)
}

/// The sample schema read by a login that sees every table, view and `CHECK` and `DEFAULT` text,
/// with every fact SchemaCraft 1.2 added recorded as in [`fully_populated_snapshot`]: its level
/// is `full`, so a verdict that code lowered would show.
pub(crate) fn fully_populated_full_access_snapshot() -> SchemaSnapshot {
    fully_populated_from(sample_snapshot(), &Definition::readable("([OrderId]>(0))"))
}

/// `base` with every fact SchemaCraft 1.2 added recorded, an untrusted `CHECK` whose text is
/// `extra_check` on each table, and its access profile judged again with the code facts.
fn fully_populated_from(base: SchemaSnapshot, extra_check: &Definition) -> SchemaSnapshot {
    let mut snapshot = base;
    snapshot.programmability = Some(sample_programmability());
    for table in &mut snapshot.tables {
        if let Some(key) = table.primary_key.as_mut() {
            key.is_enabled = Some(true);
        }
        for index in &mut table.indexes {
            index.included_columns = Some(vec!["PlacedAt".to_string()]);
            index.is_filtered = Some(false);
            index.is_enabled = Some(false);
        }
        table.check_constraints.push(CheckConstraint {
            name: format!("CK_{}_Untrusted", table.name.name),
            expression: extra_check.clone(),
            is_enabled: Some(true),
            is_trusted: Some(false),
        });
    }
    let orders = QualifiedName::new("sales", "Orders");
    snapshot.foreign_keys.push(ForeignKey {
        name: "FK_Orders_Orders".to_string(),
        referencing_table: orders.clone(),
        referenced_table: orders.clone(),
        column_pairs: vec![ForeignKeyColumnPair {
            referencing_column: "OrderId".to_string(),
            referenced_column: "OrderId".to_string(),
        }],
        on_delete: ReferentialAction::NoAction,
        on_update: ReferentialAction::NoAction,
        is_enabled: true,
        is_trusted: Some(false),
    });
    for key in &mut snapshot.foreign_keys_to_invisible_tables {
        key.is_trusted = Some(true);
    }
    snapshot.carried_over.push(CarriedFact {
        object: orders,
        fact: SnapshotFact::ColumnDefault {
            column: "PlacedAt".to_string(),
        },
        read_at: snapshot.extracted_at - Duration::days(1),
    });

    let counts = AccessCounts::of(&snapshot);
    if let Some(profile) = snapshot.access.take() {
        let mut probe = profile.probe;
        probe.execute_denials = Some(1);
        for schema in &mut probe.schemas {
            schema.has_visible_programmability = true;
            schema.is_execute_denied = true;
        }
        let scope = CaptureScope {
            include_programmability: true,
            include_module_definitions: true,
            ..profile.scope
        };
        let mut judged = AccessProfile::observed(probe, scope, counts);
        judged.coverage.programmability = Some(Completeness::Partial);
        judged.coverage.module_definitions = Some(Completeness::NotAvailable);
        snapshot.access = Some(judged);
    }
    snapshot
}
