use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Declared length of a character or binary type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum TypeLength {
    /// Fixed upper bound in characters or bytes, e.g. `VARCHAR(120)`.
    Fixed {
        /// Number of characters or bytes.
        value: u32,
    },
    /// Unbounded storage, e.g. `VARCHAR(MAX)`.
    Max,
}

/// Native data type of a column, kept structured so the UI renders it consistently.
///
/// `name` is the lowercase base type as reported by the database (`varchar`, `decimal`,
/// `datetime2`). Which of `length`, `precision` and `scale` apply depends on the type family,
/// and that knowledge belongs to the inspector that produced the value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct SqlDataType {
    /// Lowercase base type name, e.g. `varchar`.
    pub name: String,
    /// Declared length for character and binary types.
    pub length: Option<TypeLength>,
    /// Numeric precision, or fractional-seconds precision for date and time types.
    pub precision: Option<u8>,
    /// Numeric scale.
    pub scale: Option<u8>,
    /// Name of the user-defined alias type the column was declared with, e.g. `dbo.Money2`,
    /// when it is not a system type. `name` always holds the underlying system type.
    #[serde(default)]
    pub user_defined_type_name: Option<String>,
}

impl SqlDataType {
    /// A type without length, precision or scale, e.g. `int` or `bit`.
    pub fn plain(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            length: None,
            precision: None,
            scale: None,
            user_defined_type_name: None,
        }
    }

    /// A character or binary type with a declared length.
    pub fn with_length(name: impl Into<String>, length: TypeLength) -> Self {
        Self {
            length: Some(length),
            ..Self::plain(name)
        }
    }

    /// A type with precision only, e.g. `datetime2(7)` or `float(53)`.
    pub fn with_precision(name: impl Into<String>, precision: u8) -> Self {
        Self {
            precision: Some(precision),
            ..Self::plain(name)
        }
    }

    /// A numeric type with precision and scale, e.g. `decimal(18, 2)`.
    pub fn with_precision_and_scale(name: impl Into<String>, precision: u8, scale: u8) -> Self {
        Self {
            precision: Some(precision),
            scale: Some(scale),
            ..Self::plain(name)
        }
    }

    /// Canonical declaration as it would appear in DDL, e.g. `DECIMAL(18,2)` or `VARCHAR(MAX)`.
    pub fn declaration(&self) -> String {
        let base = self.name.to_uppercase();
        match (self.length, self.precision, self.scale) {
            (Some(TypeLength::Max), _, _) => format!("{base}(MAX)"),
            (Some(TypeLength::Fixed { value }), _, _) => format!("{base}({value})"),
            (None, Some(precision), Some(scale)) => format!("{base}({precision},{scale})"),
            (None, Some(precision), None) => format!("{base}({precision})"),
            (None, None, _) => base,
        }
    }
}

impl fmt::Display for SqlDataType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.declaration())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::indexing_slicing)]

    use super::{SqlDataType, TypeLength};

    #[test]
    fn renders_plain_types_in_upper_case() {
        assert_eq!(SqlDataType::plain("int").declaration(), "INT");
        assert_eq!(
            SqlDataType::plain("uniqueidentifier").to_string(),
            "UNIQUEIDENTIFIER"
        );
    }

    #[test]
    fn renders_fixed_and_max_lengths() {
        let fixed = SqlDataType::with_length("nvarchar", TypeLength::Fixed { value: 120 });
        let unbounded = SqlDataType::with_length("varbinary", TypeLength::Max);
        assert_eq!(fixed.declaration(), "NVARCHAR(120)");
        assert_eq!(unbounded.declaration(), "VARBINARY(MAX)");
    }

    #[test]
    fn renders_precision_and_scale() {
        let money = SqlDataType::with_precision_and_scale("decimal", 18, 2);
        let timestamp = SqlDataType::with_precision("datetime2", 7);
        assert_eq!(money.declaration(), "DECIMAL(18,2)");
        assert_eq!(timestamp.declaration(), "DATETIME2(7)");
    }

    #[test]
    fn serializes_length_as_tagged_object() {
        let data_type = SqlDataType::with_length("varchar", TypeLength::Max);
        let json = serde_json::to_value(&data_type).unwrap_or_default();
        assert_eq!(json["length"]["kind"], "max");
        assert_eq!(json["precision"], serde_json::Value::Null);
    }
}
