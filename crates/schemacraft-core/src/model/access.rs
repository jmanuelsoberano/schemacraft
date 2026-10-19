//! What a login can see of a database, and how complete a capture made with it is.
//!
//! An inspector reads the raw permission facts once per database ([`AccessProbe`]); the rules
//! here turn them into a level and a per-fact coverage. The rules are pure so that the
//! connection dialog, the snapshot and the refresh agree on every case.
//!
//! The level is judged over the tables and views and the `CHECK` and `DEFAULT` texts only. The
//! coverage of procedures, functions, triggers and their texts is reported next to it and never
//! changes it, so every verdict a capture made before 1.2 keeps its meaning.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Definition, Programmability, SchemaSnapshot};

/// Permission facts about the login in one database, as the server reports them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct AccessProbe {
    /// Whether the login holds `VIEW DEFINITION` on the whole database, granted or inherited.
    pub can_read_definitions: bool,
    /// Whether the login holds `SELECT` on the whole database, granted or inherited.
    pub can_read_data: bool,
    /// Explicit denials that can hide objects or their texts, for the login and its roles;
    /// none for a login that enters as the database owner, which no denial applies to.
    /// `None` when the login cannot see its own denials, so some may exist.
    pub explicit_denials: Option<u32>,
    /// Explicit denials of `EXECUTE` for the login and its roles, at the database, schema and
    /// object level. They hide a procedure or function from a login that sees it only through
    /// `EXECUTE`, never from one that holds `VIEW DEFINITION`, which is the only kind of login
    /// that can list every procedure and function (`tests/sqlserver_permissions.rs` pins both on
    /// SQL Server 2019 and 2022). `None` when the probe did not count them, as before 1.2, or the
    /// login cannot see its own denials; either way some may exist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub execute_denials: Option<u32>,
    /// Whether the login sees at least one user table or view.
    pub sees_objects: bool,
    /// Per-schema facts, for the schemas the login can see.
    pub schemas: Vec<SchemaAccess>,
    /// Database user the login maps to, used to name it in a `GRANT` script; `None` when the
    /// login reaches the database without a user of its own, or cannot tell.
    pub database_user: Option<String>,
}

/// Permission facts about the login in one schema.
// Each flag is an independent fact reported by the server; none of them implies another.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct SchemaAccess {
    /// Schema name.
    pub name: String,
    /// Whether the login holds `VIEW DEFINITION` on the schema, granted or inherited.
    pub can_read_definitions: bool,
    /// Whether the login holds `SELECT` on the schema, granted or inherited.
    pub can_read_data: bool,
    /// Whether an explicit denial on the schema can hide some of its objects or texts.
    pub is_denied: bool,
    /// Whether the login sees at least one user table or view in the schema.
    pub has_visible_objects: bool,
    /// Whether the login sees at least one procedure or function in the schema; `false` as well
    /// when the probe did not ask, as before 1.2.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_visible_programmability: bool,
    /// Whether an explicit denial of `EXECUTE` on the schema itself can hide some of its
    /// procedures and functions from a login without `VIEW DEFINITION`; `false` as well when the
    /// probe did not ask, as before 1.2. Denials on single objects are counted in
    /// [`AccessProbe::execute_denials`] only, since a hidden object's schema cannot be named.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_execute_denied: bool,
}

/// Overall verdict on what a login sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum AccessLevel {
    /// Every object and every text is visible.
    Full,
    /// Something is missing: objects, texts or both.
    Partial,
    /// The login could see every object, and the database has none.
    Empty,
    /// The login sees no table or view, and cannot tell whether the database is empty.
    NothingVisible,
}

/// How much of one kind of fact a capture holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum Completeness {
    /// Everything there is.
    Complete,
    /// Some of it; the rest may exist but is not visible.
    Partial,
    /// None of it could be read.
    NotAvailable,
}

/// Completeness per kind of fact. Columns, keys, indexes and foreign keys of a visible table
/// need no extra permission, so only the object list and the expression texts can be partial.
///
/// The code coverages are reported apart: they never change the level ([`Self::is_full`]), and
/// an export, which says nothing of code, never carries them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct AccessCoverage {
    /// Tables and views.
    pub objects: Completeness,
    /// `CHECK` and `DEFAULT` texts.
    pub definitions: Completeness,
    /// Procedures, functions and triggers; `None` when the capture did not judge them: it did
    /// not read them, or it was made before 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub programmability: Option<Completeness>,
    /// Texts of views, procedures, functions and triggers; `None` when the capture did not
    /// judge them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub module_definitions: Option<Completeness>,
}

impl AccessCoverage {
    /// Coverage of the objects and the `CHECK` and `DEFAULT` texts, with no judgement on code.
    pub fn of_objects_and_texts(objects: Completeness, definitions: Completeness) -> Self {
        Self {
            objects,
            definitions,
            programmability: None,
            module_definitions: None,
        }
    }

    /// Whether the capture holds every table and view and every `CHECK` and `DEFAULT` text,
    /// which is what the level `full` means. The code coverages take no part: a login that
    /// misses procedures still reads the diagram whole.
    pub fn is_full(&self) -> bool {
        self.objects == Completeness::Complete && self.definitions == Completeness::Complete
    }
}

/// What a capture found, counted over the objects it kept.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct AccessCounts {
    /// `CHECK` and `DEFAULT` expressions, readable or not. Module texts are counted apart.
    pub definitions: u32,
    /// Expressions whose text the login cannot see.
    pub definitions_not_visible: u32,
    /// Foreign keys that reference a table the login cannot see.
    pub foreign_keys_to_invisible_tables: u32,
    /// Texts of views, procedures, functions and triggers written in T-SQL, readable or not;
    /// zero when the capture read no code.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub module_definitions: u32,
    /// Module texts the login cannot see.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub module_definitions_not_visible: u32,
    /// Encrypted module texts, which the catalog returns to no login.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub module_definitions_encrypted: u32,
}

// serde hands `skip_serializing_if` the field by reference.
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(count: &u32) -> bool {
    *count == 0
}

impl AccessCounts {
    /// Counts the expressions, the foreign keys to invisible tables and the module texts of
    /// `snapshot`.
    pub fn of(snapshot: &SchemaSnapshot) -> Self {
        let definitions: Vec<&Definition> = snapshot
            .tables
            .iter()
            .flat_map(|table| {
                table
                    .columns
                    .iter()
                    .filter_map(|column| column.default_expression.as_ref())
                    .chain(
                        table
                            .check_constraints
                            .iter()
                            .map(|constraint| &constraint.expression),
                    )
            })
            .chain(snapshot.views.iter().flat_map(|view| {
                view.columns
                    .iter()
                    .filter_map(|column| column.default_expression.as_ref())
            }))
            .collect();
        let not_visible = definitions
            .iter()
            .filter(|definition| matches!(definition, Definition::NotVisible))
            .count();
        let modules: Vec<&Definition> = snapshot
            .programmability
            .iter()
            .flat_map(Programmability::module_definitions)
            .collect();
        let modules_where = |status: fn(&Definition) -> bool| {
            saturating_count(
                modules
                    .iter()
                    .filter(|definition| status(definition))
                    .count(),
            )
        };
        Self {
            definitions: saturating_count(definitions.len()),
            definitions_not_visible: saturating_count(not_visible),
            foreign_keys_to_invisible_tables: saturating_count(
                snapshot.foreign_keys_to_invisible_tables.len(),
            ),
            module_definitions: saturating_count(modules.len()),
            module_definitions_not_visible: modules_where(|definition| {
                matches!(definition, Definition::NotVisible)
            }),
            module_definitions_encrypted: modules_where(|definition| {
                matches!(definition, Definition::Encrypted)
            }),
        }
    }
}

fn saturating_count(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// The part of a database a capture was asked to read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct CaptureScope {
    /// Schemas the capture was limited to; empty means every schema.
    pub schemas: Vec<String>,
    /// Whether views were read alongside tables.
    pub include_views: bool,
    /// Whether procedures, functions and triggers were read: asked for, and read without a
    /// failure. `false` for every capture that did not read them, those made before 1.2 included,
    /// so the coverage of code is judged only where code was read.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_programmability: bool,
    /// Whether the texts of views, procedures, functions and triggers were read, as
    /// `include_programmability` says of the objects; `false` for every capture that did not
    /// read them.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_module_definitions: bool,
}

impl CaptureScope {
    /// Every schema, views included, and no code.
    pub fn everything() -> Self {
        Self {
            schemas: Vec::new(),
            include_views: true,
            include_programmability: false,
            include_module_definitions: false,
        }
    }

    /// Every schema, views included, with the procedures, functions and triggers and their
    /// texts: what a capture with the default options reads.
    pub fn everything_with_code() -> Self {
        Self {
            include_programmability: true,
            include_module_definitions: true,
            ..Self::everything()
        }
    }

    /// Whether objects of `schema` were asked for.
    pub fn includes_schema(&self, schema: &str) -> bool {
        self.schemas.is_empty() || self.schemas.iter().any(|included| included == schema)
    }
}

/// What a capture could see, frozen when it was made: the probe facts, the scope they were
/// judged in and the verdicts derived from both.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct AccessProfile {
    /// Raw permission facts.
    pub probe: AccessProbe,
    /// Part of the database the verdicts cover.
    pub scope: CaptureScope,
    /// Overall verdict.
    pub level: AccessLevel,
    /// Completeness per kind of fact.
    pub coverage: AccessCoverage,
    /// What the capture found; zero for a prediction made before reading anything.
    pub counts: AccessCounts,
}

impl AccessProfile {
    /// What a capture of the whole database with the default options would see, code included,
    /// judged from the permissions alone. The connection dialog shows it before anything is
    /// read.
    pub fn predicted(probe: AccessProbe) -> Self {
        let scope = CaptureScope::everything_with_code();
        let counts = AccessCounts::default();
        let texts = Texts {
            definitions: predicted_definitions(&probe),
            module_definitions: predicted_module_definitions(&probe),
        };
        Self::judged(probe, scope, counts, texts)
    }

    /// What a finished capture saw, given the scope it read and what it found. The coverage of
    /// code is judged only for the families the scope says were read.
    pub fn observed(probe: AccessProbe, scope: CaptureScope, counts: AccessCounts) -> Self {
        let texts = Texts {
            definitions: observed_definitions(counts),
            module_definitions: observed_module_definitions(counts),
        };
        Self::judged(probe, scope, counts, texts)
    }

    fn judged(probe: AccessProbe, scope: CaptureScope, counts: AccessCounts, texts: Texts) -> Self {
        let Texts {
            definitions,
            module_definitions,
        } = texts;
        let objects = objects_coverage(&probe, &scope, counts);
        let (level, mut coverage) = if probe.sees_objects {
            let coverage = AccessCoverage::of_objects_and_texts(objects, definitions);
            let level = if coverage.is_full() {
                AccessLevel::Full
            } else {
                AccessLevel::Partial
            };
            (level, coverage)
        } else if probe.can_read_definitions && probe.explicit_denials == Some(0) {
            let coverage = AccessCoverage::of_objects_and_texts(
                Completeness::Complete,
                Completeness::Complete,
            );
            (AccessLevel::Empty, coverage)
        } else {
            let coverage = AccessCoverage::of_objects_and_texts(
                Completeness::NotAvailable,
                Completeness::NotAvailable,
            );
            (AccessLevel::NothingVisible, coverage)
        };
        // Judged apart, after the level, which they never change. A login that sees nothing and
        // found no module has read no text, whatever the counts of nothing say.
        let module_definitions =
            if level == AccessLevel::NothingVisible && counts.module_definitions == 0 {
                Completeness::NotAvailable
            } else {
                module_definitions
            };
        coverage.programmability = scope
            .include_programmability
            .then(|| programmability_coverage(&probe, &scope));
        coverage.module_definitions = (scope.include_programmability
            && scope.include_module_definitions)
            .then_some(module_definitions);
        Self {
            probe,
            scope,
            level,
            coverage,
            counts,
        }
    }

    /// Whether the login sees every table and view of `schema`, so an object missing from the
    /// capture really does not exist there. Any explicit denial, or one the login cannot see,
    /// makes the answer `false`. A schema the probe does not list counts as fully visible only
    /// when the login can read the whole database, because then it does not exist.
    pub fn lists_every_object_in(&self, schema: &str) -> bool {
        lists_every_object_in(&self.probe, schema)
    }

    /// Whether the login sees every procedure and function of `schema`, so one missing from the
    /// capture really does not exist there. That takes `VIEW DEFINITION` on the schema, granted
    /// on it or on the database: `SELECT`, `db_datareader` among them, hides procedures and
    /// scalar functions entirely while it shows tables, views and table functions, and `EXECUTE`
    /// shows only what it may run. A denial of `VIEW DEFINITION`, `SELECT` or `CONTROL`, or one
    /// the login cannot see, makes the answer `false`; a denial of `EXECUTE` does not, because it
    /// hides nothing from a login that holds `VIEW DEFINITION`. A schema the probe does not list
    /// counts as fully visible only when the login holds `VIEW DEFINITION` on the database.
    /// `tests/sqlserver_permissions.rs` pins each of these on SQL Server 2019 and 2022.
    pub fn lists_every_programmable_object_in(&self, schema: &str) -> bool {
        lists_every_programmable_object_in(&self.probe, schema)
    }
}

/// The text coverages a profile is judged with, both of the same origin: predicted from the
/// permissions or observed in a capture.
#[derive(Clone, Copy)]
struct Texts {
    /// `CHECK` and `DEFAULT` texts.
    definitions: Completeness,
    /// Texts of views, procedures, functions and triggers.
    module_definitions: Completeness,
}

fn lists_every_programmable_object_in(probe: &AccessProbe, schema: &str) -> bool {
    if probe.explicit_denials != Some(0) {
        return false;
    }
    probe
        .schemas
        .iter()
        .find(|access| access.name == schema)
        .map_or(probe.can_read_definitions, |access| {
            access.can_read_definitions && !access.is_denied
        })
}

/// Procedures, functions and triggers: complete when every schema in scope lists every one of
/// them. Triggers follow their table, so a schema whose procedures are all visible shows every
/// trigger too. Otherwise some may be missing, and none could be read only when the login sees
/// no table, no view and no procedure or function at all.
fn programmability_coverage(probe: &AccessProbe, scope: &CaptureScope) -> Completeness {
    let schemas_in_scope_list_everything = if scope.schemas.is_empty() {
        probe
            .schemas
            .iter()
            .all(|access| lists_every_programmable_object_in(probe, &access.name))
    } else {
        scope
            .schemas
            .iter()
            .all(|schema| lists_every_programmable_object_in(probe, schema))
    };
    let has_scope_evidence = probe.can_read_definitions || !probe.schemas.is_empty();
    if probe.explicit_denials == Some(0) && has_scope_evidence && schemas_in_scope_list_everything {
        Completeness::Complete
    } else if probe.sees_objects
        || probe
            .schemas
            .iter()
            .any(|access| access.has_visible_programmability)
    {
        Completeness::Partial
    } else {
        Completeness::NotAvailable
    }
}

fn lists_every_object_in(probe: &AccessProbe, schema: &str) -> bool {
    if probe.explicit_denials != Some(0) {
        return false;
    }
    probe
        .schemas
        .iter()
        .find(|access| access.name == schema)
        .map_or(
            probe.can_read_definitions || probe.can_read_data,
            |access| (access.can_read_definitions || access.can_read_data) && !access.is_denied,
        )
}

/// The object list is complete when no denial can hide anything, no foreign key points to an
/// invisible table and every schema in scope is fully visible.
fn objects_coverage(
    probe: &AccessProbe,
    scope: &CaptureScope,
    counts: AccessCounts,
) -> Completeness {
    let schemas_in_scope_are_visible = if scope.schemas.is_empty() {
        probe
            .schemas
            .iter()
            .all(|access| lists_every_object_in(probe, &access.name))
    } else {
        scope
            .schemas
            .iter()
            .all(|schema| lists_every_object_in(probe, schema))
    };
    if probe.explicit_denials == Some(0)
        && counts.foreign_keys_to_invisible_tables == 0
        && schemas_in_scope_are_visible
    {
        Completeness::Complete
    } else {
        Completeness::Partial
    }
}

/// Texts of a finished capture: complete when none was hidden, not available when all were.
fn observed_definitions(counts: AccessCounts) -> Completeness {
    if counts.definitions_not_visible == 0 {
        Completeness::Complete
    } else if counts.definitions_not_visible >= counts.definitions {
        Completeness::NotAvailable
    } else {
        Completeness::Partial
    }
}

/// Module texts of a finished capture, as [`observed_definitions`] judges the `CHECK` and
/// `DEFAULT` texts. An encrypted module has no text for any login, so it is never a gap, and a
/// CLR module has no text to count.
fn observed_module_definitions(counts: AccessCounts) -> Completeness {
    let readable_by_some_login = counts
        .module_definitions
        .saturating_sub(counts.module_definitions_encrypted);
    if counts.module_definitions_not_visible == 0 {
        Completeness::Complete
    } else if counts.module_definitions_not_visible >= readable_by_some_login {
        Completeness::NotAvailable
    } else {
        Completeness::Partial
    }
}

/// Texts a capture would read, from the `VIEW DEFINITION` flags of the schemas that hold
/// visible objects, or of the database when none does.
fn predicted_definitions(probe: &AccessProbe) -> Completeness {
    predicted_texts(probe, |access| access.has_visible_objects)
}

/// Module texts a capture would read, from the `VIEW DEFINITION` flags of the schemas that hold
/// a visible table, view, procedure or function, or of the database when none does.
fn predicted_module_definitions(probe: &AccessProbe) -> Completeness {
    predicted_texts(probe, |access| {
        access.has_visible_objects || access.has_visible_programmability
    })
}

/// Texts a capture would read in the schemas `holds_texts` picks, from their `VIEW DEFINITION`
/// flags, or from the database's when it picks none.
fn predicted_texts(probe: &AccessProbe, holds_texts: fn(&SchemaAccess) -> bool) -> Completeness {
    let flags: Vec<bool> = probe
        .schemas
        .iter()
        .filter(|access| holds_texts(access))
        .map(|access| access.can_read_definitions)
        .collect();
    if flags.is_empty() {
        if probe.can_read_definitions {
            Completeness::Complete
        } else {
            Completeness::NotAvailable
        }
    } else if flags.iter().all(|readable| *readable) {
        Completeness::Complete
    } else if flags.iter().any(|readable| *readable) {
        Completeness::Partial
    } else {
        Completeness::NotAvailable
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use super::{
        AccessCounts, AccessCoverage, AccessLevel, AccessProbe, AccessProfile, CaptureScope,
        Completeness, SchemaAccess,
    };
    use crate::model::test_fixtures::{reader_snapshot, sample_programmability, sample_snapshot};

    const SCHEMAS: [&str; 3] = ["audit", "dbo", "sales"];

    fn schema(name: &str, definitions: bool, data: bool) -> SchemaAccess {
        SchemaAccess {
            name: name.to_string(),
            can_read_definitions: definitions,
            can_read_data: data,
            is_denied: false,
            has_visible_objects: definitions || data,
            has_visible_programmability: false,
            is_execute_denied: false,
        }
    }

    fn uniform(definitions: bool, data: bool) -> Vec<SchemaAccess> {
        SCHEMAS
            .iter()
            .map(|name| schema(name, definitions, data))
            .collect()
    }

    fn probe(definitions: bool, data: bool, schemas: Vec<SchemaAccess>) -> AccessProbe {
        AccessProbe {
            can_read_definitions: definitions,
            can_read_data: data,
            explicit_denials: Some(0),
            execute_denials: None,
            sees_objects: schemas.iter().any(|access| access.has_visible_objects),
            schemas,
            database_user: Some("app_user".to_string()),
        }
    }

    fn counts(definitions: u32, not_visible: u32, invisible_keys: u32) -> AccessCounts {
        AccessCounts {
            definitions,
            definitions_not_visible: not_visible,
            foreign_keys_to_invisible_tables: invisible_keys,
            ..AccessCounts::default()
        }
    }

    /// One login of the permission fixture: its probe, what a capture of everything found, and
    /// the verdicts expected for the prediction and for the capture.
    struct Persona {
        name: &'static str,
        probe: AccessProbe,
        found: AccessCounts,
        predicted: (AccessLevel, Completeness, Completeness),
        observed: (AccessLevel, Completeness, Completeness),
    }

    fn personas() -> Vec<Persona> {
        use AccessLevel::{Empty, Full, NothingVisible, Partial};
        use Completeness::{Complete, NotAvailable};

        let mut viewdef_deny_audit = probe(true, false, uniform(true, false));
        viewdef_deny_audit.explicit_denials = None;
        viewdef_deny_audit.schemas[0] = SchemaAccess {
            is_denied: true,
            ..schema("audit", false, false)
        };

        let mut reader_deny_audit = probe(false, true, uniform(false, true));
        reader_deny_audit.explicit_denials = Some(1);
        reader_deny_audit.schemas[0].is_denied = true;

        let mut unknown_denials = probe(true, true, uniform(true, true));
        unknown_denials.explicit_denials = None;

        let mut two_tables = probe(false, false, vec![schema("sales", false, false)]);
        two_tables.schemas[0].has_visible_objects = true;
        two_tables.sees_objects = true;

        vec![
            Persona {
                name: "db_owner",
                probe: probe(true, true, uniform(true, true)),
                found: counts(12, 0, 0),
                predicted: (Full, Complete, Complete),
                observed: (Full, Complete, Complete),
            },
            Persona {
                name: "VIEW DEFINITION only, or VIEW ANY DEFINITION on the server",
                probe: probe(true, false, uniform(true, false)),
                found: counts(12, 0, 0),
                predicted: (Full, Complete, Complete),
                observed: (Full, Complete, Complete),
            },
            Persona {
                name: "db_datareader",
                probe: probe(false, true, uniform(false, true)),
                found: counts(12, 12, 0),
                predicted: (Partial, Complete, NotAvailable),
                observed: (Partial, Complete, NotAvailable),
            },
            Persona {
                name: "db_datareader with VIEW DEFINITION on sales",
                probe: probe(
                    false,
                    true,
                    vec![
                        schema("audit", false, true),
                        schema("dbo", false, true),
                        schema("sales", true, true),
                    ],
                ),
                found: counts(12, 7, 0),
                predicted: (Partial, Complete, Completeness::Partial),
                observed: (Partial, Complete, Completeness::Partial),
            },
            Persona {
                name: "SELECT on two tables",
                probe: two_tables,
                found: counts(6, 6, 2),
                predicted: (Partial, Completeness::Partial, NotAvailable),
                observed: (Partial, Completeness::Partial, NotAvailable),
            },
            Persona {
                name: "CONNECT only",
                probe: probe(false, false, vec![schema("dbo", false, false)]),
                found: counts(0, 0, 0),
                predicted: (NothingVisible, NotAvailable, NotAvailable),
                observed: (NothingVisible, NotAvailable, NotAvailable),
            },
            Persona {
                name: "VIEW DEFINITION with DENY VIEW DEFINITION on audit",
                probe: viewdef_deny_audit,
                found: counts(9, 0, 0),
                predicted: (Partial, Completeness::Partial, Complete),
                observed: (Partial, Completeness::Partial, Complete),
            },
            Persona {
                name: "db_datareader with DENY VIEW DEFINITION on audit",
                probe: reader_deny_audit,
                found: counts(12, 12, 0),
                predicted: (Partial, Completeness::Partial, NotAvailable),
                observed: (Partial, Completeness::Partial, NotAvailable),
            },
            Persona {
                name: "denials the login cannot see",
                probe: unknown_denials,
                found: counts(12, 0, 0),
                predicted: (Partial, Completeness::Partial, Complete),
                observed: (Partial, Completeness::Partial, Complete),
            },
            Persona {
                name: "db_owner on an empty database",
                probe: without_objects(probe(true, true, vec![schema("dbo", true, true)])),
                found: counts(0, 0, 0),
                predicted: (Empty, Complete, Complete),
                observed: (Empty, Complete, Complete),
            },
        ]
    }

    fn without_objects(mut probe: AccessProbe) -> AccessProbe {
        probe.sees_objects = false;
        for access in &mut probe.schemas {
            access.has_visible_objects = false;
        }
        probe
    }

    fn verdict(profile: &AccessProfile) -> (AccessLevel, Completeness, Completeness) {
        (
            profile.level,
            profile.coverage.objects,
            profile.coverage.definitions,
        )
    }

    #[test]
    fn predictions_classify_every_persona() {
        for persona in personas() {
            let profile = AccessProfile::predicted(persona.probe.clone());
            assert_eq!(verdict(&profile), persona.predicted, "{}", persona.name);
            assert_eq!(profile.scope, CaptureScope::everything_with_code());
            assert_eq!(profile.counts, AccessCounts::default());
        }
    }

    #[test]
    fn observations_classify_every_persona() {
        for persona in personas() {
            let profile =
                AccessProfile::observed(persona.probe, CaptureScope::everything(), persona.found);
            assert_eq!(verdict(&profile), persona.observed, "{}", persona.name);
            assert_eq!(profile.counts, persona.found);
        }
    }

    #[test]
    fn a_foreign_key_to_an_invisible_table_makes_the_object_list_partial() {
        let profile = AccessProfile::observed(
            probe(false, true, uniform(false, true)),
            CaptureScope::everything(),
            counts(4, 0, 1),
        );
        assert_eq!(profile.coverage.objects, Completeness::Partial);
        assert_eq!(profile.level, AccessLevel::Partial);
    }

    #[test]
    fn coverage_only_judges_the_schemas_in_scope() {
        let mut probe = probe(
            false,
            true,
            vec![schema("dbo", false, true), schema("sales", false, true)],
        );
        probe.schemas[1].is_denied = true;
        probe.explicit_denials = Some(0);
        let only_dbo = CaptureScope {
            schemas: vec!["dbo".to_string()],
            ..CaptureScope::everything()
        };

        let scoped = AccessProfile::observed(probe.clone(), only_dbo, counts(2, 0, 0));
        let everything =
            AccessProfile::observed(probe, CaptureScope::everything(), counts(2, 0, 0));

        assert_eq!(scoped.coverage.objects, Completeness::Complete);
        assert_eq!(scoped.level, AccessLevel::Full);
        assert_eq!(everything.coverage.objects, Completeness::Partial);
    }

    #[test]
    fn texts_are_partial_only_when_some_but_not_all_are_hidden() {
        let profile = |found| {
            AccessProfile::observed(
                probe(true, true, uniform(true, true)),
                CaptureScope::everything(),
                found,
            )
        };
        assert_eq!(
            profile(counts(0, 0, 0)).coverage.definitions,
            Completeness::Complete
        );
        assert_eq!(
            profile(counts(3, 1, 0)).coverage.definitions,
            Completeness::Partial
        );
        assert_eq!(
            profile(counts(3, 3, 0)).coverage.definitions,
            Completeness::NotAvailable
        );
    }

    #[test]
    fn lists_every_object_only_where_nothing_can_hide_one() {
        let owner = AccessProfile::predicted(probe(true, true, uniform(true, true)));
        assert!(owner.lists_every_object_in("sales"));
        // A schema the probe does not list does not exist when the whole database is readable.
        assert!(owner.lists_every_object_in("archive"));

        let mut two_tables = probe(false, false, vec![schema("sales", false, false)]);
        two_tables.schemas[0].has_visible_objects = true;
        two_tables.sees_objects = true;
        let two_tables = AccessProfile::predicted(two_tables);
        assert!(!two_tables.lists_every_object_in("sales"));
        assert!(!two_tables.lists_every_object_in("archive"));

        let mut denied = probe(false, true, uniform(false, true));
        denied.schemas[0].is_denied = true;
        denied.explicit_denials = Some(1);
        let denied = AccessProfile::predicted(denied);
        assert!(!denied.lists_every_object_in("audit"));
        assert!(!denied.lists_every_object_in("dbo"));

        let mut unknown = probe(true, true, uniform(true, true));
        unknown.explicit_denials = None;
        assert!(!AccessProfile::predicted(unknown).lists_every_object_in("dbo"));
    }

    #[test]
    fn code_never_changes_the_level() {
        // The objects and the CHECK and DEFAULT texts are complete; the procedures and their
        // texts are not, and EXECUTE denials may hide more of them.
        let mut probe = probe(true, true, uniform(true, true));
        probe.execute_denials = Some(3);
        probe.schemas[2].has_visible_programmability = true;
        probe.schemas[2].is_execute_denied = true;
        let found = AccessCounts {
            module_definitions: 8,
            module_definitions_not_visible: 5,
            module_definitions_encrypted: 1,
            ..counts(12, 0, 0)
        };

        let profile = AccessProfile::observed(probe, CaptureScope::everything(), found);

        assert_eq!(profile.level, AccessLevel::Full);
        assert_eq!(profile.coverage.objects, Completeness::Complete);
        assert_eq!(profile.coverage.definitions, Completeness::Complete);
        assert_eq!(profile.coverage.programmability, None);
        assert_eq!(profile.coverage.module_definitions, None);

        let with_partial_code = AccessCoverage {
            programmability: Some(Completeness::Partial),
            module_definitions: Some(Completeness::NotAvailable),
            ..profile.coverage
        };
        assert!(with_partial_code.is_full());
        let with_partial_texts = AccessCoverage {
            definitions: Completeness::Partial,
            programmability: Some(Completeness::Complete),
            module_definitions: Some(Completeness::Complete),
            ..profile.coverage
        };
        assert!(!with_partial_texts.is_full());
    }

    fn with_code(mut schema: SchemaAccess) -> SchemaAccess {
        schema.has_visible_programmability = true;
        schema
    }

    /// `found` with `total` module texts, of which `not_visible` cannot be read and `encrypted`
    /// are encrypted.
    fn modules(found: AccessCounts, total: u32, not_visible: u32, encrypted: u32) -> AccessCounts {
        AccessCounts {
            module_definitions: total,
            module_definitions_not_visible: not_visible,
            module_definitions_encrypted: encrypted,
            ..found
        }
    }

    /// One login of the permission fixture as a capture that reads code sees it: the level, and
    /// the coverage of the procedures, functions and triggers and of their texts, predicted and
    /// observed after finding `found`.
    struct CodePersona {
        name: &'static str,
        probe: AccessProbe,
        found: AccessCounts,
        level: AccessLevel,
        predicted: (Completeness, Completeness),
        observed: (Completeness, Completeness),
    }

    // Keep the permission matrix together so predicted and observed verdicts can be compared.
    #[allow(clippy::too_many_lines)]
    fn code_personas() -> Vec<CodePersona> {
        use AccessLevel::{Full, NothingVisible, Partial};
        use Completeness::{Complete, NotAvailable};

        let code_in_dbo_and_sales = |definitions: bool, data: bool| {
            vec![
                schema("audit", definitions, data),
                with_code(schema("dbo", definitions, data)),
                with_code(schema("sales", definitions, data)),
            ]
        };

        let mut denied_execute = probe(true, false, code_in_dbo_and_sales(true, false));
        denied_execute.execute_denials = Some(1);

        let mut execute_only = probe(
            false,
            false,
            vec![
                schema("audit", false, false),
                schema("dbo", false, false),
                with_code(schema("sales", false, false)),
            ],
        );
        execute_only.sees_objects = false;
        for access in &mut execute_only.schemas {
            access.has_visible_objects = false;
        }

        let select_on_sales = probe(
            false,
            false,
            vec![
                schema("audit", false, false),
                schema("dbo", false, false),
                with_code(schema("sales", false, true)),
            ],
        );

        let mut unknown_denials = probe(true, true, code_in_dbo_and_sales(true, true));
        unknown_denials.explicit_denials = None;

        vec![
            CodePersona {
                name: "db_owner, with one encrypted procedure",
                probe: probe(true, true, code_in_dbo_and_sales(true, true)),
                found: modules(counts(12, 0, 0), 8, 0, 1),
                level: Full,
                predicted: (Complete, Complete),
                observed: (Complete, Complete),
            },
            CodePersona {
                name: "VIEW DEFINITION only",
                probe: probe(true, false, code_in_dbo_and_sales(true, false)),
                found: modules(counts(12, 0, 0), 8, 0, 1),
                level: Full,
                predicted: (Complete, Complete),
                observed: (Complete, Complete),
            },
            CodePersona {
                name: "only encrypted modules",
                probe: probe(true, true, code_in_dbo_and_sales(true, true)),
                found: modules(counts(12, 0, 0), 2, 0, 2),
                level: Full,
                predicted: (Complete, Complete),
                observed: (Complete, Complete),
            },
            CodePersona {
                // db_datareader hides procedures and scalar functions and shows the view, the
                // inline function and the triggers without their texts.
                name: "db_datareader",
                probe: probe(false, true, code_in_dbo_and_sales(false, true)),
                found: modules(counts(12, 12, 0), 4, 4, 0),
                level: Partial,
                predicted: (Completeness::Partial, NotAvailable),
                observed: (Completeness::Partial, NotAvailable),
            },
            CodePersona {
                // The procedures of sales are listed without their texts, the encrypted one as
                // encrypted.
                name: "db_datareader with EXECUTE on sales",
                probe: probe(false, true, code_in_dbo_and_sales(false, true)),
                found: modules(counts(12, 12, 0), 6, 5, 1),
                level: Partial,
                predicted: (Completeness::Partial, NotAvailable),
                observed: (Completeness::Partial, NotAvailable),
            },
            CodePersona {
                // Every text of sales is readable, and dbo's procedure and function are not
                // listed at all, so the texts found are complete while the list is not.
                name: "db_datareader with VIEW DEFINITION on sales",
                probe: probe(
                    false,
                    true,
                    vec![
                        schema("audit", false, true),
                        with_code(schema("dbo", false, true)),
                        with_code(schema("sales", true, true)),
                    ],
                ),
                found: modules(counts(12, 7, 0), 5, 0, 1),
                level: Partial,
                predicted: (Completeness::Partial, Completeness::Partial),
                observed: (Completeness::Partial, Complete),
            },
            CodePersona {
                name: "SELECT on the schema sales",
                probe: select_on_sales,
                found: modules(counts(6, 6, 0), 4, 4, 0),
                level: Partial,
                predicted: (Completeness::Partial, NotAvailable),
                observed: (Completeness::Partial, NotAvailable),
            },
            CodePersona {
                // A denial of EXECUTE hides nothing from a login with VIEW DEFINITION.
                name: "VIEW DEFINITION with DENY EXECUTE on a procedure",
                probe: denied_execute,
                found: modules(counts(12, 0, 0), 8, 0, 1),
                level: Full,
                predicted: (Complete, Complete),
                observed: (Complete, Complete),
            },
            CodePersona {
                name: "EXECUTE on sales only",
                probe: execute_only,
                found: modules(AccessCounts::default(), 2, 1, 1),
                level: NothingVisible,
                predicted: (Completeness::Partial, NotAvailable),
                observed: (Completeness::Partial, NotAvailable),
            },
            CodePersona {
                name: "CONNECT only",
                probe: without_objects(probe(false, false, vec![schema("dbo", false, false)])),
                found: AccessCounts::default(),
                level: NothingVisible,
                predicted: (NotAvailable, NotAvailable),
                observed: (NotAvailable, NotAvailable),
            },
            CodePersona {
                name: "denials the login cannot see",
                probe: unknown_denials,
                found: modules(counts(12, 0, 0), 8, 0, 1),
                level: Partial,
                predicted: (Completeness::Partial, Complete),
                observed: (Completeness::Partial, Complete),
            },
        ]
    }

    fn code_verdict(profile: &AccessProfile) -> (Option<Completeness>, Option<Completeness>) {
        (
            profile.coverage.programmability,
            profile.coverage.module_definitions,
        )
    }

    #[test]
    fn an_empty_visible_schema_list_does_not_prove_code_coverage() {
        let profile = AccessProfile::predicted(without_objects(probe(false, false, vec![])));
        assert_eq!(profile.level, AccessLevel::NothingVisible);
        assert_eq!(
            profile.coverage.programmability,
            Some(Completeness::NotAvailable)
        );
    }

    #[test]
    fn the_coverage_of_code_classifies_every_persona_and_never_changes_the_level() {
        for persona in code_personas() {
            let predicted = AccessProfile::predicted(persona.probe.clone());
            assert_eq!(
                code_verdict(&predicted),
                (Some(persona.predicted.0), Some(persona.predicted.1)),
                "{}",
                persona.name
            );
            assert_eq!(predicted.level, persona.level, "{}", persona.name);

            let observed = AccessProfile::observed(
                persona.probe.clone(),
                CaptureScope::everything_with_code(),
                persona.found,
            );
            assert_eq!(
                code_verdict(&observed),
                (Some(persona.observed.0), Some(persona.observed.1)),
                "{}",
                persona.name
            );
            assert_eq!(observed.level, persona.level, "{}", persona.name);

            // The same capture without code reaches the same level and object verdicts.
            let without_code = AccessProfile::observed(
                persona.probe,
                CaptureScope::everything(),
                AccessCounts {
                    module_definitions: 0,
                    module_definitions_not_visible: 0,
                    module_definitions_encrypted: 0,
                    ..persona.found
                },
            );
            assert_eq!(
                verdict(&without_code),
                verdict(&observed),
                "{}",
                persona.name
            );
            assert_eq!(
                code_verdict(&without_code),
                (None, None),
                "{}",
                persona.name
            );
        }
    }

    #[test]
    fn the_coverage_of_texts_is_judged_only_where_the_texts_were_read() {
        let objects_only = CaptureScope {
            include_module_definitions: false,
            ..CaptureScope::everything_with_code()
        };
        let profile = AccessProfile::observed(
            probe(true, true, uniform(true, true)),
            objects_only,
            AccessCounts::default(),
        );
        assert_eq!(code_verdict(&profile), (Some(Completeness::Complete), None));
        // Texts are never judged without the objects.
        let texts_only = CaptureScope {
            include_programmability: false,
            ..CaptureScope::everything_with_code()
        };
        let profile = AccessProfile::observed(
            probe(true, true, uniform(true, true)),
            texts_only,
            AccessCounts::default(),
        );
        assert_eq!(code_verdict(&profile), (None, None));
    }

    #[test]
    fn lists_every_programmable_object_only_with_view_definition_and_no_denial() {
        let lists = |probe: AccessProbe, schema: &str| {
            AccessProfile::predicted(probe).lists_every_programmable_object_in(schema)
        };

        // VIEW DEFINITION on the database, or on the schema.
        assert!(lists(probe(true, false, uniform(true, false)), "sales"));
        assert!(lists(probe(true, false, uniform(true, false)), "archive"));
        let sales_only = probe(
            false,
            true,
            vec![schema("dbo", false, true), schema("sales", true, true)],
        );
        assert!(lists(sales_only.clone(), "sales"));
        assert!(!lists(sales_only.clone(), "dbo"));
        // A schema the probe does not list is vouched for only by the database's grant.
        assert!(!lists(sales_only, "archive"));

        // SELECT, as db_datareader holds it, hides procedures and scalar functions.
        assert!(!lists(probe(false, true, uniform(false, true)), "sales"));
        assert!(!lists(probe(true, true, uniform(false, true)), "sales"));

        // A denial of VIEW DEFINITION, SELECT or CONTROL, or one the login cannot see.
        let mut denied = probe(true, true, uniform(true, true));
        denied.explicit_denials = Some(1);
        assert!(!lists(denied, "dbo"));
        let mut unknown = probe(true, true, uniform(true, true));
        unknown.explicit_denials = None;
        assert!(!lists(unknown, "dbo"));
        let mut denied_schema = probe(true, true, uniform(true, true));
        denied_schema.schemas[2].is_denied = true;
        denied_schema.explicit_denials = Some(1);
        assert!(!lists(denied_schema, "sales"));

        // A denial of EXECUTE, on the database, a schema or an object, hides nothing from it.
        let mut execute_denied = probe(true, false, uniform(true, false));
        execute_denied.execute_denials = Some(2);
        execute_denied.schemas[2].is_execute_denied = true;
        assert!(lists(execute_denied, "sales"));
    }

    #[test]
    fn counts_the_texts_and_the_invisible_keys_of_a_snapshot() {
        assert_eq!(AccessCounts::of(&sample_snapshot()), counts(2, 0, 0));
        assert_eq!(AccessCounts::of(&reader_snapshot()), counts(1, 1, 1));
    }

    #[test]
    fn counts_module_texts_apart_from_check_and_default_texts() {
        let snapshot = crate::model::SchemaSnapshot {
            programmability: Some(sample_programmability()),
            ..sample_snapshot()
        };
        assert_eq!(
            AccessCounts::of(&snapshot),
            AccessCounts {
                module_definitions: 6,
                module_definitions_not_visible: 1,
                module_definitions_encrypted: 1,
                ..counts(2, 0, 0)
            }
        );
    }

    #[test]
    fn serialises_with_camel_case_keys() {
        let profile = AccessProfile::predicted(probe(false, true, uniform(false, true)));
        let json = serde_json::to_value(&profile).unwrap();
        assert_eq!(json["level"], "partial");
        assert_eq!(json["coverage"]["definitions"], "notAvailable");
        assert_eq!(json["probe"]["explicitDenials"], 0);
        assert_eq!(json["probe"]["databaseUser"], "app_user");
        assert_eq!(json["probe"]["schemas"][0]["hasVisibleObjects"], true);
        assert_eq!(json["scope"]["includeViews"], true);
        assert_eq!(json["counts"]["foreignKeysToInvisibleTables"], 0);

        let restored: AccessProfile = serde_json::from_value(json).unwrap();
        assert_eq!(restored, profile);
    }

    #[test]
    fn code_facts_are_left_out_until_they_are_recorded() {
        // A profile without code facts reads and writes as 1.1 did.
        let profile = AccessProfile::observed(
            probe(false, true, uniform(false, true)),
            CaptureScope::everything(),
            AccessCounts::default(),
        );
        let json = serde_json::to_value(&profile).unwrap();
        for (object, keys) in [
            (&json["probe"], &["executeDenials"][..]),
            (
                &json["probe"]["schemas"][0],
                &["hasVisibleProgrammability", "isExecuteDenied"][..],
            ),
            (
                &json["coverage"],
                &["programmability", "moduleDefinitions"][..],
            ),
            (
                &json["counts"],
                &[
                    "moduleDefinitions",
                    "moduleDefinitionsNotVisible",
                    "moduleDefinitionsEncrypted",
                ][..],
            ),
            (
                &json["scope"],
                &["includeProgrammability", "includeModuleDefinitions"][..],
            ),
        ] {
            for key in keys {
                assert!(object.get(key).is_none(), "{key}");
            }
        }

        // Recorded, they are written and read back.
        let mut recorded = profile;
        recorded.probe.execute_denials = Some(2);
        recorded.probe.schemas[0].has_visible_programmability = true;
        recorded.probe.schemas[0].is_execute_denied = true;
        recorded.coverage.programmability = Some(Completeness::Partial);
        recorded.coverage.module_definitions = Some(Completeness::NotAvailable);
        recorded.counts.module_definitions = 4;
        recorded.counts.module_definitions_not_visible = 4;
        recorded.counts.module_definitions_encrypted = 0;
        recorded.scope.include_programmability = true;
        recorded.scope.include_module_definitions = true;
        let json = serde_json::to_value(&recorded).unwrap();
        assert_eq!(json["probe"]["executeDenials"], 2);
        assert_eq!(json["probe"]["schemas"][0]["isExecuteDenied"], true);
        assert_eq!(json["coverage"]["moduleDefinitions"], "notAvailable");
        assert_eq!(json["counts"]["moduleDefinitionsNotVisible"], 4);
        assert!(json["counts"].get("moduleDefinitionsEncrypted").is_none());
        assert_eq!(json["scope"]["includeModuleDefinitions"], true);
        let restored: AccessProfile = serde_json::from_value(json).unwrap();
        assert_eq!(restored, recorded);
    }
}
