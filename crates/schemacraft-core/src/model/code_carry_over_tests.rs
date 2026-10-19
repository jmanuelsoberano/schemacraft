#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use chrono::Duration;

use super::*;
use crate::model::test_fixtures::{code_reader_snapshot, code_snapshot, schema_reader_profile};
use crate::model::{AccessCounts, CarriedFact, ModuleBody, RoutineKind};

#[test]
fn a_weaker_login_keeps_routines_and_readable_texts_and_merging_is_idempotent() {
    let owner = code_snapshot();
    let reader = code_reader_snapshot();
    let merged = reader.with_unchecked_facts_from(&owner);
    let code = merged.programmability.as_ref().unwrap();
    assert_eq!(
        code.routines.len(),
        owner.programmability.as_ref().unwrap().routines.len()
    );
    assert!(
        code.routines
            .iter()
            .any(|routine| routine.kind == RoutineKind::Procedure)
    );
    assert!(
        code.carried_over
            .iter()
            .any(|item| item.part == CarriedPart::Whole)
    );
    assert!(
        code.carried_over
            .iter()
            .any(|item| item.part == CarriedPart::Definition)
    );
    assert!(
        code.carried_over
            .iter()
            .all(|item| item.read_at == owner.extracted_at)
    );
    assert_eq!(merged.clone().with_unchecked_facts_from(&owner), merged);
}

#[test]
fn turning_off_texts_strips_every_restored_object_but_keeps_its_metadata() {
    let owner = code_snapshot();
    let mut reader = code_reader_snapshot();
    reader.programmability.as_mut().unwrap().capture.definitions = CaptureState::NotRead {
        reason: NotReadReason::OptionOff,
    };
    let merged = reader.with_unchecked_facts_from(&owner);
    let code = merged.programmability.as_ref().unwrap();
    assert_eq!(
        code.routines.len(),
        owner.programmability.as_ref().unwrap().routines.len()
    );
    assert!(
        code.module_definitions()
            .all(|definition| *definition == Definition::NotRecorded)
    );
    assert!(
        code.carried_over
            .iter()
            .all(|item| item.part == CarriedPart::Whole)
    );
    assert!(!serde_json::to_string(code).unwrap().contains("CREATE"));
}

#[test]
fn a_definition_keeps_its_older_date_when_the_routine_later_becomes_invisible() {
    let owner = code_snapshot();
    let mut intermediate = owner.clone();
    intermediate.extracted_at += Duration::days(1);
    for routine in &mut intermediate.programmability.as_mut().unwrap().routines {
        if let Some(definition) = routine.body.definition_mut() {
            *definition = Definition::NotVisible;
        }
    }
    let intermediate = intermediate.with_unchecked_facts_from(&owner);
    let mut reader = code_reader_snapshot();
    reader.extracted_at += Duration::days(1);
    let merged = reader.with_unchecked_facts_from(&intermediate);
    let object = owner.programmability.as_ref().unwrap().routines[0].object_ref();
    let ledger = &merged.programmability.as_ref().unwrap().carried_over;
    assert!(ledger.iter().any(|item| item.object == object
        && item.part == CarriedPart::Definition
        && item.read_at == owner.extracted_at));
    assert!(ledger.iter().any(|item| item.object == object
        && item.part == CarriedPart::Whole
        && item.read_at == intermediate.extracted_at));
}

#[test]
fn failed_metadata_and_failed_texts_keep_saved_code_but_option_off_drops_it() {
    let mut owner = code_snapshot();
    owner
        .programmability
        .as_mut()
        .unwrap()
        .routines
        .sort_by(|left, right| left.name.cmp(&right.name));
    for reason in [
        NotReadReason::QueryFailed,
        NotReadReason::TimedOut,
        NotReadReason::Unknown,
    ] {
        let mut fresh = owner.clone();
        fresh.programmability = Some(Programmability::not_read(reason));
        let merged = fresh.with_unchecked_facts_from(&owner);
        let code = merged.programmability.as_ref().unwrap();
        assert_eq!(
            code.routines,
            owner.programmability.as_ref().unwrap().routines
        );
        assert_eq!(code.views, owner.programmability.as_ref().unwrap().views);
        assert_eq!(
            code.triggers,
            owner.programmability.as_ref().unwrap().triggers
        );
        assert_eq!(
            code.carried_over.len(),
            code.routines.len() + code.views.len() + code.triggers.len()
        );
    }
    let mut fresh = owner.clone();
    fresh.programmability = Some(Programmability::not_read(NotReadReason::OptionOff));
    let merged = fresh.with_unchecked_facts_from(&owner);
    assert!(!merged.programmability.as_ref().unwrap().records_objects());

    let mut fresh = owner.clone();
    let code = fresh.programmability.as_mut().unwrap();
    code.capture.definitions = CaptureState::NotRead {
        reason: NotReadReason::QueryFailed,
    };
    for_each_definition(code, |_, definition| {
        if definition.text().is_some() {
            *definition = Definition::NotRecorded;
        }
    });
    let merged = fresh.with_unchecked_facts_from(&owner);
    let code = merged.programmability.as_ref().unwrap();
    assert!(
        code.carried_over
            .iter()
            .all(|item| item.part == CarriedPart::Definition)
    );
    assert_eq!(
        code.routines,
        owner.programmability.as_ref().unwrap().routines
    );
}

#[test]
fn encryption_and_clr_never_restore_a_saved_readable_body() {
    let owner = code_snapshot();
    let name = owner.programmability.as_ref().unwrap().routines[0]
        .name
        .clone();
    for body in [
        ModuleBody::Sql {
            definition: Definition::Encrypted,
        },
        ModuleBody::Clr,
    ] {
        let mut fresh = owner.clone();
        fresh.programmability.as_mut().unwrap().routines[0].body = body.clone();
        let merged = fresh.with_unchecked_facts_from(&owner);
        assert_eq!(
            merged
                .programmability
                .unwrap()
                .routines
                .iter()
                .find(|routine| routine.name == name)
                .unwrap()
                .body,
            body
        );
    }
}

#[test]
fn visible_parents_vouch_for_trigger_removal_and_excluded_schemas_are_not_kept() {
    let owner = code_snapshot();
    let mut fresh = code_reader_snapshot();
    fresh.programmability.as_mut().unwrap().triggers.clear();
    fresh.access.as_mut().unwrap().scope.schemas = vec!["sales".to_string()];
    let merged = fresh.with_unchecked_facts_from(&owner);
    let code = merged.programmability.unwrap();
    assert_eq!(code.triggers, []);
    assert!(
        code.routines
            .iter()
            .all(|routine| routine.name.schema == "sales")
    );
}

#[test]
fn code_of_a_kept_parent_inherits_its_date_without_losing_an_older_text_date() {
    let mut owner = code_snapshot();
    let parent = owner.views[0].name.clone();
    let parent_date = owner.extracted_at - Duration::days(2);
    let text_date = owner.extracted_at - Duration::days(3);
    owner.carried_over.push(CarriedFact {
        object: parent.clone(),
        fact: SnapshotFact::View,
        read_at: parent_date,
    });
    let object = CodeObjectRef::View { name: parent };
    owner
        .programmability
        .as_mut()
        .unwrap()
        .carried_over
        .push(CarriedCode {
            object: object.clone(),
            part: CarriedPart::Definition,
            read_at: text_date,
        });
    let mut fresh = owner.clone();
    fresh.carried_over.clear();
    fresh.views.clear();
    fresh.programmability.as_mut().unwrap().views.clear();
    fresh.programmability.as_mut().unwrap().carried_over.clear();
    fresh.access = Some(schema_reader_profile(&["dbo"], AccessCounts::default()));
    let merged = fresh.with_unchecked_facts_from(&owner);
    let ledger = &merged.programmability.as_ref().unwrap().carried_over;
    assert!(ledger.iter().any(|item| item.object == object
        && item.part == CarriedPart::Whole
        && item.read_at == parent_date));
    assert!(ledger.iter().any(|item| item.object == object
        && item.part == CarriedPart::Definition
        && item.read_at == text_date));
}
