//! The guarantee behind `minReaderVersion` 2 (ADR-042): every fact format 3 added is a key that
//! SchemaCraft 1.1 keeps at one of its kept levels or ignores, and none changes what 1.1 reads
//! from the keys it knows.
//!
//! 1.1 parses a format 3 file read-only with its own types: it keeps `snapshot.programmability`
//! among the snapshot's unknown keys, ignores the new fields of its structs, and reads every
//! other key as it always did. So a fully populated format 3 project with exactly the new keys
//! removed must be the same document as one that recorded none of the new facts, with its
//! verdicts on access judged again as 1.1 judges them, and no key 1.1 parses may hold a value its
//! closed enums lack.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use chrono::{TimeZone, Utc};
use serde_json::Value;

use super::document::{FORMAT_VERSION, MIN_READER_VERSION, Project};
use super::test_fixtures::sample_project_content;
use crate::inspectors::InspectionOptions;
use crate::model::test_fixtures::{fully_populated_full_access_snapshot, fully_populated_snapshot};
use crate::model::{
    AccessCounts, AccessLevel, AccessProfile, CaptureScope, Completeness, SchemaSnapshot,
};

/// Every key format 3 added, as paths where `*` stands for each element of a list.
const NEW_KEYS: &[&str] = &[
    "inspection/includeProgrammability",
    "inspection/includeModuleDefinitions",
    "snapshot/programmability",
    "snapshot/tables/*/primaryKey/isEnabled",
    "snapshot/tables/*/indexes/*/includedColumns",
    "snapshot/tables/*/indexes/*/isFiltered",
    "snapshot/tables/*/indexes/*/isEnabled",
    "snapshot/tables/*/checkConstraints/*/isTrusted",
    "snapshot/foreignKeys/*/isTrusted",
    "snapshot/foreignKeysToInvisibleTables/*/isTrusted",
    "snapshot/access/probe/executeDenials",
    "snapshot/access/probe/schemas/*/hasVisibleProgrammability",
    "snapshot/access/probe/schemas/*/isExecuteDenied",
    "snapshot/access/scope/includeProgrammability",
    "snapshot/access/scope/includeModuleDefinitions",
    "snapshot/access/coverage/programmability",
    "snapshot/access/coverage/moduleDefinitions",
    "snapshot/access/counts/moduleDefinitions",
    "snapshot/access/counts/moduleDefinitionsNotVisible",
    "snapshot/access/counts/moduleDefinitionsEncrypted",
];

/// Removes the key at `path` wherever it occurs and returns how many were removed.
fn remove(value: &mut Value, path: &[&str]) -> usize {
    match path {
        [] => 0,
        ["*", rest @ ..] => value.as_array_mut().map_or(0, |items| {
            items.iter_mut().map(|item| remove(item, rest)).sum()
        }),
        [key] => value
            .as_object_mut()
            .and_then(|object| object.remove(*key))
            .map_or(0, |_| 1),
        [key, rest @ ..] => value.get_mut(*key).map_or(0, |inner| remove(inner, rest)),
    }
}

/// The document without the keys format 3 added, and the paths that were present.
fn without_new_keys(mut document: Value) -> (Value, Vec<&'static str>) {
    let mut present = Vec::new();
    for path in NEW_KEYS {
        let parts: Vec<&str> = path.split('/').collect();
        if remove(&mut document, &parts) > 0 {
            present.push(*path);
        }
    }
    (document, present)
}

/// `snapshot` as a capture that recorded none of the facts format 3 added would have written
/// it: everything else is left as it is, and the access profile is judged again from the probe
/// and the scope without code and the counts of what is left, as 1.1 judges it.
fn without_new_facts(mut snapshot: SchemaSnapshot) -> SchemaSnapshot {
    snapshot.programmability = None;
    for table in &mut snapshot.tables {
        if let Some(key) = table.primary_key.as_mut() {
            key.is_enabled = None;
        }
        for index in &mut table.indexes {
            index.included_columns = None;
            index.is_filtered = None;
            index.is_enabled = None;
        }
        for constraint in &mut table.check_constraints {
            constraint.is_trusted = None;
        }
    }
    for key in &mut snapshot.foreign_keys {
        key.is_trusted = None;
    }
    for key in &mut snapshot.foreign_keys_to_invisible_tables {
        key.is_trusted = None;
    }
    if let Some(profile) = snapshot.access.take() {
        let mut probe = profile.probe;
        probe.execute_denials = None;
        for schema in &mut probe.schemas {
            schema.has_visible_programmability = false;
            schema.is_execute_denied = false;
        }
        let scope = CaptureScope {
            include_programmability: false,
            include_module_definitions: false,
            ..profile.scope
        };
        // `programmability` is already gone, so these are the counts a 1.1 capture records.
        let counts = AccessCounts::of(&snapshot);
        snapshot.access = Some(AccessProfile::observed(probe, scope, counts));
    }
    snapshot
}

fn project_of(snapshot: SchemaSnapshot, inspection: InspectionOptions) -> Value {
    let saved_at = Utc.with_ymd_and_hms(2026, 10, 18, 18, 0, 0).unwrap();
    let mut content = sample_project_content();
    content.snapshot = snapshot;
    content.inspection = inspection;
    serde_json::to_value(Project::new(content, saved_at, "SchemaCraft 1.2.0")).unwrap()
}

fn full_project_of(snapshot: SchemaSnapshot) -> Value {
    let inspection = InspectionOptions {
        include_module_definitions: false,
        ..InspectionOptions::default()
    };
    project_of(snapshot, inspection)
}

/// The two fully populated snapshots: the one read by the `sales` reader, whose verdicts are
/// already partial, and one read by a login that sees everything, whose level is `full`, so a
/// verdict that code lowered would show.
fn fully_populated_snapshots() -> [(&'static str, SchemaSnapshot); 2] {
    [
        ("reader", fully_populated_snapshot()),
        ("full access", fully_populated_full_access_snapshot()),
    ]
}

#[test]
fn the_header_lets_1_1_open_the_file_read_only() {
    let project = full_project_of(fully_populated_snapshot());
    assert_eq!(project["formatVersion"], 3);
    assert_eq!(project["minReaderVersion"], 2);
    // 1.1 knows format 2: a newer format opens read-only when the minimum reader is not above it.
    assert_eq!(FORMAT_VERSION, 3);
    assert_eq!(MIN_READER_VERSION, 2);
}

#[test]
fn removing_exactly_the_new_keys_leaves_the_document_of_a_capture_without_them() {
    for (name, snapshot) in fully_populated_snapshots() {
        let full = full_project_of(snapshot.clone());
        let without_facts = project_of(without_new_facts(snapshot), InspectionOptions::default());

        let (stripped_full, present) = without_new_keys(full);
        let (stripped_without_facts, present_without_facts) = without_new_keys(without_facts);

        // The reader's project records every new key, so none of them is left untested; the
        // other has no key to an invisible table.
        if name == "reader" {
            assert_eq!(present, NEW_KEYS);
        }
        // A capture without the new facts writes none of them, except the two options, which
        // are always written.
        assert_eq!(
            present_without_facts,
            [
                "inspection/includeProgrammability",
                "inspection/includeModuleDefinitions"
            ],
            "{name}"
        );
        // What is left is what 1.1 parses: the same in both, so the new facts change nothing it
        // reads, the verdicts on access, judged again without code, and every count it knows
        // included.
        assert_eq!(stripped_full, stripped_without_facts, "{name}");
    }
}

#[test]
fn the_verdicts_on_access_do_not_depend_on_code() {
    for (name, snapshot) in fully_populated_snapshots() {
        let profile = snapshot.access.clone().unwrap();
        if name == "full access" {
            // Against a login that sees everything, a verdict that code lowered would show.
            assert_eq!(profile.level, AccessLevel::Full);
            assert_eq!(profile.coverage.objects, Completeness::Complete);
            assert_eq!(profile.coverage.definitions, Completeness::Complete);
        }
        assert!(profile.counts.module_definitions > 0, "{name}");
        let judged_without_code = without_new_facts(snapshot).access.unwrap();

        assert_eq!(profile.level, judged_without_code.level, "{name}");
        assert_eq!(
            profile.coverage.objects, judged_without_code.coverage.objects,
            "{name}"
        );
        assert_eq!(
            profile.coverage.definitions, judged_without_code.coverage.definitions,
            "{name}"
        );
        // The CHECK and DEFAULT counts do not include module texts.
        assert_eq!(
            profile.counts.definitions, judged_without_code.counts.definitions,
            "{name}"
        );
        assert_eq!(
            profile.counts.definitions_not_visible,
            judged_without_code.counts.definitions_not_visible,
            "{name}"
        );
        assert_eq!(
            profile.counts.foreign_keys_to_invisible_tables,
            judged_without_code.counts.foreign_keys_to_invisible_tables,
            "{name}"
        );
    }
}

/// Every string at `path`, where `*` stands for each element of a list.
fn values_at<'a>(value: &'a Value, path: &[&str]) -> Vec<&'a str> {
    match path {
        [] => value.as_str().into_iter().collect(),
        ["*", rest @ ..] => value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .flat_map(|item| values_at(item, rest))
                    .collect()
            })
            .unwrap_or_default(),
        [key, rest @ ..] => value
            .get(*key)
            .map(|inner| values_at(inner, rest))
            .unwrap_or_default(),
    }
}

/// Every `status` of an object outside `snapshot.programmability`, which 1.1 never parses.
fn statuses(value: &Value, inside_code: bool, found: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            if let (false, Some(Value::String(status))) = (inside_code, object.get("status")) {
                found.push(status.clone());
            }
            for (key, inner) in object {
                statuses(inner, inside_code || key == "programmability", found);
            }
        }
        Value::Array(items) => {
            for item in items {
                statuses(item, inside_code, found);
            }
        }
        _ => {}
    }
}

#[test]
fn no_key_1_1_parses_holds_a_value_its_closed_enums_lack() {
    let projects: Vec<Value> = fully_populated_snapshots()
        .into_iter()
        .map(|(_, snapshot)| full_project_of(snapshot))
        .collect();
    // The values of every closed enum of 1.1.0 that a project holds, as 1.1.0 parses them. The
    // text statuses are checked apart, below.
    let known: &[(&str, &[&str])] = &[
        ("connection/provider", &["sqlServer"]),
        (
            "connection/authentication/mode",
            &["integrated", "sqlLogin"],
        ),
        (
            "connection/encryption",
            &["optional", "mandatory", "strict"],
        ),
        (
            "snapshot/tables/*/columns/*/dataType/length/kind",
            &["fixed", "max"],
        ),
        (
            "snapshot/views/*/columns/*/dataType/length/kind",
            &["fixed", "max"],
        ),
        (
            "snapshot/access/level",
            &["full", "partial", "empty", "nothingVisible"],
        ),
        (
            "snapshot/access/coverage/objects",
            &["complete", "partial", "notAvailable"],
        ),
        (
            "snapshot/access/coverage/definitions",
            &["complete", "partial", "notAvailable"],
        ),
        (
            "snapshot/tables/*/indexes/*/kind",
            &["uniqueConstraint", "uniqueIndex", "nonUnique"],
        ),
        (
            "snapshot/foreignKeys/*/onDelete",
            &["noAction", "cascade", "setNull", "setDefault"],
        ),
        (
            "snapshot/foreignKeys/*/onUpdate",
            &["noAction", "cascade", "setNull", "setDefault"],
        ),
        (
            "snapshot/foreignKeysToInvisibleTables/*/onDelete",
            &["noAction", "cascade", "setNull", "setDefault"],
        ),
        (
            "snapshot/foreignKeysToInvisibleTables/*/onUpdate",
            &["noAction", "cascade", "setNull", "setDefault"],
        ),
        (
            "snapshot/carriedOver/*/fact/kind",
            &[
                "table",
                "view",
                "columnDefault",
                "checkConstraint",
                "foreignKey",
            ],
        ),
        ("canvas/detailLevel", &["compact", "keys", "full"]),
        ("canvas/layout", &["manual", "layered", "organic", "radial"]),
    ];
    for (path, values) in known {
        let parts: Vec<&str> = path.split('/').collect();
        let found: Vec<&str> = projects
            .iter()
            .flat_map(|project| values_at(project, &parts))
            .collect();
        // Each path is populated in one project at least: the reader's tables declare no
        // length, and the other project has no key to an invisible table.
        assert!(!found.is_empty(), "{path} is not populated");
        for value in found {
            assert!(values.contains(&value), "{path} = {value}");
        }
    }

    for full in &projects {
        // A text status 1.1 lacks, `encrypted` above all, appears only under programmability,
        // which 1.1 keeps as raw JSON.
        let mut found = Vec::new();
        statuses(full, false, &mut found);
        assert!(
            !found.is_empty(),
            "the project holds CHECK and DEFAULT texts"
        );
        for status in found {
            assert!(
                ["readable", "notVisible", "notRecorded"].contains(&status.as_str()),
                "{status}"
            );
        }
        let code = serde_json::to_string(&full["snapshot"]["programmability"]).unwrap();
        assert!(code.contains("\"status\":\"encrypted\""));
    }
}
