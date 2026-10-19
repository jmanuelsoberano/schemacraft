//! Procedures, functions, triggers and the code of views, as one capture read them.
//!
//! Everything here lives under one snapshot-root key, [`SchemaSnapshot::programmability`], and
//! never inside a [`Table`] or a [`View`]:
//!
//! * exports rebuild the snapshot from the keys they know, so code cannot reach an export by
//!   accident;
//! * code objects are compared and kept on weaker refreshes as objects of their own, like
//!   foreign keys;
//! * the diagram and its geometry do not change;
//! * SchemaCraft 1.1, which keeps unknown snapshot-root keys as they are, opens a file that
//!   holds code read-only without misreading anything.
//!
//! Absent means not captured: a file written before 1.2 has no `programmability`, and its code
//! was never read, which is not the same as having none. [`Programmability`] keeps keys written by
//! a newer version, so later families (database triggers, synonyms, table types) can arrive
//! without raising the file's `minReaderVersion`. Every enum here reads a value written by a
//! newer version as `Unknown`.
//!
//! [`SchemaSnapshot::programmability`]: super::SchemaSnapshot::programmability
//! [`Table`]: super::Table
//! [`View`]: super::View

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Column, Definition, QualifiedName, SqlDataType, UnknownFields};

/// The programmable objects one capture read: the code of views, procedures and functions with
/// their parameters, and DML triggers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct Programmability {
    /// What the capture read of the objects and of their texts.
    pub capture: CodeCapture,
    /// The code of the snapshot's views.
    #[serde(default)]
    pub views: Vec<ViewModule>,
    /// Procedures and functions.
    #[serde(default)]
    pub routines: Vec<Routine>,
    /// DML triggers of the snapshot's tables and views.
    #[serde(default)]
    pub triggers: Vec<Trigger>,
    /// Code objects and texts kept from an earlier capture because this one could not check
    /// them, with the moment each was last read.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub carried_over: Vec<CarriedCode>,
    /// Keys written by a newer version, kept as they are.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

impl Programmability {
    /// The texts of every SQL module listed: views, and the procedures, functions and triggers
    /// written in T-SQL. CLR modules have no text.
    pub fn module_definitions(&self) -> impl Iterator<Item = &Definition> {
        self.views
            .iter()
            .map(|view| &view.definition)
            .chain(
                self.routines
                    .iter()
                    .filter_map(|routine| routine.body.definition()),
            )
            .chain(
                self.triggers
                    .iter()
                    .filter_map(|trigger| trigger.body.definition()),
            )
    }
}

/// What a capture read of the programmable objects. The two are separate because the texts can
/// be left out while the objects are read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct CodeCapture {
    /// The lists of view modules, procedures, functions, parameters and triggers.
    pub objects: CaptureState,
    /// The texts of the modules.
    pub definitions: CaptureState,
}

/// Whether a capture read one family of facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum CaptureState {
    /// The family was read, as far as the login could see it.
    Read,
    /// The family was not read; saved facts of it were not checked.
    NotRead {
        /// Why it was not read.
        reason: NotReadReason,
    },
    /// A state written by a newer version, read as "not known to have been read".
    #[serde(other)]
    Unknown,
}

/// Why a capture did not read a family of facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum NotReadReason {
    /// The inspection options left it out.
    OptionOff,
    /// The query that reads it failed.
    QueryFailed,
    /// The query that reads it ran out of time.
    TimedOut,
    /// A reason written by a newer version.
    #[serde(other)]
    Unknown,
}

/// The code of a view, which the diagram already shows as an object with columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct ViewModule {
    /// The view, an entry of the snapshot's views.
    pub view: QualifiedName,
    /// Its `CREATE VIEW` text, or why the text is missing.
    pub definition: Definition,
    /// Whether the view was created `WITH CHECK OPTION`, so rows changed through it must stay
    /// visible through it.
    pub has_check_option: bool,
    /// Whether the view has a unique clustered index, which stores its rows.
    pub is_indexed: bool,
}

/// A stored procedure or a user-defined function.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct Routine {
    /// Stable identity of the routine.
    pub name: QualifiedName,
    /// Procedure or kind of function.
    pub kind: RoutineKind,
    /// Its code, or the fact that it is a CLR module.
    pub body: ModuleBody,
    /// Parameters in declaration order, the return value excluded.
    #[serde(default)]
    pub parameters: Vec<Parameter>,
    /// Type a scalar function returns; `None` for procedures and table functions.
    pub returns: Option<SqlDataType>,
    /// Columns of the table a table function returns, in ordinal order; empty for the others.
    #[serde(default)]
    pub columns: Vec<Column>,
}

/// What a routine is, from its object type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum RoutineKind {
    /// A stored procedure (`P`, or `PC` in CLR).
    Procedure,
    /// A function that returns one value (`FN`, or `FS` in CLR).
    ScalarFunction,
    /// A function whose body is one `SELECT` (`IF`).
    InlineTableFunction,
    /// A function that fills and returns a table variable (`TF`, or `FT` in CLR).
    TableFunction,
    /// A CLR aggregate (`AF`).
    AggregateFunction,
    /// A kind written by a newer version.
    #[serde(other)]
    Unknown,
}

/// A parameter of a procedure or function.
///
/// It has no default: `sys.parameters` keeps a T-SQL parameter's default only in the module
/// text, so nothing here may say that a parameter has none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct Parameter {
    /// Name with its `@`, e.g. `@CustomerId`.
    pub name: String,
    /// One-based position in the declaration.
    pub ordinal_position: u32,
    /// Declared type; a table-valued parameter keeps the name of its table type.
    pub data_type: SqlDataType,
    /// Whether the parameter is declared `OUTPUT`.
    pub is_output: bool,
    /// Whether the parameter is declared `READONLY`, as every table-valued parameter is.
    pub is_read_only: bool,
}

/// A DML trigger of a table or view.
///
/// Its identity is its parent and its name: a DML trigger lives in its parent's schema.
// Each flag is an independent fact of the catalog; none of them implies another.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct Trigger {
    /// Table or view the trigger belongs to.
    pub parent: QualifiedName,
    /// Trigger name.
    pub name: String,
    /// Whether it runs after the statement or instead of it.
    pub timing: TriggerTiming,
    /// Statements that fire it, each with its firing order.
    #[serde(default)]
    pub events: Vec<TriggerEvent>,
    /// `false` when the trigger exists but is disabled.
    pub is_enabled: bool,
    /// Whether the trigger is created `NOT FOR REPLICATION`, so replication agents do not fire
    /// it.
    pub is_not_for_replication: bool,
    /// Its code, or the fact that it is a CLR module.
    pub body: ModuleBody,
}

/// When a DML trigger runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum TriggerTiming {
    /// After the statement, within its transaction.
    After,
    /// In place of the statement.
    InsteadOf,
    /// A timing written by a newer version.
    #[serde(other)]
    Unknown,
}

/// A statement that fires a trigger, and where the trigger runs among the others it fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct TriggerEvent {
    /// The statement.
    pub event: DmlEvent,
    /// The order set for this statement with `sp_settriggerorder`; it is per statement, so one
    /// trigger can be first on `INSERT` and last on `UPDATE`.
    pub order: FiringOrder,
}

/// A data modification statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum DmlEvent {
    /// `INSERT`.
    Insert,
    /// `UPDATE`.
    Update,
    /// `DELETE`.
    Delete,
    /// A statement written by a newer version.
    #[serde(other)]
    Unknown,
}

/// Where an `AFTER` trigger runs among the triggers one statement fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum FiringOrder {
    /// It runs first.
    First,
    /// It runs last.
    Last,
    /// No order was set; SQL Server picks one.
    Unspecified,
    /// An order written by a newer version.
    #[serde(other)]
    Unknown,
}

/// What a module is written in, with its text when it is T-SQL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "language", rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum ModuleBody {
    /// A T-SQL module.
    Sql {
        /// Its text as stored by the database, or why the text is missing.
        definition: Definition,
    },
    /// A module in a .NET assembly, whose code SQL Server does not keep as text.
    Clr,
    /// A language written by a newer version.
    #[serde(other)]
    Unknown,
}

impl ModuleBody {
    /// The text of a T-SQL module; `None` for a CLR module, which has none.
    pub fn definition(&self) -> Option<&Definition> {
        match self {
            Self::Sql { definition } => Some(definition),
            Self::Clr | Self::Unknown => None,
        }
    }
}

/// The identity of a code object, the same for comparing captures and for keeping it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum CodeObjectRef {
    /// The code of a view.
    View {
        /// The view.
        name: QualifiedName,
    },
    /// A procedure or function.
    Routine {
        /// The routine.
        name: QualifiedName,
    },
    /// A DML trigger.
    Trigger {
        /// Table or view the trigger belongs to.
        parent: QualifiedName,
        /// Trigger name.
        name: String,
    },
    /// An object written by a newer version.
    #[serde(other)]
    Unknown,
}

/// A code object or text kept from an earlier capture, and when it was last read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct CarriedCode {
    /// The object.
    pub object: CodeObjectRef,
    /// What of it was kept.
    pub part: CarriedPart,
    /// Moment of the extraction that last read it, in UTC.
    pub read_at: DateTime<Utc>,
}

/// What of a code object a capture kept from an earlier one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum CarriedPart {
    /// The object with everything it holds.
    Whole,
    /// Its text only; the rest was read.
    Definition,
    /// A part written by a newer version.
    #[serde(other)]
    Unknown,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};

    use super::{
        CaptureState, CarriedPart, CodeObjectRef, DmlEvent, FiringOrder, ModuleBody, NotReadReason,
        Programmability, RoutineKind, TriggerTiming,
    };
    use crate::model::Definition;
    use crate::model::test_fixtures::sample_programmability;

    #[test]
    fn survives_a_json_round_trip_with_every_variant() {
        let programmability = sample_programmability();
        let json = serde_json::to_value(&programmability).unwrap();

        assert_eq!(json["capture"]["objects"], json!({ "status": "read" }));
        assert_eq!(json["capture"]["definitions"], json!({ "status": "read" }));
        assert_eq!(json["views"][0]["hasCheckOption"], true);
        assert_eq!(json["routines"][0]["kind"], "procedure");
        assert_eq!(json["routines"][0]["body"]["language"], "sql");
        assert_eq!(json["routines"][0]["parameters"][0]["isOutput"], false);
        assert_eq!(json["routines"][1]["body"], json!({ "language": "clr" }));
        assert_eq!(json["triggers"][0]["timing"], "after");
        assert_eq!(json["triggers"][1]["timing"], "insteadOf");
        assert_eq!(json["triggers"][1]["isNotForReplication"], true);
        assert_eq!(
            json["triggers"][0]["events"][1],
            json!({ "event": "update", "order": "last" })
        );
        assert_eq!(
            json["carriedOver"][0]["object"],
            json!({ "kind": "trigger", "parent": { "schema": "sales", "name": "Orders" }, "name": "TR_Orders_Audit" })
        );
        assert_eq!(json["carriedOver"][1]["part"], "definition");

        let restored: Programmability = serde_json::from_value(json).unwrap();
        assert_eq!(restored, programmability);
    }

    #[test]
    fn every_value_of_the_enums_round_trips() {
        fn round_trips<T>(values: &[T])
        where
            T: serde::Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
        {
            for value in values {
                let json = serde_json::to_value(value).unwrap();
                assert_eq!(&serde_json::from_value::<T>(json).unwrap(), value);
            }
        }
        round_trips(&[
            CaptureState::Read,
            CaptureState::NotRead {
                reason: NotReadReason::OptionOff,
            },
            CaptureState::NotRead {
                reason: NotReadReason::QueryFailed,
            },
            CaptureState::NotRead {
                reason: NotReadReason::TimedOut,
            },
            CaptureState::Unknown,
        ]);
        round_trips(&[
            RoutineKind::Procedure,
            RoutineKind::ScalarFunction,
            RoutineKind::InlineTableFunction,
            RoutineKind::TableFunction,
            RoutineKind::AggregateFunction,
            RoutineKind::Unknown,
        ]);
        round_trips(&[
            TriggerTiming::After,
            TriggerTiming::InsteadOf,
            TriggerTiming::Unknown,
        ]);
        round_trips(&[
            DmlEvent::Insert,
            DmlEvent::Update,
            DmlEvent::Delete,
            DmlEvent::Unknown,
        ]);
        round_trips(&[
            FiringOrder::First,
            FiringOrder::Last,
            FiringOrder::Unspecified,
            FiringOrder::Unknown,
        ]);
        round_trips(&[
            ModuleBody::Sql {
                definition: Definition::Encrypted,
            },
            ModuleBody::Clr,
            ModuleBody::Unknown,
        ]);
        round_trips(&[
            CarriedPart::Whole,
            CarriedPart::Definition,
            CarriedPart::Unknown,
        ]);
        round_trips(&[CodeObjectRef::Unknown]);
    }

    fn read<T: DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_value_written_by_a_newer_version_reads_as_unknown() {
        assert_eq!(
            read::<CaptureState>(json!({ "status": "partlyRead", "share": 0.5 })),
            CaptureState::Unknown
        );
        assert_eq!(
            read::<CaptureState>(json!({ "status": "notRead", "reason": "quotaExceeded" })),
            CaptureState::NotRead {
                reason: NotReadReason::Unknown
            }
        );
        assert_eq!(
            read::<NotReadReason>(json!("cancelled")),
            NotReadReason::Unknown
        );
        assert_eq!(
            read::<RoutineKind>(json!("nativeProcedure")),
            RoutineKind::Unknown
        );
        assert_eq!(
            read::<TriggerTiming>(json!("before")),
            TriggerTiming::Unknown
        );
        assert_eq!(read::<DmlEvent>(json!("merge")), DmlEvent::Unknown);
        assert_eq!(read::<FiringOrder>(json!("second")), FiringOrder::Unknown);
        assert_eq!(
            read::<ModuleBody>(json!({ "language": "python", "source": "print()" })),
            ModuleBody::Unknown
        );
        assert_eq!(
            read::<CodeObjectRef>(
                json!({ "kind": "synonym", "name": { "schema": "dbo", "name": "S" } })
            ),
            CodeObjectRef::Unknown
        );
        assert_eq!(
            read::<CarriedPart>(json!("parameters")),
            CarriedPart::Unknown
        );
    }

    #[test]
    fn keys_written_by_a_newer_version_are_kept() {
        let mut json = serde_json::to_value(sample_programmability()).unwrap();
        json["synonyms"] = json!([{ "name": { "schema": "dbo", "name": "Clients" }, "target": "[dbo].[Customers]" }]);
        json["databaseTriggers"] = json!([]);

        let restored: Programmability = serde_json::from_value(json.clone()).unwrap();

        assert_eq!(restored.unknown.get("synonyms"), Some(&json["synonyms"]));
        assert_eq!(restored.unknown.len(), 2);
        assert_eq!(serde_json::to_value(&restored).unwrap(), json);
    }

    #[test]
    fn the_lists_are_optional_when_reading_and_carried_code_is_left_out_when_empty() {
        let restored: Programmability = read(json!({
            "capture": { "objects": { "status": "read" }, "definitions": { "status": "read" } }
        }));
        assert!(restored.views.is_empty() && restored.routines.is_empty());
        assert!(restored.triggers.is_empty() && restored.carried_over.is_empty());

        let written = serde_json::to_value(&restored).unwrap();
        assert!(written.get("carriedOver").is_none());
        assert_eq!(written["views"], json!([]));
    }

    #[test]
    fn module_definitions_are_the_texts_of_sql_modules_only() {
        let statuses: Vec<&str> = sample_programmability()
            .module_definitions()
            .map(|definition| match definition {
                Definition::Readable { .. } => "readable",
                Definition::NotVisible => "notVisible",
                Definition::Encrypted => "encrypted",
                Definition::NotRecorded => "notRecorded",
                Definition::Unknown => "unknown",
            })
            .collect();
        // The view, the T-SQL procedure (the CLR one has no text), the encrypted and the inline
        // functions, and the two triggers.
        assert_eq!(
            statuses,
            [
                "readable",
                "readable",
                "encrypted",
                "notVisible",
                "readable",
                "notRecorded"
            ]
        );
    }
}
