//! Turns what the code stage read into the snapshot's [`Programmability`]. Pure and
//! deterministic, so it is unit tested without a database.
//!
//! * Routines follow the schema filter; triggers follow their table or view, so the triggers of
//!   views go when views are left out; view modules belong to the views the snapshot holds.
//! * A module's text is readable, encrypted when `OBJECTPROPERTY` says `IsEncrypted` (its text is
//!   `NULL` for every login, the owner included), not visible when the login may see the module
//!   but not its text, and not recorded when the texts were not read.
//! * CLR modules (`PC`, `FS`, `FT`, `AF`, `TA`) have no T-SQL text, so their body says CLR.
//! * Every list is sorted: views and routines by name, triggers by table and name, parameters by
//!   position and events by statement.

use std::collections::{BTreeMap, BTreeSet};

use super::assembly::{IncludedObject, columns_by_object};
use super::catalog::{CatalogRows, ObjectKind};
use super::data_types::{CatalogTypeInformation, data_type_from_catalog};
use super::programmability::{
    CodePart, CodeRead, CodeRows, ModuleTexts, ParameterRow, TriggerEventRow, TriggerRow,
};
use crate::inspectors::InspectionOptions;
use crate::model::{
    CaptureState, CodeCapture, Definition, DmlEvent, FiringOrder, ModuleBody, NotReadReason,
    Parameter, Programmability, QualifiedName, Routine, RoutineKind, SqlDataType, Trigger,
    TriggerEvent, TriggerTiming, UnknownFields, ViewModule,
};

const CLUSTERED_INDEX_TYPE: u8 = 1;
/// `parameter_id` of the value a scalar function returns.
const RETURN_VALUE: i32 = 0;

/// The programmable objects of the snapshot, from what the code stage read. `included` holds the
/// tables and views the snapshot keeps, which triggers and view modules belong to.
pub(super) fn assemble_programmability(
    code: CodeRead,
    rows: &CatalogRows,
    included: &BTreeMap<i32, IncludedObject>,
    options: &InspectionOptions,
) -> Programmability {
    let capture = CodeCapture {
        objects: state_of(&code.objects),
        definitions: state_of(&code.definitions),
    };
    let CodePart::Read(code_rows) = code.objects else {
        return Programmability {
            capture,
            views: Vec::new(),
            routines: Vec::new(),
            triggers: Vec::new(),
            carried_over: Vec::new(),
            unknown: UnknownFields::new(),
        };
    };
    let mut texts = Texts {
        left_out: matches!(
            &code.definitions,
            CodePart::NotRead(NotReadReason::OptionOff)
        ),
        read: match code.definitions {
            CodePart::Read(texts) => Some(texts),
            CodePart::NotRead(_) => None,
        },
    };

    let mut views = view_modules(&code_rows, rows, included, &mut texts);
    let mut routines = routines(&code_rows, options, &mut texts);
    let mut triggers = triggers(&code_rows, included, &mut texts);
    views.sort_by(|left, right| left.view.cmp(&right.view));
    routines.sort_by(|left, right| left.name.cmp(&right.name));
    triggers.sort_by(|left, right| (&left.parent, &left.name).cmp(&(&right.parent, &right.name)));

    Programmability {
        capture,
        views,
        routines,
        triggers,
        carried_over: Vec::new(),
        unknown: UnknownFields::new(),
    }
}

fn state_of<T>(part: &CodePart<T>) -> CaptureState {
    match part {
        CodePart::Read(_) => CaptureState::Read,
        CodePart::NotRead(reason) => CaptureState::NotRead { reason: *reason },
    }
}

/// The module texts the stage read, handed out once each.
struct Texts {
    /// The user deliberately chose not to record module definitions.
    left_out: bool,
    /// `None` when the texts were not read.
    read: Option<ModuleTexts>,
}

impl Texts {
    /// The text of a module, from the row of its text and what the catalog says of encryption.
    fn definition(&mut self, object_id: i32, is_encrypted: Option<i32>) -> Definition {
        if self.left_out {
            return Definition::NotRecorded;
        }
        if is_encrypted == Some(1) {
            return Definition::Encrypted;
        }
        let Some(texts) = self.read.as_mut() else {
            return Definition::NotRecorded;
        };
        let text = texts.remove(&object_id).flatten();
        match text {
            Some(text) => Definition::readable(text),
            // A metadata row without visible text never proves that no text exists.
            None => Definition::NotVisible,
        }
    }
}

fn view_modules(
    code_rows: &CodeRows,
    rows: &CatalogRows,
    included: &BTreeMap<i32, IncludedObject>,
    texts: &mut Texts,
) -> Vec<ViewModule> {
    let clustered: BTreeSet<i32> = rows
        .indexes
        .iter()
        .filter(|index| index.index_type == CLUSTERED_INDEX_TYPE)
        .map(|index| index.object_id)
        .collect();
    code_rows
        .objects
        .iter()
        .filter(|object| object.object_type == "V")
        .filter_map(|object| {
            let view = included
                .get(&object.object_id)
                .filter(|view| view.kind == ObjectKind::View)?;
            Some(ViewModule {
                view: view.name.clone(),
                definition: texts.definition(object.object_id, object.is_encrypted),
                has_check_option: object.has_check_option,
                // A view with a clustered index stores its rows.
                is_indexed: clustered.contains(&object.object_id),
            })
        })
        .collect()
}

fn routines(code_rows: &CodeRows, options: &InspectionOptions, texts: &mut Texts) -> Vec<Routine> {
    let mut parameters: BTreeMap<i32, Vec<&ParameterRow>> = BTreeMap::new();
    for row in &code_rows.parameters {
        parameters.entry(row.object_id).or_default().push(row);
    }
    let mut columns = columns_by_object(&code_rows.columns, |_| true);
    // Returned columns describe the result shape, not the defaults of the function's internal
    // table variable. Keep the shared Column type without persisting those implementation texts.
    for column in columns.values_mut().flatten() {
        column.default_expression = None;
    }

    code_rows
        .objects
        .iter()
        .filter(|object| object.object_type != "V" && options.includes_schema(&object.schema_name))
        .map(|object| {
            let (kind, is_clr) = routine_kind(&object.object_type);
            let body = match (kind, is_clr) {
                (RoutineKind::Unknown, _) => ModuleBody::Unknown,
                (_, true) => ModuleBody::Clr,
                (_, false) => ModuleBody::Sql {
                    definition: texts.definition(object.object_id, object.is_encrypted),
                },
            };
            let mut declared = parameters.remove(&object.object_id).unwrap_or_default();
            declared.sort_by_key(|row| row.parameter_id);
            let returns = declared
                .iter()
                .find(|row| {
                    row.parameter_id == RETURN_VALUE
                        && matches!(
                            kind,
                            RoutineKind::ScalarFunction | RoutineKind::AggregateFunction
                        )
                })
                .map(|row| parameter_type(row));
            Routine {
                identity_arguments: None,
                name: QualifiedName::new(&object.schema_name, &object.object_name),
                kind,
                body,
                parameters: declared
                    .iter()
                    .filter(|row| row.parameter_id > RETURN_VALUE)
                    .map(|row| parameter(row))
                    .collect(),
                returns,
                columns: columns.remove(&object.object_id).unwrap_or_default(),
            }
        })
        .collect()
}

/// The kind of a routine from its `sys.objects` type, and whether it is a CLR module:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-objects-transact-sql
fn routine_kind(object_type: &str) -> (RoutineKind, bool) {
    match object_type {
        "P" => (RoutineKind::Procedure, false),
        "PC" => (RoutineKind::Procedure, true),
        "FN" => (RoutineKind::ScalarFunction, false),
        "FS" => (RoutineKind::ScalarFunction, true),
        "IF" => (RoutineKind::InlineTableFunction, false),
        "TF" => (RoutineKind::TableFunction, false),
        "FT" => (RoutineKind::TableFunction, true),
        "AF" => (RoutineKind::AggregateFunction, true),
        _ => (RoutineKind::Unknown, false),
    }
}

fn parameter(row: &ParameterRow) -> Parameter {
    Parameter {
        name: row.parameter_name.clone(),
        ordinal_position: u32::try_from(row.parameter_id).unwrap_or(u32::MAX),
        data_type: parameter_type(row),
        is_output: row.is_output,
        is_read_only: row.is_readonly,
    }
}

/// The type of a parameter. A table-valued parameter is `table` with the name of its table type;
/// a type the login cannot see keeps no name it was not given.
fn parameter_type(row: &ParameterRow) -> SqlDataType {
    match (&row.system_type_name, row.is_table_type) {
        (_, true) => SqlDataType {
            user_defined_type_name: row.user_type_name.clone(),
            ..SqlDataType::plain("table")
        },
        (Some(system_type_name), false) => data_type_from_catalog(CatalogTypeInformation {
            system_type_name,
            user_defined_type_name: row.user_type_name.as_deref(),
            max_length: row.max_length,
            precision: row.precision,
            scale: row.scale,
        }),
        (None, false) => SqlDataType {
            user_defined_type_name: row.user_type_name.clone(),
            ..SqlDataType::plain("unknown")
        },
    }
}

fn triggers(
    code_rows: &CodeRows,
    included: &BTreeMap<i32, IncludedObject>,
    texts: &mut Texts,
) -> Vec<Trigger> {
    let mut events: BTreeMap<i32, Vec<&TriggerEventRow>> = BTreeMap::new();
    for row in &code_rows.trigger_events {
        events.entry(row.object_id).or_default().push(row);
    }
    code_rows
        .triggers
        .iter()
        .filter_map(|row| {
            // A trigger of a table or view the snapshot does not hold goes with it.
            let parent = included.get(&row.parent_id)?;
            let mut fired_by = events.remove(&row.object_id).unwrap_or_default();
            fired_by.sort_by_key(|event| match event.event_type.as_str() {
                "INSERT" => 0,
                "UPDATE" => 1,
                "DELETE" => 2,
                _ => 3,
            });
            Some(Trigger {
                parent: parent.name.clone(),
                name: row.trigger_name.clone(),
                timing: if row.is_instead_of_trigger {
                    TriggerTiming::InsteadOf
                } else {
                    TriggerTiming::After
                },
                events: fired_by.into_iter().map(trigger_event).collect(),
                is_enabled: !row.is_disabled,
                is_not_for_replication: row.is_not_for_replication,
                body: trigger_body(row, texts),
            })
        })
        .collect()
}

fn trigger_body(row: &TriggerRow, texts: &mut Texts) -> ModuleBody {
    match row.trigger_type.as_str() {
        "TR" => ModuleBody::Sql {
            definition: texts.definition(row.object_id, row.is_encrypted),
        },
        "TA" => ModuleBody::Clr,
        _ => ModuleBody::Unknown,
    }
}

/// A statement and the order set for it: `is_first` and `is_last` are per statement:
/// https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-settriggerorder-transact-sql
fn trigger_event(row: &TriggerEventRow) -> TriggerEvent {
    TriggerEvent {
        event: match row.event_type.as_str() {
            "INSERT" => DmlEvent::Insert,
            "UPDATE" => DmlEvent::Update,
            "DELETE" => DmlEvent::Delete,
            _ => DmlEvent::Unknown,
        },
        order: match (row.is_first, row.is_last) {
            (true, false) => FiringOrder::First,
            (false, true) => FiringOrder::Last,
            (false, false) => FiringOrder::Unspecified,
            // A trigger cannot run both first and last; the catalog would be saying something new.
            (true, true) => FiringOrder::Unknown,
        },
    }
}

/// A row of a view, procedure or function that is not encrypted, for the tests of the assembly.
#[cfg(test)]
fn code_object(
    object_id: i32,
    schema: &str,
    name: &str,
    object_type: &str,
) -> super::programmability::CodeObjectRow {
    super::programmability::CodeObjectRow {
        object_id,
        schema_name: schema.to_string(),
        object_name: name.to_string(),
        object_type: object_type.to_string(),
        has_check_option: false,
        is_encrypted: Some(0),
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing,
        clippy::too_many_lines
    )]

    use std::time::Duration;

    use chrono::{TimeZone, Utc};

    use super::code_object;
    use crate::inspectors::InspectionOptions;
    use crate::inspectors::sqlserver::assembly::{SnapshotIdentity, assemble_snapshot};
    use crate::inspectors::sqlserver::catalog::{
        CatalogRows, ColumnRow, IndexRow, ObjectKind, ObjectRow,
    };
    use crate::inspectors::sqlserver::programmability::{
        CodeObjectRow, CodePart, CodeRead, CodeRows, ModuleTexts, ParameterRow, TriggerEventRow,
        TriggerRow,
    };
    use crate::model::{
        AccessCounts, AccessProbe, CaptureState, Completeness, Definition, DmlEvent, FiringOrder,
        ModuleBody, NotReadReason, Programmability, RoutineKind, SchemaAccess, SchemaSnapshot,
        SqlDataType, TriggerTiming,
    };

    const ORDERS: i32 = 10;
    const AUDIT: i32 = 11;
    const OPEN_ORDERS: i32 = 20;
    const TOTALS: i32 = 21;
    const SECRET_VIEW: i32 = 22;
    const PLACE_ORDER: i32 = 30;
    const SECRET: i32 = 31;
    const TAX: i32 = 32;
    const ORDERS_OF: i32 = 33;
    const LINES_OF: i32 = 34;
    const CLR_PROCEDURE: i32 = 35;
    const CLR_SCALAR: i32 = 36;
    const CLR_TABLE: i32 = 37;
    const CLR_AGGREGATE: i32 = 38;
    const HIDDEN_TEXT: i32 = 39;
    const DBO_PROCEDURE: i32 = 40;
    const NEWER_KIND: i32 = 41;
    const AUDIT_TRIGGER: i32 = 50;
    const ORDERS_TRIGGER: i32 = 51;
    const VIEW_TRIGGER: i32 = 52;
    const CLR_TRIGGER: i32 = 53;
    const DISABLED_TRIGGER: i32 = 54;

    fn object(object_id: i32, schema: &str, name: &str, kind: ObjectKind) -> ObjectRow {
        ObjectRow {
            object_id,
            schema_name: schema.to_string(),
            object_name: name.to_string(),
            kind,
        }
    }

    fn catalog() -> CatalogRows {
        CatalogRows {
            objects: vec![
                object(ORDERS, "app", "Orders", ObjectKind::Table),
                object(AUDIT, "audit", "OrderAudit", ObjectKind::Table),
                object(OPEN_ORDERS, "app", "OpenOrders", ObjectKind::View),
                object(TOTALS, "app", "OrderTotals", ObjectKind::View),
                object(SECRET_VIEW, "app", "SecretView", ObjectKind::View),
            ],
            indexes: vec![IndexRow {
                object_id: TOTALS,
                index_id: 1,
                index_name: "UX_OrderTotals".to_string(),
                index_type: 1,
                is_unique: true,
                is_primary_key: false,
                is_unique_constraint: false,
                is_disabled: false,
                has_filter: false,
            }],
            ..CatalogRows::default()
        }
    }

    fn parameter(
        object_id: i32,
        parameter_id: i32,
        name: &str,
        system_type_name: Option<&str>,
    ) -> ParameterRow {
        ParameterRow {
            object_id,
            parameter_id,
            parameter_name: name.to_string(),
            system_type_name: system_type_name.map(str::to_string),
            user_type_name: None,
            is_table_type: false,
            max_length: 4,
            precision: 10,
            scale: 0,
            is_output: false,
            is_readonly: false,
        }
    }

    fn trigger(object_id: i32, parent_id: i32, name: &str, trigger_type: &str) -> TriggerRow {
        TriggerRow {
            object_id,
            parent_id,
            trigger_name: name.to_string(),
            trigger_type: trigger_type.to_string(),
            is_disabled: false,
            is_not_for_replication: false,
            is_instead_of_trigger: false,
            is_encrypted: Some(0),
        }
    }

    fn event(object_id: i32, event_type: i32, is_first: bool, is_last: bool) -> TriggerEventRow {
        TriggerEventRow {
            object_id,
            event_type: match event_type {
                1 => "INSERT",
                2 => "UPDATE",
                3 => "DELETE",
                _ => "FUTURE_EVENT",
            }
            .to_string(),
            is_first,
            is_last,
        }
    }

    fn column(object_id: i32, column_id: i32, name: &str) -> ColumnRow {
        ColumnRow {
            object_id,
            column_id,
            column_name: name.to_string(),
            system_type_name: "int".to_string(),
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

    /// Every kind of routine and trigger the catalog has, T-SQL and CLR, listed out of order.
    fn code_rows() -> CodeRows {
        CodeRows {
            objects: vec![
                code_object(TAX, "app", "fn_Tax", "FN"),
                code_object(PLACE_ORDER, "app", "usp_PlaceOrder", "P"),
                code_object(SECRET, "app", "usp_Secret", "P"),
                code_object(ORDERS_OF, "app", "fn_OrdersOf", "IF"),
                code_object(LINES_OF, "app", "fn_LinesOf", "TF"),
                code_object(CLR_PROCEDURE, "app", "clr_Export", "PC"),
                code_object(CLR_SCALAR, "app", "clr_Hash", "FS"),
                code_object(CLR_TABLE, "app", "clr_Split", "FT"),
                code_object(CLR_AGGREGATE, "app", "clr_Concat", "AF"),
                code_object(HIDDEN_TEXT, "app", "usp_Hidden", "P"),
                code_object(DBO_PROCEDURE, "dbo", "usp_Maintenance", "P"),
                code_object(NEWER_KIND, "app", "x_Newer", "XZ"),
                CodeObjectRow {
                    has_check_option: true,
                    ..code_object(OPEN_ORDERS, "app", "OpenOrders", "V")
                },
                code_object(TOTALS, "app", "OrderTotals", "V"),
                CodeObjectRow {
                    is_encrypted: Some(1),
                    ..code_object(SECRET_VIEW, "app", "SecretView", "V")
                },
            ]
            .into_iter()
            .map(|mut row| {
                if row.object_id == SECRET {
                    row.is_encrypted = Some(1);
                }
                if row.object_id == HIDDEN_TEXT {
                    // OBJECTPROPERTY answered NULL: not known to be encrypted.
                    row.is_encrypted = None;
                }
                row
            })
            .collect(),
            triggers: vec![
                TriggerRow {
                    is_not_for_replication: true,
                    ..trigger(ORDERS_TRIGGER, ORDERS, "TR_Orders_Write", "TR")
                },
                TriggerRow {
                    is_encrypted: Some(1),
                    ..trigger(AUDIT_TRIGGER, AUDIT, "TR_Audit", "TR")
                },
                TriggerRow {
                    is_instead_of_trigger: true,
                    ..trigger(VIEW_TRIGGER, OPEN_ORDERS, "TR_OpenOrders_Insert", "TR")
                },
                trigger(CLR_TRIGGER, ORDERS, "TR_Orders_Clr", "TA"),
                TriggerRow {
                    is_disabled: true,
                    ..trigger(DISABLED_TRIGGER, ORDERS, "TR_Orders_Disabled", "TR")
                },
            ],
            trigger_events: vec![
                // Listed out of order; first on INSERT and last on UPDATE at once.
                event(ORDERS_TRIGGER, 2, false, true),
                event(ORDERS_TRIGGER, 1, true, false),
                event(ORDERS_TRIGGER, 3, false, false),
                event(VIEW_TRIGGER, 1, false, false),
                event(CLR_TRIGGER, 7, true, true),
            ],
            parameters: vec![
                ParameterRow {
                    is_output: true,
                    ..parameter(PLACE_ORDER, 2, "@OrderId", Some("int"))
                },
                parameter(PLACE_ORDER, 1, "@CustomerId", Some("int")),
                ParameterRow {
                    is_table_type: true,
                    is_readonly: true,
                    max_length: -1,
                    user_type_name: Some("app.OrderLineType".to_string()),
                    ..parameter(PLACE_ORDER, 3, "@Lines", Some("table"))
                },
                ParameterRow {
                    is_output: true,
                    max_length: 9,
                    precision: 18,
                    scale: 2,
                    ..parameter(TAX, 0, "", Some("decimal"))
                },
                ParameterRow {
                    max_length: 9,
                    precision: 18,
                    scale: 2,
                    ..parameter(TAX, 1, "@Amount", Some("decimal"))
                },
                ParameterRow {
                    user_type_name: None,
                    ..parameter(ORDERS_OF, 1, "@CustomerId", None)
                },
            ],
            columns: vec![
                column(LINES_OF, 2, "Quantity"),
                column(LINES_OF, 1, "LineNumber"),
                column(ORDERS_OF, 1, "OrderId"),
            ],
        }
    }

    fn texts() -> ModuleTexts {
        [
            (
                PLACE_ORDER,
                Some("CREATE PROCEDURE app.usp_PlaceOrder AS SELECT 1;"),
            ),
            (SECRET, None),
            (TAX, Some("CREATE FUNCTION app.fn_Tax ...")),
            (ORDERS_OF, Some("CREATE FUNCTION app.fn_OrdersOf ...")),
            (LINES_OF, Some("CREATE FUNCTION app.fn_LinesOf ...")),
            (HIDDEN_TEXT, None),
            (
                DBO_PROCEDURE,
                Some("CREATE PROCEDURE dbo.usp_Maintenance AS SELECT 1;"),
            ),
            (
                OPEN_ORDERS,
                Some("CREATE VIEW app.OpenOrders AS SELECT 1 WITH CHECK OPTION;"),
            ),
            (
                TOTALS,
                Some("CREATE VIEW app.OrderTotals WITH SCHEMABINDING AS SELECT 1;"),
            ),
            (SECRET_VIEW, None),
            (
                ORDERS_TRIGGER,
                Some("CREATE TRIGGER app.TR_Orders_Write ..."),
            ),
            (AUDIT_TRIGGER, None),
            (
                VIEW_TRIGGER,
                Some("CREATE TRIGGER app.TR_OpenOrders_Insert ..."),
            ),
            // TR_Orders_Disabled has no row: it was dropped between the queries.
        ]
        .into_iter()
        .map(|(object_id, text)| (object_id, text.map(str::to_string)))
        .collect()
    }

    fn read_everything() -> CodeRead {
        CodeRead {
            objects: CodePart::Read(code_rows()),
            definitions: CodePart::Read(texts()),
            elapsed: Duration::from_millis(12),
        }
    }

    fn probe() -> AccessProbe {
        let schema = |name: &str| SchemaAccess {
            name: name.to_string(),
            can_read_definitions: true,
            can_read_data: true,
            is_denied: false,
            has_visible_objects: true,
            has_visible_programmability: true,
            is_execute_denied: false,
        };
        AccessProbe {
            can_read_definitions: true,
            can_read_data: true,
            explicit_denials: Some(0),
            execute_denials: Some(0),
            sees_objects: true,
            schemas: vec![schema("app"), schema("audit"), schema("dbo")],
            database_user: Some("dbo".to_string()),
        }
    }

    fn assemble(code: CodeRead, options: &InspectionOptions) -> SchemaSnapshot {
        assemble_snapshot(
            &catalog(),
            probe(),
            options,
            SnapshotIdentity {
                database_name: "SchemaCraftCode".to_string(),
                server_version: None,
                extracted_at: Utc.with_ymd_and_hms(2026, 10, 18, 12, 0, 0).unwrap(),
            },
            code,
        )
    }

    fn code_of(snapshot: &SchemaSnapshot) -> &Programmability {
        snapshot.programmability.as_ref().unwrap()
    }

    fn definition_of<'a>(code: &'a Programmability, name: &str) -> Option<&'a Definition> {
        code.routines
            .iter()
            .find(|routine| routine.name.name == name)
            .unwrap_or_else(|| panic!("no routine {name}"))
            .body
            .definition()
    }

    #[test]
    fn maps_every_kind_of_routine_from_its_type_code() {
        let snapshot = assemble(read_everything(), &InspectionOptions::default());
        let code = code_of(&snapshot);

        let kinds: Vec<(String, RoutineKind, &str)> = code
            .routines
            .iter()
            .map(|routine| {
                let language = match routine.body {
                    ModuleBody::PostgreSql { .. } => "postgresql",
                    ModuleBody::Sql { .. } => "sql",
                    ModuleBody::Clr => "clr",
                    ModuleBody::Unknown => "unknown",
                };
                (routine.name.to_string(), routine.kind, language)
            })
            .collect();
        assert_eq!(
            kinds,
            [
                (
                    "app.clr_Concat".to_string(),
                    RoutineKind::AggregateFunction,
                    "clr"
                ),
                ("app.clr_Export".to_string(), RoutineKind::Procedure, "clr"),
                (
                    "app.clr_Hash".to_string(),
                    RoutineKind::ScalarFunction,
                    "clr"
                ),
                (
                    "app.clr_Split".to_string(),
                    RoutineKind::TableFunction,
                    "clr"
                ),
                (
                    "app.fn_LinesOf".to_string(),
                    RoutineKind::TableFunction,
                    "sql"
                ),
                (
                    "app.fn_OrdersOf".to_string(),
                    RoutineKind::InlineTableFunction,
                    "sql"
                ),
                ("app.fn_Tax".to_string(), RoutineKind::ScalarFunction, "sql"),
                ("app.usp_Hidden".to_string(), RoutineKind::Procedure, "sql"),
                (
                    "app.usp_PlaceOrder".to_string(),
                    RoutineKind::Procedure,
                    "sql"
                ),
                ("app.usp_Secret".to_string(), RoutineKind::Procedure, "sql"),
                // A type code this version does not know.
                ("app.x_Newer".to_string(), RoutineKind::Unknown, "unknown"),
                (
                    "dbo.usp_Maintenance".to_string(),
                    RoutineKind::Procedure,
                    "sql"
                ),
            ]
        );
        assert_eq!(code.capture.objects, CaptureState::Read);
        assert_eq!(code.capture.definitions, CaptureState::Read);
        assert_eq!(code.carried_over, []);
    }

    #[test]
    fn tells_an_encrypted_text_from_one_that_is_not_visible_or_not_recorded() {
        let snapshot = assemble(read_everything(), &InspectionOptions::default());
        let code = code_of(&snapshot);

        assert_eq!(
            definition_of(code, "usp_PlaceOrder"),
            Some(&Definition::readable(
                "CREATE PROCEDURE app.usp_PlaceOrder AS SELECT 1;"
            ))
        );
        assert_eq!(
            definition_of(code, "usp_Secret"),
            Some(&Definition::Encrypted)
        );
        // NULL text, and OBJECTPROPERTY did not say it was encrypted.
        assert_eq!(
            definition_of(code, "usp_Hidden"),
            Some(&Definition::NotVisible)
        );
        assert_eq!(definition_of(code, "clr_Export"), None);

        let views: Vec<(String, &Definition, bool, bool)> = code
            .views
            .iter()
            .map(|view| {
                (
                    view.view.to_string(),
                    &view.definition,
                    view.has_check_option,
                    view.is_indexed,
                )
            })
            .collect();
        assert_eq!(
            views,
            [
                (
                    "app.OpenOrders".to_string(),
                    &Definition::readable(
                        "CREATE VIEW app.OpenOrders AS SELECT 1 WITH CHECK OPTION;"
                    ),
                    true,
                    false
                ),
                (
                    "app.OrderTotals".to_string(),
                    &Definition::readable(
                        "CREATE VIEW app.OrderTotals WITH SCHEMABINDING AS SELECT 1;"
                    ),
                    false,
                    true
                ),
                (
                    "app.SecretView".to_string(),
                    &Definition::Encrypted,
                    false,
                    false
                ),
            ]
        );

        let trigger_texts: Vec<(&str, Option<&Definition>)> = code
            .triggers
            .iter()
            .map(|trigger| (trigger.name.as_str(), trigger.body.definition()))
            .collect();
        assert_eq!(
            trigger_texts,
            [
                (
                    "TR_OpenOrders_Insert",
                    Some(&Definition::readable(
                        "CREATE TRIGGER app.TR_OpenOrders_Insert ..."
                    ))
                ),
                ("TR_Orders_Clr", None),
                // No row of its text: not visible, never empty.
                ("TR_Orders_Disabled", Some(&Definition::NotVisible)),
                (
                    "TR_Orders_Write",
                    Some(&Definition::readable(
                        "CREATE TRIGGER app.TR_Orders_Write ..."
                    ))
                ),
                ("TR_Audit", Some(&Definition::Encrypted)),
            ]
        );

        // The counts of the profile: CLR modules have no text, encrypted ones are never a gap.
        let access = snapshot.access.as_ref().unwrap();
        assert_eq!(
            access.counts,
            AccessCounts {
                module_definitions: 14,
                module_definitions_not_visible: 2,
                module_definitions_encrypted: 3,
                ..AccessCounts::default()
            }
        );
        assert!(access.scope.include_programmability);
        assert!(access.scope.include_module_definitions);
        assert_eq!(
            access.coverage.programmability,
            Some(Completeness::Complete)
        );
        assert_eq!(
            access.coverage.module_definitions,
            Some(Completeness::Partial)
        );
    }

    #[test]
    fn maps_parameters_return_types_table_valued_parameters_and_columns() {
        let snapshot = assemble(read_everything(), &InspectionOptions::default());
        let code = code_of(&snapshot);
        let routine = |name: &str| {
            code.routines
                .iter()
                .find(|routine| routine.name.name == name)
                .unwrap()
        };

        let place_order = routine("usp_PlaceOrder");
        let parameters: Vec<(&str, u32, String, bool, bool)> = place_order
            .parameters
            .iter()
            .map(|parameter| {
                (
                    parameter.name.as_str(),
                    parameter.ordinal_position,
                    parameter.data_type.declaration(),
                    parameter.is_output,
                    parameter.is_read_only,
                )
            })
            .collect();
        assert_eq!(
            parameters,
            [
                ("@CustomerId", 1, "INT".to_string(), false, false),
                ("@OrderId", 2, "INT".to_string(), true, false),
                ("@Lines", 3, "TABLE".to_string(), false, true),
            ]
        );
        assert_eq!(
            place_order.parameters[2]
                .data_type
                .user_defined_type_name
                .as_deref(),
            Some("app.OrderLineType")
        );
        assert_eq!(place_order.returns, None);

        // The return value is the type, never a parameter.
        let tax = routine("fn_Tax");
        assert_eq!(tax.parameters.len(), 1);
        assert_eq!(
            tax.returns,
            Some(SqlDataType::with_precision_and_scale("decimal", 18, 2))
        );

        // A type the login cannot see is not given a name.
        let orders_of = routine("fn_OrdersOf");
        assert_eq!(
            orders_of.parameters[0].data_type,
            SqlDataType::plain("unknown")
        );
        let column_names = |name: &str| -> Vec<(String, u32)> {
            routine(name)
                .columns
                .iter()
                .map(|column| (column.name.clone(), column.ordinal_position))
                .collect()
        };
        assert_eq!(
            column_names("fn_LinesOf"),
            [("LineNumber".to_string(), 1), ("Quantity".to_string(), 2)]
        );
        assert_eq!(column_names("fn_OrdersOf"), [("OrderId".to_string(), 1)]);
        assert_eq!(column_names("usp_PlaceOrder"), []);
    }

    #[test]
    fn table_function_columns_keep_structure_and_leave_defaults_in_the_body() {
        let mut rows = code_rows();
        let quantity = rows
            .columns
            .iter_mut()
            .find(|column| column.object_id == LINES_OF && column.column_name == "Quantity")
            .unwrap();
        quantity.has_default = true;
        quantity.default_definition = Some("((4))".to_string());
        let body = "CREATE FUNCTION app.fn_LinesOf() RETURNS @Items TABLE (LineNumber int, Quantity int DEFAULT (4) NOT NULL) AS BEGIN RETURN; END;";
        let mut module_texts = texts();
        module_texts.insert(LINES_OF, Some(body.to_string()));
        let snapshot = assemble(
            CodeRead {
                objects: CodePart::Read(rows),
                definitions: CodePart::Read(module_texts),
                elapsed: Duration::ZERO,
            },
            &InspectionOptions::default(),
        );
        let routine = code_of(&snapshot)
            .routines
            .iter()
            .find(|routine| routine.name.name == "fn_LinesOf")
            .unwrap();
        assert_eq!(routine.columns.len(), 2);
        let quantity = &routine.columns[1];
        assert_eq!(quantity.name, "Quantity");
        assert_eq!(quantity.ordinal_position, 2);
        assert_eq!(quantity.data_type, SqlDataType::plain("int"));
        assert!(!quantity.is_nullable);
        assert!(
            routine
                .columns
                .iter()
                .all(|column| column.default_expression.is_none())
        );
        assert_eq!(
            routine.body.definition().and_then(Definition::text),
            Some(body)
        );
    }

    #[test]
    fn maps_triggers_with_their_timing_state_and_order_per_event() {
        let snapshot = assemble(read_everything(), &InspectionOptions::default());
        let code = code_of(&snapshot);

        let names: Vec<(String, &str)> = code
            .triggers
            .iter()
            .map(|trigger| (trigger.parent.to_string(), trigger.name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                ("app.OpenOrders".to_string(), "TR_OpenOrders_Insert"),
                ("app.Orders".to_string(), "TR_Orders_Clr"),
                ("app.Orders".to_string(), "TR_Orders_Disabled"),
                ("app.Orders".to_string(), "TR_Orders_Write"),
                ("audit.OrderAudit".to_string(), "TR_Audit"),
            ]
        );
        let write = &code.triggers[3];
        assert_eq!(write.timing, TriggerTiming::After);
        assert!(write.is_enabled && write.is_not_for_replication);
        let events: Vec<(DmlEvent, FiringOrder)> = write
            .events
            .iter()
            .map(|event| (event.event, event.order))
            .collect();
        assert_eq!(
            events,
            [
                (DmlEvent::Insert, FiringOrder::First),
                (DmlEvent::Update, FiringOrder::Last),
                (DmlEvent::Delete, FiringOrder::Unspecified),
            ]
        );
        assert_eq!(code.triggers[0].timing, TriggerTiming::InsteadOf);
        assert!(!code.triggers[2].is_enabled);
        assert_eq!(code.triggers[2].events, []);
        // A statement or an order this version does not know.
        assert_eq!(code.triggers[1].body, ModuleBody::Clr);
        assert_eq!(code.triggers[1].events[0].event, DmlEvent::Unknown);
        assert_eq!(code.triggers[1].events[0].order, FiringOrder::Unknown);
    }

    #[test]
    fn the_schema_filter_and_the_views_option_scope_the_code() {
        let options = InspectionOptions {
            schemas: vec!["app".to_string()],
            include_views: false,
            ..InspectionOptions::default()
        };
        let snapshot = assemble(read_everything(), &options);
        let code = code_of(&snapshot);

        assert!(
            code.routines
                .iter()
                .all(|routine| routine.name.schema == "app")
        );
        assert_eq!(code.views, []);
        // The triggers of views go with the views, and those of tables out of scope with them.
        let names: Vec<&str> = code
            .triggers
            .iter()
            .map(|trigger| trigger.name.as_str())
            .collect();
        assert_eq!(
            names,
            ["TR_Orders_Clr", "TR_Orders_Disabled", "TR_Orders_Write"]
        );
    }

    #[test]
    fn texts_left_out_are_not_recorded_and_the_rest_is_read() {
        let options = InspectionOptions {
            include_module_definitions: false,
            ..InspectionOptions::default()
        };
        let snapshot = assemble(
            CodeRead {
                objects: CodePart::Read(code_rows()),
                definitions: CodePart::NotRead(NotReadReason::OptionOff),
                elapsed: Duration::ZERO,
            },
            &options,
        );
        let code = code_of(&snapshot);

        assert_eq!(code.capture.objects, CaptureState::Read);
        assert_eq!(
            code.capture.definitions,
            CaptureState::NotRead {
                reason: NotReadReason::OptionOff
            }
        );
        assert_eq!(code.routines.len(), 12);
        assert_eq!(
            definition_of(code, "usp_PlaceOrder"),
            Some(&Definition::NotRecorded)
        );
        // Leaving texts out records the same state for every SQL body.
        assert_eq!(
            definition_of(code, "usp_Secret"),
            Some(&Definition::NotRecorded)
        );
        let access = snapshot.access.as_ref().unwrap();
        assert!(access.scope.include_programmability);
        assert!(!access.scope.include_module_definitions);
        assert_eq!(
            access.coverage.programmability,
            Some(Completeness::Complete)
        );
        assert_eq!(access.coverage.module_definitions, None);
    }

    #[test]
    fn code_left_out_is_recorded_as_left_out_and_never_as_none() {
        let options = InspectionOptions {
            include_programmability: false,
            ..InspectionOptions::default()
        };
        let snapshot = assemble(CodeRead::option_off(), &options);
        let code = code_of(&snapshot);

        let off = CaptureState::NotRead {
            reason: NotReadReason::OptionOff,
        };
        assert_eq!(
            (&code.capture.objects, &code.capture.definitions),
            (&off, &off)
        );
        assert!(code.views.is_empty() && code.routines.is_empty() && code.triggers.is_empty());
        let access = snapshot.access.as_ref().unwrap();
        assert!(!access.scope.include_programmability);
        assert_eq!(access.coverage.programmability, None);
        assert_eq!(access.coverage.module_definitions, None);
        assert_eq!(access.counts.module_definitions, 0);
    }

    #[test]
    fn a_failed_code_stage_is_recorded_as_not_read_and_judges_nothing() {
        for reason in [NotReadReason::QueryFailed, NotReadReason::TimedOut] {
            let snapshot = assemble(
                CodeRead {
                    objects: CodePart::NotRead(reason),
                    definitions: CodePart::NotRead(reason),
                    elapsed: Duration::from_secs(1),
                },
                &InspectionOptions::default(),
            );
            let code = code_of(&snapshot);
            let failed = CaptureState::NotRead { reason };
            assert_eq!(code.capture.objects, failed);
            assert_eq!(code.capture.definitions, failed);
            assert_eq!(code.routines, Vec::<crate::model::Routine>::new());
            let access = snapshot.access.as_ref().unwrap();
            assert!(!access.scope.include_programmability);
            assert_eq!(access.coverage.programmability, None);
            // The tables and views are read as ever.
            assert_eq!(snapshot.tables.len(), 2);
            assert_eq!(snapshot.views.len(), 3);
        }

        // Only the texts failed: the objects are read, their texts not recorded.
        let snapshot = assemble(
            CodeRead {
                objects: CodePart::Read(code_rows()),
                definitions: CodePart::NotRead(NotReadReason::QueryFailed),
                elapsed: Duration::ZERO,
            },
            &InspectionOptions::default(),
        );
        let code = code_of(&snapshot);
        assert_eq!(code.capture.objects, CaptureState::Read);
        assert_eq!(
            definition_of(code, "fn_Tax"),
            Some(&Definition::NotRecorded)
        );
        assert_eq!(
            definition_of(code, "usp_Secret"),
            Some(&Definition::Encrypted)
        );
        let access = snapshot.access.as_ref().unwrap();
        assert!(access.scope.include_programmability);
        assert!(!access.scope.include_module_definitions);
        assert_eq!(access.coverage.module_definitions, None);
    }

    #[test]
    fn the_same_rows_give_the_same_code() {
        let reversed = || {
            let mut rows = code_rows();
            rows.objects.reverse();
            rows.triggers.reverse();
            rows.trigger_events.reverse();
            rows.parameters.reverse();
            rows.columns.reverse();
            CodeRead {
                objects: CodePart::Read(rows),
                definitions: CodePart::Read(texts()),
                elapsed: Duration::ZERO,
            }
        };
        assert_eq!(
            code_of(&assemble(reversed(), &InspectionOptions::default())),
            code_of(&assemble(read_everything(), &InspectionOptions::default()))
        );
    }
}
