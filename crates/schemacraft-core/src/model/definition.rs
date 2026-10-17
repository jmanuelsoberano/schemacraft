use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Text of a `CHECK` or `DEFAULT` expression, together with whether it could be read.
///
/// Databases hide the text from a login without the right to read definitions (on SQL Server,
/// `VIEW DEFINITION`) while still showing that the expression exists, so "no text" never means
/// "no expression". The status tells the cases apart, and the diff, the refresh and every view
/// of the text depend on that distinction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum Definition {
    /// The text as stored by the database, e.g. `([Quantity]>(0))`.
    Readable {
        /// Expression text.
        text: String,
    },
    /// The expression exists, but the login that read the schema cannot see its text.
    NotVisible,
    /// The file that holds the expression did not record its text. Upgraded 1.0 files use it
    /// where the old format could not tell an unreadable text from a missing one.
    NotRecorded,
    /// A status written by a newer version of SchemaCraft, read as "text not available".
    #[serde(other)]
    Unknown,
}

impl Definition {
    /// A readable expression.
    pub fn readable(text: impl Into<String>) -> Self {
        Self::Readable { text: text.into() }
    }

    /// The expression text, when it could be read.
    pub fn text(&self) -> Option<&str> {
        match self {
            Self::Readable { text } => Some(text),
            Self::NotVisible | Self::NotRecorded | Self::Unknown => None,
        }
    }

    /// Whether the capture knew what it was looking at: `true` for a readable text and for a
    /// text it could not see, `false` when the state was not recorded or comes from a newer
    /// version. An unknown state never counts as a change.
    pub fn is_known(&self) -> bool {
        matches!(self, Self::Readable { .. } | Self::NotVisible)
    }

    /// Whether both texts are readable and different. A text that could not be read never
    /// differs from anything: not being able to see it says nothing about whether it changed.
    pub fn differs_from(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Readable { text: left }, Self::Readable { text: right }) => left != right,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::Definition;

    #[test]
    fn serialises_tagged_by_status() {
        assert_eq!(
            serde_json::to_value(Definition::readable("((0))")).unwrap(),
            serde_json::json!({ "status": "readable", "text": "((0))" })
        );
        assert_eq!(
            serde_json::to_value(Definition::NotVisible).unwrap(),
            serde_json::json!({ "status": "notVisible" })
        );
        assert_eq!(
            serde_json::to_value(Definition::NotRecorded).unwrap(),
            serde_json::json!({ "status": "notRecorded" })
        );

        let restored: Definition =
            serde_json::from_str(r#"{ "status": "readable", "text": "(getdate())" }"#).unwrap();
        assert_eq!(restored.text(), Some("(getdate())"));
    }

    #[test]
    fn a_status_from_a_newer_version_reads_as_unknown() {
        let definition: Definition =
            serde_json::from_str(r#"{ "status": "maskedByPolicy", "reason": "x" }"#).unwrap();
        assert_eq!(definition, Definition::Unknown);
        assert_eq!(definition.text(), None);
        assert!(!definition.is_known());
    }

    #[test]
    fn only_readable_and_not_visible_states_are_known() {
        assert!(Definition::readable("1").is_known());
        assert!(Definition::NotVisible.is_known());
        assert!(!Definition::NotRecorded.is_known());
        assert!(!Definition::Unknown.is_known());
    }

    #[test]
    fn only_two_different_readable_texts_differ() {
        let zero = Definition::readable("((0))");
        let one = Definition::readable("((1))");
        let states = [
            Definition::NotVisible,
            Definition::NotRecorded,
            Definition::Unknown,
        ];

        assert!(zero.differs_from(&one));
        assert!(!zero.differs_from(&zero.clone()));
        for state in &states {
            assert!(!zero.differs_from(state));
            assert!(!state.differs_from(&zero));
            for other in &states {
                assert!(!state.differs_from(other));
            }
        }
    }
}
