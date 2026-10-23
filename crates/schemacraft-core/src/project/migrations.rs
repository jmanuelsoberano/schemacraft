//! Upgrades of older project files, applied to the raw JSON before it is parsed.
//!
//! Each step turns a document of one format into the next and touches only what changed, so a
//! file of any supported age parses with today's types. Steps never fail: what they do not
//! recognise is left as it is, and the parser then reports a damaged file as such.

use std::collections::BTreeSet;

use serde_json::{Value, json};

/// Brings a document of format `from` up to the current format.
pub(super) fn upgrade(document: &mut Value, from: u32) {
    if from < 2 {
        format_1_to_2(document);
    }
    if from < 3 {
        format_2_to_3(document);
    }
    if from < 4 {
        format_3_to_4(document);
    }
}

/// Format 4 coordinates engine-aware facts with independent maps and user notes.
/// Legacy canvas coordinates and unknown keys remain untouched; missing optional map/note
/// families deserialize empty. A format-3 reader must refuse the new provider semantics.
fn format_3_to_4(document: &mut Value) {
    if let Some(root) = document.as_object_mut() {
        root.insert("formatVersion".to_string(), json!(4));
        root.insert("minReaderVersion".to_string(), json!(4));
    }
}

/// Format 2 tells an unreadable `CHECK` or `DEFAULT` text apart from a missing one.
///
/// Format 1 stored texts as plain strings. SchemaCraft 1.0 wrote an empty `CHECK` text when the
/// login could not read it, and no default at all when the login could not read the default's
/// text, so:
///
/// * a `CHECK` or default text becomes readable, or not recorded when it is empty;
/// * a missing default stays missing, except in a schema that has an empty `CHECK` text: that
///   login could not read texts there, so whether the column has a default was not recorded.
///
/// The snapshot gets no access profile: format 1 did not record what the login could see.
fn format_1_to_2(document: &mut Value) {
    if let Some(tables) = document
        .pointer_mut("/snapshot/tables")
        .and_then(Value::as_array_mut)
    {
        let schemas_with_unread_texts: BTreeSet<String> = tables
            .iter()
            .filter(|table| has_empty_check_text(table))
            .filter_map(schema_of)
            .collect();
        for table in tables.iter_mut() {
            let texts_were_unread =
                schema_of(table).is_some_and(|schema| schemas_with_unread_texts.contains(&schema));
            upgrade_defaults(table, texts_were_unread);
            upgrade_check_texts(table);
        }
    }
    if let Some(views) = document
        .pointer_mut("/snapshot/views")
        .and_then(Value::as_array_mut)
    {
        for view in views {
            upgrade_defaults(view, false);
        }
    }
    if let Some(root) = document.as_object_mut() {
        root.insert("formatVersion".to_string(), json!(2));
        root.insert("minReaderVersion".to_string(), json!(2));
    }
}

/// Format 3 adds facts and changes none, so the content of a format 2 document is already a
/// valid format 3 one: only the header moves.
///
/// What format 2 could not hold stays absent, and absent means not recorded: the snapshot has
/// no `programmability`, because its code was never read, and its indexes, keys and constraints
/// no enabled, filtered, included-column or trust state. None of them reads as "none" or
/// "false".
fn format_2_to_3(document: &mut Value) {
    if let Some(root) = document.as_object_mut() {
        root.insert("formatVersion".to_string(), json!(3));
        root.insert("minReaderVersion".to_string(), json!(2));
    }
}

fn schema_of(object: &Value) -> Option<String> {
    object
        .pointer("/name/schema")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn has_empty_check_text(table: &Value) -> bool {
    table
        .get("checkConstraints")
        .and_then(Value::as_array)
        .is_some_and(|constraints| {
            constraints
                .iter()
                .any(|constraint| constraint.get("expression").and_then(Value::as_str) == Some(""))
        })
}

fn upgrade_defaults(object: &mut Value, texts_were_unread: bool) {
    let Some(columns) = object.get_mut("columns").and_then(Value::as_array_mut) else {
        return;
    };
    for column in columns.iter_mut().filter_map(Value::as_object_mut) {
        let Some(default) = column.get_mut("defaultExpression") else {
            continue;
        };
        let upgraded = match &*default {
            Value::String(text) => Some(definition_of(text)),
            Value::Null if texts_were_unread => Some(json!({ "status": "notRecorded" })),
            _ => None,
        };
        if let Some(upgraded) = upgraded {
            *default = upgraded;
        }
    }
}

fn upgrade_check_texts(table: &mut Value) {
    let Some(constraints) = table
        .get_mut("checkConstraints")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for constraint in constraints.iter_mut().filter_map(Value::as_object_mut) {
        let Some(expression) = constraint.get_mut("expression") else {
            continue;
        };
        let upgraded = expression.as_str().map(definition_of);
        if let Some(upgraded) = upgraded {
            *expression = upgraded;
        }
    }
}

/// A format-1 text as a definition. An empty text is never a real expression: 1.0 wrote it
/// when the text could not be read.
fn definition_of(text: &str) -> Value {
    if text.is_empty() {
        json!({ "status": "notRecorded" })
    } else {
        json!({ "status": "readable", "text": text })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use serde_json::{Value, json};

    use super::upgrade;
    use crate::model::Definition;
    use crate::project::document::Project;
    use crate::project::test_fixtures::{FORMAT_1_PROJECT, FORMAT_2_PROJECT};

    fn table(schema: &str, defaults: &[Value], checks: &[&str]) -> Value {
        let columns: Vec<Value> = defaults
            .iter()
            .enumerate()
            .map(|(index, default)| json!({ "name": format!("C{index}"), "defaultExpression": default }))
            .collect();
        let check_constraints: Vec<Value> = checks
            .iter()
            .enumerate()
            .map(|(index, text)| json!({ "name": format!("CK{index}"), "expression": text }))
            .collect();
        json!({
            "name": { "schema": schema, "name": "T" },
            "columns": columns,
            "checkConstraints": check_constraints,
        })
    }

    fn upgraded(tables: &[Value]) -> Value {
        let mut document = json!({ "formatVersion": 1, "snapshot": { "tables": tables } });
        upgrade(&mut document, 1);
        document
    }

    #[test]
    fn texts_become_tagged_definitions() {
        let document = upgraded(&[table(
            "dbo",
            &[json!("((0))"), Value::Null],
            &["([Quantity]>(0))"],
        )]);
        let table = &document["snapshot"]["tables"][0];

        assert_eq!(
            table["columns"][0]["defaultExpression"],
            json!({ "status": "readable", "text": "((0))" })
        );
        assert_eq!(table["columns"][1]["defaultExpression"], Value::Null);
        assert_eq!(
            table["checkConstraints"][0]["expression"],
            json!({ "status": "readable", "text": "([Quantity]>(0))" })
        );
    }

    #[test]
    fn an_empty_check_text_marks_the_texts_of_its_schema_as_not_recorded() {
        let document = upgraded(&[
            table(
                "sales",
                &[Value::Null, json!("('N')")],
                &["", "([Total]>=(0))"],
            ),
            table("sales", &[Value::Null], &[]),
            table("dbo", &[Value::Null], &[]),
        ]);
        let tables = &document["snapshot"]["tables"];
        let not_recorded = json!({ "status": "notRecorded" });

        assert_eq!(tables[0]["checkConstraints"][0]["expression"], not_recorded);
        assert_eq!(
            tables[0]["checkConstraints"][1]["expression"]["status"],
            "readable"
        );
        assert_eq!(tables[0]["columns"][0]["defaultExpression"], not_recorded);
        assert_eq!(
            tables[0]["columns"][1]["defaultExpression"]["text"],
            "('N')"
        );
        assert_eq!(tables[1]["columns"][0]["defaultExpression"], not_recorded);
        // Another schema keeps its missing default: nothing says its texts were unreadable.
        assert_eq!(tables[2]["columns"][0]["defaultExpression"], Value::Null);
    }

    #[test]
    fn a_format_one_document_moves_to_format_four_without_an_access_profile() {
        let document = upgraded(&[]);
        assert_eq!(document["formatVersion"], 4);
        assert_eq!(document["minReaderVersion"], 4);
        assert!(document["snapshot"].get("access").is_none());
        assert!(document["snapshot"].get("programmability").is_none());
    }

    #[test]
    fn a_format_two_document_only_changes_its_header() {
        let original: Value = serde_json::from_str(FORMAT_2_PROJECT).unwrap();
        let mut document = original.clone();
        upgrade(&mut document, 2);

        assert_eq!(document["formatVersion"], 4);
        assert_eq!(document["minReaderVersion"], 4);
        let mut header_restored = document;
        header_restored["formatVersion"] = json!(2);
        header_restored["minReaderVersion"] = json!(2);
        assert_eq!(header_restored, original);
    }

    #[test]
    fn shapes_it_does_not_recognise_are_left_alone() {
        let mut document = json!({ "formatVersion": 1, "snapshot": "nope" });
        upgrade(&mut document, 1);
        assert_eq!(document["snapshot"], "nope");

        let mut document = json!([1, 2, 3]);
        upgrade(&mut document, 1);
        assert_eq!(document, json!([1, 2, 3]));
    }

    #[test]
    fn current_documents_are_not_touched() {
        let mut document = json!({ "formatVersion": 4, "minReaderVersion": 4, "snapshot": { "tables": [
            { "name": { "schema": "dbo", "name": "T" }, "checkConstraints": [ { "name": "CK", "expression": "" } ] }
        ] } });
        let original = document.clone();
        upgrade(&mut document, 4);
        assert_eq!(document, original);
    }

    #[test]
    fn the_format_one_fixture_parses_after_the_upgrade() {
        let mut document: Value = serde_json::from_str(FORMAT_1_PROJECT).unwrap();
        upgrade(&mut document, 1);
        let project: Project = serde_json::from_value(document).unwrap();

        assert_eq!(project.format_version, 4);
        assert_eq!(project.min_reader_version, 4);
        let snapshot = &project.content.snapshot;
        assert_eq!(snapshot.access, None);
        // 1.0 never read code or index state: neither is presented as captured.
        assert_eq!(snapshot.programmability, None);
        let orders = snapshot
            .tables
            .iter()
            .find(|table| table.name.name == "Orders")
            .unwrap();
        assert_eq!(
            orders.check_constraints[0].expression,
            Definition::NotRecorded
        );
        assert_eq!(orders.check_constraints[0].is_enabled, None);
        assert_eq!(orders.check_constraints[0].is_trusted, None);
        for table in &snapshot.tables {
            assert_eq!(
                table.primary_key.as_ref().and_then(|key| key.is_enabled),
                None
            );
            for index in &table.indexes {
                assert_eq!(
                    (&index.included_columns, index.is_filtered, index.is_enabled),
                    (&None, None, None)
                );
            }
        }
        assert_eq!(
            orders.column("PlacedAt").unwrap().default_expression,
            Some(Definition::NotRecorded)
        );
        let customers = snapshot
            .tables
            .iter()
            .find(|table| table.name.name == "Customers")
            .unwrap();
        assert_eq!(
            customers.column("CreatedAt").unwrap().default_expression,
            Some(Definition::readable("(sysutcdatetime())"))
        );
        assert_eq!(customers.column("Notes").unwrap().default_expression, None);
        assert_eq!(
            customers.check_constraints[0].expression,
            Definition::readable("(len([Name])>(0))")
        );
    }
}
