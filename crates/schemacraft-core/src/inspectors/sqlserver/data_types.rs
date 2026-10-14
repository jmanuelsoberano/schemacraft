//! Rules that turn `sys.columns` metadata into a [`SqlDataType`].
//!
//! The catalog reports `max_length` in bytes (`-1` for `MAX`), `precision` and `scale` for
//! every column regardless of whether they apply. Which values matter depends on the type
//! family, and that knowledge lives here and nowhere else.

use crate::model::{SqlDataType, TypeLength};

/// Raw type information of one column as reported by the catalog.
#[derive(Debug, Clone, Copy)]
pub(super) struct CatalogTypeInformation<'a> {
    /// Underlying system type, e.g. `nvarchar`, even for alias types.
    pub system_type_name: &'a str,
    /// Schema-qualified alias type the column was declared with, when it is user-defined.
    pub user_defined_type_name: Option<&'a str>,
    /// Storage length in bytes, `-1` for `MAX` types.
    pub max_length: i16,
    /// Numeric precision as stored by the catalog.
    pub precision: u8,
    /// Numeric scale, which doubles as fractional-seconds precision for date and time types.
    pub scale: u8,
}

/// Builds the structured data type for a column.
pub(super) fn data_type_from_catalog(information: CatalogTypeInformation<'_>) -> SqlDataType {
    let name = information.system_type_name.to_ascii_lowercase();

    let mut data_type = match name.as_str() {
        "char" | "varchar" | "binary" | "varbinary" => {
            SqlDataType::with_length(name.as_str(), byte_length(information.max_length))
        }
        "nchar" | "nvarchar" => {
            SqlDataType::with_length(name.as_str(), character_length(information.max_length))
        }
        "decimal" | "numeric" => SqlDataType::with_precision_and_scale(
            name.as_str(),
            information.precision,
            information.scale,
        ),
        "datetime2" | "time" | "datetimeoffset" => {
            SqlDataType::with_precision(name.as_str(), information.scale)
        }
        _ => SqlDataType::plain(name.as_str()),
    };

    data_type.user_defined_type_name = information.user_defined_type_name.map(str::to_string);
    data_type
}

fn byte_length(max_length: i16) -> TypeLength {
    if max_length < 0 {
        TypeLength::Max
    } else {
        TypeLength::Fixed {
            value: u32::from(max_length.unsigned_abs()),
        }
    }
}

/// Unicode types store two bytes per character.
fn character_length(max_length: i16) -> TypeLength {
    if max_length < 0 {
        TypeLength::Max
    } else {
        TypeLength::Fixed {
            value: u32::from(max_length.unsigned_abs()) / 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CatalogTypeInformation, data_type_from_catalog};

    fn declaration(system_type_name: &str, max_length: i16, precision: u8, scale: u8) -> String {
        data_type_from_catalog(CatalogTypeInformation {
            system_type_name,
            user_defined_type_name: None,
            max_length,
            precision,
            scale,
        })
        .declaration()
    }

    #[test]
    fn character_types_report_characters_not_bytes() {
        assert_eq!(declaration("nvarchar", 120, 0, 0), "NVARCHAR(60)");
        assert_eq!(declaration("nchar", 20, 0, 0), "NCHAR(10)");
        assert_eq!(declaration("varchar", 50, 0, 0), "VARCHAR(50)");
        assert_eq!(declaration("char", 10, 0, 0), "CHAR(10)");
    }

    #[test]
    fn negative_length_means_max() {
        assert_eq!(declaration("nvarchar", -1, 0, 0), "NVARCHAR(MAX)");
        assert_eq!(declaration("varchar", -1, 0, 0), "VARCHAR(MAX)");
        assert_eq!(declaration("varbinary", -1, 0, 0), "VARBINARY(MAX)");
    }

    #[test]
    fn binary_types_report_bytes() {
        assert_eq!(declaration("binary", 16, 0, 0), "BINARY(16)");
        assert_eq!(declaration("varbinary", 8, 0, 0), "VARBINARY(8)");
    }

    #[test]
    fn exact_numerics_report_precision_and_scale() {
        assert_eq!(declaration("decimal", 9, 18, 2), "DECIMAL(18,2)");
        assert_eq!(declaration("numeric", 9, 10, 0), "NUMERIC(10,0)");
    }

    #[test]
    fn date_time_types_report_fractional_seconds_from_scale() {
        assert_eq!(declaration("datetime2", 8, 27, 7), "DATETIME2(7)");
        assert_eq!(declaration("time", 5, 16, 3), "TIME(3)");
        assert_eq!(
            declaration("datetimeoffset", 10, 34, 0),
            "DATETIMEOFFSET(0)"
        );
    }

    #[test]
    fn other_types_are_plain_regardless_of_catalog_values() {
        assert_eq!(declaration("int", 4, 10, 0), "INT");
        assert_eq!(declaration("bigint", 8, 19, 0), "BIGINT");
        assert_eq!(declaration("bit", 1, 1, 0), "BIT");
        assert_eq!(declaration("float", 8, 53, 0), "FLOAT");
        assert_eq!(declaration("real", 4, 24, 0), "REAL");
        assert_eq!(declaration("money", 8, 19, 4), "MONEY");
        assert_eq!(
            declaration("uniqueidentifier", 16, 0, 0),
            "UNIQUEIDENTIFIER"
        );
        assert_eq!(declaration("xml", -1, 0, 0), "XML");
        assert_eq!(declaration("text", 16, 0, 0), "TEXT");
        assert_eq!(declaration("datetime", 8, 23, 3), "DATETIME");
        assert_eq!(declaration("date", 3, 10, 0), "DATE");
        assert_eq!(declaration("hierarchyid", 892, 0, 0), "HIERARCHYID");
        assert_eq!(declaration("sql_variant", 8016, 0, 0), "SQL_VARIANT");
    }

    #[test]
    fn names_are_normalised_to_lower_case() {
        let data_type = data_type_from_catalog(CatalogTypeInformation {
            system_type_name: "NVARCHAR",
            user_defined_type_name: None,
            max_length: 256,
            precision: 0,
            scale: 0,
        });
        assert_eq!(data_type.name, "nvarchar");
        assert_eq!(data_type.declaration(), "NVARCHAR(128)");
    }

    #[test]
    fn alias_types_keep_their_name_next_to_the_system_type() {
        let data_type = data_type_from_catalog(CatalogTypeInformation {
            system_type_name: "decimal",
            user_defined_type_name: Some("dbo.Money2"),
            max_length: 9,
            precision: 19,
            scale: 4,
        });
        assert_eq!(data_type.declaration(), "DECIMAL(19,4)");
        assert_eq!(
            data_type.user_defined_type_name.as_deref(),
            Some("dbo.Money2")
        );
    }
}
