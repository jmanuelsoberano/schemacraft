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
    /// Explicit denials of `EXECUTE` for the login and its roles, which may hide procedures and
    /// functions. `None` when the probe did not count them, as before 1.2, or the login cannot
    /// see its own denials; either way some may exist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub execute_denials: Option<u32>,
    /// Whether the login sees at least one user table or view.
    pub sees_objects: bool,
    /// Per-schema facts, for the schemas the login can see.
    pub schemas: Vec<SchemaAccess>,
    /// Database user the login maps to, used to name it in a `GRANT` script; `None` when the
    /// login reaches the database without a user of its own.
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
    /// Whether an explicit denial of `EXECUTE` on the schema can hide some of its procedures and
    /// functions; `false` as well when the probe did not ask, as before 1.2.
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
    /// Module texts that are encrypted, which no login can read.
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
    /// Whether procedures, functions and triggers were asked for; `false` for every capture
    /// that did not ask, those made before 1.2 included.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_programmability: bool,
    /// Whether the texts of views, procedures, functions and triggers were asked for; `false`
    /// for every capture that did not ask.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_module_definitions: bool,
}

impl CaptureScope {
    /// Every schema, views included, and no code: nothing judges code from the permissions
    /// alone.
    pub fn everything() -> Self {
        Self {
            schemas: Vec::new(),
            include_views: true,
            include_programmability: false,
            include_module_definitions: false,
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
    /// What a capture of the whole database would see, judged from the permissions alone. The
    /// connection dialog shows it before anything is read.
    pub fn predicted(probe: AccessProbe) -> Self {
        let scope = CaptureScope::everything();
        let counts = AccessCounts::default();
        let definitions = predicted_definitions(&probe);
        Self::judged(probe, scope, counts, definitions)
    }

    /// What a finished capture saw, given the scope it read and what it found.
    pub fn observed(probe: AccessProbe, scope: CaptureScope, counts: AccessCounts) -> Self {
        let definitions = observed_definitions(counts);
        Self::judged(probe, scope, counts, definitions)
    }

    fn judged(
        probe: AccessProbe,
        scope: CaptureScope,
        counts: AccessCounts,
        definitions: Completeness,
    ) -> Self {
        let objects = objects_coverage(&probe, &scope, counts);
        let (level, coverage) = if probe.sees_objects {
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

/// Texts a capture would read, from the `VIEW DEFINITION` flags of the schemas that hold
/// visible objects, or of the database when none does.
fn predicted_definitions(probe: &AccessProbe) -> Completeness {
    let flags: Vec<bool> = probe
        .schemas
        .iter()
        .filter(|access| access.has_visible_objects)
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
            assert_eq!(profile.scope, CaptureScope::everything());
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
        let profile = AccessProfile::predicted(probe(false, true, uniform(false, true)));
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
