use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Schema-qualified name of a database object, e.g. `dbo.Orders`.
///
/// It is the stable identity of a table or view: snapshots taken at different times are
/// matched by qualified name, which is what lets the diff engine preserve diagram positions.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct QualifiedName {
    /// Owning schema, e.g. `dbo`.
    pub schema: String,
    /// Object name within the schema, e.g. `Orders`.
    pub name: String,
}

impl QualifiedName {
    /// Creates a qualified name from its schema and object name.
    pub fn new(schema: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            schema: schema.into(),
            name: name.into(),
        }
    }
}

impl fmt::Display for QualifiedName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}.{}", self.schema, self.name)
    }
}

#[cfg(test)]
mod tests {
    use super::QualifiedName;

    #[test]
    fn displays_as_schema_dot_name() {
        assert_eq!(
            QualifiedName::new("sales", "Orders").to_string(),
            "sales.Orders"
        );
    }

    #[test]
    fn orders_by_schema_then_name() {
        let mut names = [
            QualifiedName::new("sales", "Orders"),
            QualifiedName::new("dbo", "Users"),
            QualifiedName::new("dbo", "Accounts"),
        ];
        names.sort();
        let rendered: Vec<String> = names.iter().map(ToString::to_string).collect();
        assert_eq!(rendered, ["dbo.Accounts", "dbo.Users", "sales.Orders"]);
    }
}
