use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Column, QualifiedName};

/// A database view, modelled as a read-only object with columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct View {
    /// Stable identity of the view.
    pub name: QualifiedName,
    /// Columns in ordinal order.
    pub columns: Vec<Column>,
}
