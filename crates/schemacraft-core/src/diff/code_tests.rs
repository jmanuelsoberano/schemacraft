#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use super::*;
use crate::diff::{CaptureChange, SchemaDiff};
use crate::model::test_fixtures::{code_reader_snapshot, code_snapshot, sample_snapshot};
use crate::model::{NotReadReason, QualifiedName, SqlDataType, TriggerEvent};

#[test]
fn unknown_trigger_events_never_assert_a_changed_event_or_its_order() {
    let mut known = code_snapshot();
    known.programmability.as_mut().unwrap().triggers[0].events = vec![TriggerEvent {
        event: DmlEvent::Insert,
        order: FiringOrder::First,
    }];
    let mut unknown = known.clone();
    unknown.programmability.as_mut().unwrap().triggers[0].events[0].event = DmlEvent::Unknown;
    for (before, after) in [(&known, &unknown), (&unknown, &known)] {
        assert_eq!(SchemaDiff::between(before, after).code.changes, []);
    }
    let mut another_unknown = unknown.clone();
    another_unknown.programmability.as_mut().unwrap().triggers[0].events[0].order =
        FiringOrder::Last;
    assert_eq!(
        SchemaDiff::between(&unknown, &another_unknown).code.changes,
        []
    );
}

#[test]
fn a_failed_text_read_keeps_known_states_and_the_next_read_compares_with_them() {
    for saved_definition in [Definition::NotVisible, Definition::Encrypted] {
        let mut saved = code_snapshot();
        let saved_code = saved.programmability.as_mut().unwrap();
        saved_code.views.clear();
        saved_code.triggers.clear();
        saved_code.routines.truncate(1);
        *saved_code.routines[0].body.definition_mut().unwrap() = saved_definition.clone();

        let mut failed = saved.clone();
        let failed_code = failed.programmability.as_mut().unwrap();
        failed_code.capture.definitions = CaptureState::NotRead {
            reason: NotReadReason::QueryFailed,
        };
        *failed_code.routines[0].body.definition_mut().unwrap() = Definition::NotRecorded;
        let retained = failed.with_unchecked_facts_from(&saved);
        let retained_code = retained.programmability.as_ref().unwrap();
        assert_eq!(
            retained_code.routines[0].body.definition(),
            Some(&saved_definition)
        );
        assert_eq!(retained_code.carried_over.len(), 1);
        assert_eq!(retained_code.carried_over[0].part, CarriedPart::Definition);

        let mut recovered = saved.clone();
        *recovered.programmability.as_mut().unwrap().routines[0]
            .body
            .definition_mut()
            .unwrap() = Definition::readable("SELECT 1;");
        let diff = SchemaDiff::between(&retained, &recovered);
        assert_eq!(diff.capture_changes, []);
        if saved_definition == Definition::Encrypted {
            assert!(
                matches!(&diff.code.changes[0], CodeChange::Changed { properties, .. } if properties == &[CodeProperty::Encryption])
            );
            assert_eq!(diff.code.now_available, []);
        } else {
            assert_eq!(diff.code.changes, []);
            assert_eq!(diff.code.now_available.len(), 1);
        }
    }
}

#[test]
fn normalization_ignores_only_line_endings_trailing_blanks_and_edge_blank_lines() {
    let source = "CREATE PROCEDURE app.p\nAS\nSELECT 1;";
    for variant in [
        "CREATE PROCEDURE app.p\r\nAS\r\nSELECT 1;\r\n",
        "CREATE PROCEDURE app.p  \nAS\t\nSELECT 1;   ",
        "\n\n  \nCREATE PROCEDURE app.p\rAS\rSELECT 1;\n\n",
    ] {
        assert_eq!(comparable_text(variant), source);
    }
    for significant in ["  SELECT 1;", "SELECT 1;\n\nSELECT 2;", "SELECT  1;"] {
        assert_eq!(comparable_text(significant), significant);
    }
    assert_eq!(comparable_text(" \r\n\t"), "");
    assert!(matches!(comparable_text("SELECT 1;"), Cow::Borrowed(_)));

    let before = code_snapshot();
    let mut after = before.clone();
    let definition = after.programmability.as_mut().unwrap().routines[0]
        .body
        .definition_mut()
        .unwrap();
    let raw = format!("\r\n{}  \r\n", definition.text().unwrap());
    *definition = Definition::readable(raw.clone());
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.is_empty() && diff.is_up_to_date());
    assert_eq!(
        after.programmability.unwrap().routines[0]
            .body
            .definition()
            .unwrap()
            .text(),
        Some(raw.as_str())
    );
}

#[test]
fn every_code_property_is_reported_as_an_object_change() {
    type Edit = fn(&mut Programmability);
    let cases: [(CodeProperty, Edit); 14] = [
        (CodeProperty::Definition, |code| {
            code.routines[0].body = ModuleBody::Sql {
                definition: Definition::readable("SELECT 42;"),
            }
        }),
        (CodeProperty::Encryption, |code| {
            code.routines[0].body = ModuleBody::Sql {
                definition: Definition::Encrypted,
            }
        }),
        (CodeProperty::Implementation, |code| {
            code.routines[0].body = ModuleBody::Clr;
        }),
        (CodeProperty::Parameters, |code| {
            code.routines[0].parameters[0].is_output = true;
        }),
        (CodeProperty::ReturnType, |code| {
            code.routines[2].returns = Some(SqlDataType::plain("bigint"));
        }),
        (CodeProperty::Columns, |code| {
            code.routines[3].columns[0].is_nullable = true;
        }),
        (CodeProperty::Timing, |code| {
            code.triggers[0].timing = TriggerTiming::InsteadOf;
        }),
        (CodeProperty::Events, |code| {
            code.triggers[0].events.pop();
        }),
        (CodeProperty::FiringOrder, |code| {
            code.triggers[0].events[0].order = FiringOrder::Unspecified;
        }),
        (CodeProperty::Enabled, |code| {
            code.triggers[0].is_enabled = false;
        }),
        (CodeProperty::NotForReplication, |code| {
            code.triggers[0].is_not_for_replication = true;
        }),
        (CodeProperty::CheckOption, |code| {
            code.views[0].has_check_option = false;
        }),
        (CodeProperty::Indexed, |code| {
            code.views[0].is_indexed = true;
        }),
        (CodeProperty::Kind, |code| {
            code.routines[3].kind = RoutineKind::TableFunction;
        }),
    ];
    for (property, edit) in cases {
        let before = code_snapshot();
        let mut after = before.clone();
        edit(after.programmability.as_mut().unwrap());
        let diff = SchemaDiff::between(&before, &after);
        assert_eq!(diff.code.changes.len(), 1, "{property:?}");
        assert!(
            matches!(&diff.code.changes[0], CodeChange::Changed { properties, .. } if properties == &[property])
        );
        assert_eq!(diff.summary.code.changed, 1);
        assert_eq!(diff.summary.total(), 1);
        assert!(diff.has_object_changes() && !diff.is_empty() && !diff.is_up_to_date());
    }
}

#[test]
fn encryption_changes_in_both_directions_are_never_now_available() {
    let readable = code_snapshot();
    let mut encrypted = readable.clone();
    encrypted.programmability.as_mut().unwrap().routines[0].body = ModuleBody::Sql {
        definition: Definition::Encrypted,
    };
    for (before, after) in [(&readable, &encrypted), (&encrypted, &readable)] {
        let diff = SchemaDiff::between(before, after);
        assert!(
            matches!(&diff.code.changes[0], CodeChange::Changed { properties, .. } if properties == &[CodeProperty::Encryption])
        );
        assert_eq!(diff.code.now_available, []);
    }
}

#[test]
fn a_first_capture_has_only_aggregate_lines_and_does_not_change_access() {
    let before = sample_snapshot();
    let after = code_snapshot();
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.is_empty() && !diff.has_object_changes() && !diff.is_up_to_date());
    assert!(!diff.access_changed);
    assert_eq!(diff.code.now_available, []);
    assert_eq!(diff.capture_changes.len(), 2);
    assert!(matches!(
        diff.capture_changes[0],
        CaptureChange::ProgrammabilityRecorded { .. }
    ));
    assert!(matches!(
        diff.capture_changes[1],
        CaptureChange::ModuleDefinitionsRecorded { .. }
    ));
}

#[test]
fn a_stronger_login_reveals_objects_and_texts_without_reporting_additions() {
    let before = code_reader_snapshot();
    let after = code_snapshot();
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.code.changes, []);
    assert!(
        diff.code
            .now_available
            .iter()
            .any(|item| item.part == CarriedPart::Whole)
    );
    assert!(
        diff.code
            .now_available
            .iter()
            .any(|item| item.part == CarriedPart::Definition)
    );
    assert!(!diff.is_up_to_date());
}

#[test]
fn opting_out_has_counted_removal_lines_but_failed_reads_keep_everything() {
    let before = code_snapshot();
    let mut after = before.clone();
    after.programmability = Some(Programmability::not_read(NotReadReason::OptionOff));
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.code.changes, []);
    assert!(matches!(
        diff.capture_changes[0],
        CaptureChange::ProgrammabilityNoLongerRecorded { .. }
    ));
    assert!(matches!(
        diff.capture_changes[1],
        CaptureChange::ModuleDefinitionsNoLongerRecorded { .. }
    ));
    assert!(!diff.is_up_to_date());
    for reason in [NotReadReason::QueryFailed, NotReadReason::TimedOut] {
        after.programmability = Some(Programmability::not_read(reason));
        let diff = SchemaDiff::between(&before, &after);
        assert!(diff.code.changes.is_empty() && diff.capture_changes.is_empty());
        assert!(!diff.code.not_checked.is_empty() && !diff.is_up_to_date());
    }
}

#[test]
fn actual_additions_and_removals_are_distinct_from_access_changes() {
    let before = code_snapshot();
    let mut after = before.clone();
    let code = after.programmability.as_mut().unwrap();
    let mut added = code.routines[0].clone();
    added.name = QualifiedName::new("sales", "usp_New");
    code.routines.push(added);
    code.routines.remove(2);
    code.triggers.remove(0);
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(
        diff.summary.code,
        crate::diff::ChangeCounts {
            added: 1,
            removed: 2,
            changed: 0
        }
    );
    assert_eq!(diff.code.now_available, []);
}

#[test]
fn firing_order_is_per_event_and_input_event_order_does_not_matter() {
    let before = code_snapshot();
    let mut after = before.clone();
    after.programmability.as_mut().unwrap().triggers[0]
        .events
        .reverse();
    assert!(SchemaDiff::between(&before, &after).is_up_to_date());
    after.programmability.as_mut().unwrap().triggers[0].events = vec![
        TriggerEvent {
            event: DmlEvent::Insert,
            order: FiringOrder::Last,
        },
        TriggerEvent {
            event: DmlEvent::Update,
            order: FiringOrder::First,
        },
        TriggerEvent {
            event: DmlEvent::Delete,
            order: FiringOrder::Unspecified,
        },
    ];
    let diff = SchemaDiff::between(&before, &after);
    assert!(
        matches!(&diff.code.changes[0], CodeChange::Changed { properties, .. } if properties == &[CodeProperty::FiringOrder])
    );
}

#[test]
fn unknown_implementation_kind_and_timing_do_not_claim_known_changes() {
    let before = code_snapshot();
    let mut after = before.clone();
    let code = after.programmability.as_mut().unwrap();
    code.routines[0].body = ModuleBody::Unknown;
    code.routines[0].kind = RoutineKind::Unknown;
    code.triggers[0].timing = TriggerTiming::Unknown;
    assert!(SchemaDiff::between(&before, &after).is_empty());
}

#[test]
fn a_failed_first_or_empty_read_cannot_claim_the_project_is_up_to_date() {
    let absent = sample_snapshot();
    let mut empty = code_snapshot();
    let code = empty.programmability.as_mut().unwrap();
    code.views.clear();
    code.routines.clear();
    code.triggers.clear();
    let mut off = absent.clone();
    off.programmability = Some(Programmability::not_read(NotReadReason::OptionOff));
    for before in [absent, empty, off] {
        for reason in [NotReadReason::QueryFailed, NotReadReason::TimedOut] {
            let mut fresh = before.clone();
            fresh.programmability = Some(Programmability::not_read(reason));
            let diff = SchemaDiff::between(&before, &fresh);
            assert!(!diff.is_up_to_date());
            assert!(!diff.has_object_changes());
            assert_eq!(
                diff.code.read_failures,
                [CodeReadFailure {
                    family: CodeReadFamily::Objects,
                    reason
                }]
            );
        }
    }
}

#[test]
fn encrypted_only_code_is_not_a_first_capture_again_after_a_failed_refresh() {
    let mut before = code_snapshot();
    let code = before.programmability.as_mut().unwrap();
    code.views.clear();
    code.triggers.clear();
    code.routines
        .retain(|routine| routine.body.definition() == Some(&Definition::Encrypted));
    let mut failed = before.clone();
    failed.programmability = Some(Programmability::not_read(NotReadReason::QueryFailed));
    let saved_after_failure = failed.with_unchecked_facts_from(&before);
    assert_eq!(
        SchemaDiff::between(&saved_after_failure, &before).capture_changes,
        []
    );
}
