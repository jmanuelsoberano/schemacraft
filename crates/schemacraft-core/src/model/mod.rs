//! Pure, database-agnostic representation of a relational schema.
//!
//! Every type here is plain data: no IO, no SQL and no framework attributes beyond `serde`
//! (JSON persistence and IPC) and `ts-rs` (TypeScript contract generation). JSON field names
//! are camelCase so that `.scraft` files and IPC payloads read naturally from the frontend.

mod column;
mod data_type;
mod foreign_key;
mod identifiers;
mod index;
mod snapshot;
mod table;
mod view;

pub use column::Column;
pub use data_type::{SqlDataType, TypeLength};
pub use foreign_key::{ForeignKey, ForeignKeyColumnPair, ReferentialAction};
pub use identifiers::QualifiedName;
pub use index::{CheckConstraint, Index, IndexKind, PrimaryKey};
pub use snapshot::SchemaSnapshot;
pub use table::Table;
pub use view::View;

#[cfg(test)]
pub(crate) mod test_fixtures;
