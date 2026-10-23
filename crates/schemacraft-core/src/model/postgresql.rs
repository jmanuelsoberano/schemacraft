//! Native PostgreSQL facts that have no honest SQL Server equivalent.
//!
//! These records supplement, rather than overwrite, the common relational model. Names remain
//! structured; catalog OIDs never survive as identity between captures. Module definitions live
//! in `programmability`, so projecting structural metadata cannot export source accidentally.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{CaptureState, CodeObjectRef, Definition, QualifiedName, RoutineDependencyTracking};

/// PostgreSQL evidence retained alongside the common relational snapshot.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlMetadata {
    /// Physical kinds of captured tables.
    pub tables: Vec<PostgresqlTable>,
    /// Native generation/type facts for columns.
    pub columns: Vec<PostgresqlColumn>,
    /// Ordinary/materialized view distinctions.
    pub views: Vec<PostgresqlView>,
    /// Index facts, including expression terms and validity, without module bodies.
    pub indexes: Vec<PostgresqlIndex>,
    /// Native constraint semantics and their reconstructed structural definitions.
    pub constraints: Vec<PostgresqlConstraint>,
    /// Routine language/argument metadata, without module source.
    pub routines: Vec<PostgresqlRoutine>,
    /// Trigger invocation metadata, without function bodies.
    pub triggers: Vec<PostgresqlTrigger>,
}

/// Physical table classification; partition administration is outside the application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlTable {
    /// Common table identity.
    pub name: QualifiedName,
    /// `ordinary`, `partitioned` or `partition`.
    pub kind: String,
}

/// Generation/type details do not substitute an IDENTITY flag for a serial default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlColumn {
    /// Owning table/view.
    pub object: QualifiedName,
    /// Column name.
    pub name: String,
    /// Qualified native type identity, preserving domains/enums and array types.
    pub type_name: QualifiedName,
    /// `base`, `domain`, `enum`, `composite`, `range`, `multirange`, `pseudo` or `unknown`.
    pub type_kind: String,
    /// `always` / `byDefault` for true identity columns; absent for serial/default columns.
    pub identity_generation: Option<String>,
    /// `stored` / `virtual` for generated columns.
    pub generation: Option<String>,
    /// Reconstructed generation expression; this is structural SQL, not a module body.
    pub generation_expression: Option<Definition>,
}

/// Ordinary and materialized views have different storage/refresh semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlView {
    /// Common view identity.
    pub name: QualifiedName,
    /// Whether the view stores rows physically.
    pub is_materialized: bool,
    /// Whether a materialized view has been populated; absent for an ordinary view.
    pub is_populated: Option<bool>,
    /// `none`, `local` or `cascaded` for ordinary views.
    pub check_option: String,
}

/// Native index state; invalid is not the same state as SQL Server disabled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
// Independent catalog or capture flags retain their native meanings.
#[allow(clippy::struct_excessive_bools)]
pub struct PostgresqlIndex {
    /// Owning relation.
    pub table: QualifiedName,
    /// Index identity (schema and name).
    pub name: QualifiedName,
    /// Access method, e.g. btree, gin, gist.
    pub method: String,
    /// Native reconstructed definition; includes all supported and unsupported index options.
    pub definition: Definition,
    /// Reconstructed key terms, retaining expressions, order and operator classes.
    pub key_terms: Vec<String>,
    /// Simple key column names; `None` denotes an expression term.
    pub key_columns: Vec<Option<String>>,
    /// Included columns, excluded from key semantics.
    pub included_columns: Vec<String>,
    /// Partial-index expression, if any.
    pub predicate: Option<Definition>,
    /// Whether the index declares uniqueness.
    pub is_unique: bool,
    /// Currently safe for queries and uniqueness conclusions.
    pub is_valid: bool,
    /// Currently maintained on writes.
    pub is_ready: bool,
    /// Not being dropped.
    pub is_live: bool,
    /// Whether NULL values are considered equal for uniqueness.
    pub nulls_not_distinct: bool,
    /// Last CLUSTER selection, never continuous SQL Server clustering.
    pub was_clustered: bool,
    /// Supporting primary/unique/exclusion constraint name, if any.
    pub constraint: Option<String>,
}

/// CHECK/FK/PK/UNIQUE/exclusion metadata, including constraints the diagram cannot fully explain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlConstraint {
    /// Owning table.
    pub table: QualifiedName,
    /// Constraint name, scoped to its table.
    pub name: String,
    /// `check`, `foreignKey`, `primaryKey`, `unique` or `exclusion`.
    pub kind: String,
    /// Native structural definition, reconstructed by PostgreSQL.
    pub definition: Definition,
    /// Whether validation of existing rows completed.
    pub is_validated: bool,
    /// Enforcement flag when the server version records it.
    pub is_enforced: Option<bool>,
    /// Whether checking can be deferred.
    pub is_deferrable: bool,
    /// Whether checking is initially deferred.
    pub is_initially_deferred: bool,
    /// `simple`/`full`/`partial` for foreign keys, absent for other constraints.
    pub match_type: Option<String>,
    /// Explicit ON DELETE SET NULL/DEFAULT column subset, if recorded.
    pub delete_set_columns: Vec<String>,
}

/// Routine metadata without source; the source remains under `programmability`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlRoutine {
    /// Stable overload-aware object identity.
    pub object: CodeObjectRef,
    /// Native implementation language, e.g. sql, plpgsql, c.
    pub language: String,
    /// Whether known SQL-body references supplement signature references. Missing in older
    /// files means not recorded; this is never a claim of complete runtime dependency discovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub routine_body_tracking: Option<RoutineDependencyTracking>,
    /// Whether the function returns a set.
    pub returns_set: bool,
    /// Reconstructed argument list, including modes/defaults, when definitions were requested.
    pub arguments: Option<String>,
    /// Reconstructed result declaration.
    pub result: Option<String>,
    /// Full argument modes in declaration order.
    pub argument_modes: Vec<String>,
    /// Whether the displayed source is a reconstructed CREATE statement.
    pub definition_is_reconstructed: bool,
}

/// Native trigger execution modes and function linkage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgresqlTrigger {
    /// Trigger identity, scoped to its parent.
    pub object: CodeObjectRef,
    /// Invoked function identity, omitted when an export excludes the routine.
    pub function: Option<CodeObjectRef>,
    /// `row` or `statement`.
    pub level: String,
    /// `origin`, `replica`, `always` or `disabled`.
    pub enabled_mode: String,
    /// Whether this is a user-defined constraint trigger.
    pub is_constraint: bool,
    /// Whether its constraint can be deferred.
    pub is_deferrable: bool,
    /// Whether its constraint is initially deferred.
    pub is_initially_deferred: bool,
    /// Columns named by UPDATE OF.
    pub update_columns: Vec<String>,
}

/// Native catalog visibility, not SQL Server VIEW DEFINITION/DENY emulation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgreSqlAccessEvidence {
    /// Structural object catalog was successfully read without privilege-filtering rows.
    pub object_catalog_read: bool,
    /// Routine/trigger catalog was successfully read without privilege-filtering rows.
    pub programmability_catalog_read: bool,
    /// Definition stage observation, independent of object listing.
    pub definitions: CaptureState,
    /// Schemas physically present in the catalog, with access details.
    pub schemas: Vec<PostgreSqlSchemaAccess>,
}

/// PostgreSQL schema access; metadata visibility does not imply data access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PostgreSqlSchemaAccess {
    /// Schema name.
    pub name: String,
    /// Whether this role may resolve objects through this schema.
    pub has_usage: bool,
    /// Whether the catalog records at least one supported table/view.
    pub has_visible_objects: bool,
    /// Whether the catalog records supported routines/triggers.
    pub has_visible_programmability: bool,
}

impl super::SchemaSnapshot {
    /// Keep native code metadata exactly when the common code ledger retained its object.
    /// The structural stage is mandatory; its native facts are never merged as guesses.
    pub(super) fn keep_unchecked_postgresql(&mut self, previous: &Self) {
        let Some(saved) = &previous.postgresql else {
            return;
        };
        let Some(native) = &mut self.postgresql else {
            return;
        };
        let retained: std::collections::BTreeSet<_> = self
            .programmability
            .iter()
            .flat_map(|code| &code.carried_over)
            .filter(|entry| entry.part == super::CarriedPart::Whole)
            .map(|entry| entry.object.clone())
            .collect();
        for routine in &saved.routines {
            if retained.contains(&routine.object)
                && !native
                    .routines
                    .iter()
                    .any(|entry| entry.object == routine.object)
            {
                native.routines.push(routine.clone());
            }
        }
        for trigger in &saved.triggers {
            if retained.contains(&trigger.object)
                && !native
                    .triggers
                    .iter()
                    .any(|entry| entry.object == trigger.object)
            {
                native.triggers.push(trigger.clone());
            }
        }
        native
            .routines
            .sort_by(|left, right| left.object.cmp(&right.object));
        native
            .triggers
            .sort_by(|left, right| left.object.cmp(&right.object));
    }
}
