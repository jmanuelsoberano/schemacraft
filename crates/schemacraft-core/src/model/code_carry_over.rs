//! Retains code that a fresh capture could not check. Explicit opt-outs always win.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};

use super::{
    CaptureState, CarriedCode, CarriedPart, CodeCapture, CodeObjectRef, Definition, NotReadReason,
    Programmability, QualifiedName, SchemaSnapshot, SnapshotFact,
};

impl SchemaSnapshot {
    /// Called after table and view carry-over so code can inherit its parent's read date.
    pub(super) fn keep_unchecked_code(&mut self, previous: &Self) {
        let Some(saved) = previous.programmability.as_ref() else {
            return;
        };
        let parents: BTreeMap<_, _> = self
            .carried_over
            .iter()
            .filter(|item| matches!(item.fact, SnapshotFact::Table | SnapshotFact::View))
            .map(|item| (item.object.clone(), item.read_at))
            .collect();
        let held: BTreeSet<_> = self
            .tables
            .iter()
            .map(|table| table.name.clone())
            .chain(self.views.iter().map(|view| view.name.clone()))
            .collect();
        let profile = self.access.as_ref();
        let in_scope = |name: &QualifiedName| {
            profile.is_none_or(|access| access.scope.includes_schema(&name.schema))
        };
        let may_hide = |name: &QualifiedName| {
            profile.is_some_and(|access| !access.lists_every_programmable_object_in(&name.schema))
        };
        let fresh = self.programmability.get_or_insert_with(|| Programmability {
            capture: CodeCapture {
                objects: CaptureState::Unknown,
                definitions: CaptureState::Unknown,
            },
            ..Programmability::not_read(NotReadReason::Unknown)
        });
        if fresh.capture.objects.is_left_out() {
            return;
        }
        let failed = fresh.capture.objects != CaptureState::Read;
        let texts_off = fresh.capture.definitions.is_left_out();
        let mut ledger = CodeLedger::new(saved, previous.extracted_at, &fresh.carried_over);
        let routine_names: BTreeSet<_> = fresh
            .routines
            .iter()
            .map(|routine| routine.name.clone())
            .collect();
        for routine in &saved.routines {
            if !routine_names.contains(&routine.name)
                && in_scope(&routine.name)
                && (failed || may_hide(&routine.name))
            {
                ledger.whole(routine.object_ref(), None, !texts_off);
                fresh.routines.push(routine.clone());
            }
        }
        let trigger_ids: BTreeSet<_> = fresh
            .triggers
            .iter()
            .map(super::Trigger::object_ref)
            .collect();
        for trigger in &saved.triggers {
            if !trigger_ids.contains(&trigger.object_ref())
                && held.contains(&trigger.parent)
                && (failed || parents.contains_key(&trigger.parent))
            {
                ledger.whole(
                    trigger.object_ref(),
                    parents.get(&trigger.parent).copied(),
                    !texts_off,
                );
                fresh.triggers.push(trigger.clone());
            }
        }
        let view_names: BTreeSet<_> = fresh.views.iter().map(|view| view.view.clone()).collect();
        for view in &saved.views {
            if !view_names.contains(&view.view)
                && held.contains(&view.view)
                && (failed || parents.contains_key(&view.view))
            {
                ledger.whole(
                    view.object_ref(),
                    parents.get(&view.view).copied(),
                    !texts_off,
                );
                fresh.views.push(view.clone());
            }
        }
        keep_unchecked_definitions(saved, fresh, &mut ledger);
        fresh
            .views
            .sort_by(|left, right| left.view.cmp(&right.view));
        fresh
            .routines
            .sort_by(|left, right| left.name.cmp(&right.name));
        fresh
            .triggers
            .sort_by(|left, right| (&left.parent, &left.name).cmp(&(&right.parent, &right.name)));
        fresh.carried_over = ledger.into_facts();
    }
}

fn keep_unchecked_definitions(
    saved: &Programmability,
    fresh: &mut Programmability,
    ledger: &mut CodeLedger,
) {
    if fresh.capture.definitions.is_left_out() {
        // Strip after the whole-object merge: no restored object can bypass the opt-out.
        for_each_definition(fresh, |_, definition| *definition = Definition::NotRecorded);
        ledger
            .items
            .retain(|(_, part), _| *part != CarriedPart::Definition);
        return;
    }
    let saved_texts: BTreeMap<_, _> = definitions(saved)
        .filter(|(_, definition)| definition.is_known())
        .collect();
    let texts_failed = fresh.capture.definitions != CaptureState::Read;
    for_each_definition(fresh, |object, definition| {
        let Some(saved_text) = saved_texts.get(&object) else {
            return;
        };
        // A failed query cannot revoke a prior observation, including visibility or
        // encryption. A successful read can retain only a hidden readable body.
        let missing = (*definition == Definition::NotVisible && saved_text.text().is_some())
            || (texts_failed
                && matches!(definition, Definition::NotRecorded | Definition::Unknown));
        if missing {
            definition.clone_from(saved_text);
            ledger.definition(object);
        }
    });
}

fn definitions(code: &Programmability) -> impl Iterator<Item = (CodeObjectRef, &Definition)> {
    code.views
        .iter()
        .map(|view| (view.object_ref(), &view.definition))
        .chain(code.routines.iter().filter_map(|routine| {
            routine
                .body
                .definition()
                .map(|definition| (routine.object_ref(), definition))
        }))
        .chain(code.triggers.iter().filter_map(|trigger| {
            trigger
                .body
                .definition()
                .map(|definition| (trigger.object_ref(), definition))
        }))
}

fn for_each_definition(
    code: &mut Programmability,
    mut apply: impl FnMut(CodeObjectRef, &mut Definition),
) {
    for view in &mut code.views {
        apply(view.object_ref(), &mut view.definition);
    }
    for routine in &mut code.routines {
        let object = routine.object_ref();
        if let Some(definition) = routine.body.definition_mut() {
            apply(object, definition);
        }
    }
    for trigger in &mut code.triggers {
        let object = trigger.object_ref();
        if let Some(definition) = trigger.body.definition_mut() {
            apply(object, definition);
        }
    }
}

struct CodeLedger {
    previous: BTreeMap<(CodeObjectRef, CarriedPart), DateTime<Utc>>,
    extracted_at: DateTime<Utc>,
    items: BTreeMap<(CodeObjectRef, CarriedPart), DateTime<Utc>>,
}

impl CodeLedger {
    fn into_facts(self) -> Vec<CarriedCode> {
        self.items
            .into_iter()
            .map(|((object, part), read_at)| CarriedCode {
                object,
                part,
                read_at,
            })
            .collect()
    }

    fn new(saved: &Programmability, extracted_at: DateTime<Utc>, current: &[CarriedCode]) -> Self {
        let collect = |items: &[CarriedCode]| {
            items
                .iter()
                .map(|item| ((item.object.clone(), item.part), item.read_at))
                .collect()
        };
        Self {
            previous: collect(&saved.carried_over),
            extracted_at,
            items: collect(current),
        }
    }

    fn whole(
        &mut self,
        object: CodeObjectRef,
        parent_date: Option<DateTime<Utc>>,
        keep_text: bool,
    ) {
        let date = self
            .previous
            .get(&(object.clone(), CarriedPart::Whole))
            .copied()
            .or(parent_date)
            .unwrap_or(self.extracted_at);
        self.items
            .entry((object.clone(), CarriedPart::Whole))
            .or_insert(date);
        // A text can be older than the object's metadata. Preserve both dates across chains.
        if keep_text
            && let Some(date) = self
                .previous
                .get(&(object.clone(), CarriedPart::Definition))
        {
            self.items
                .entry((object, CarriedPart::Definition))
                .or_insert(*date);
        }
    }

    fn definition(&mut self, object: CodeObjectRef) {
        let date = self
            .previous
            .get(&(object.clone(), CarriedPart::Definition))
            .or_else(|| self.previous.get(&(object.clone(), CarriedPart::Whole)))
            .copied()
            .unwrap_or(self.extracted_at);
        self.items
            .entry((object, CarriedPart::Definition))
            .or_insert(date);
    }
}

#[cfg(test)]
#[path = "code_carry_over_tests.rs"]
mod tests;
