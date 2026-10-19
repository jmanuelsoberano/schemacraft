//! Pure, database-agnostic representation of a relational schema.
//!
//! Every type here is plain data: no IO, no SQL and no framework attributes beyond `serde`
//! (JSON persistence and IPC) and `ts-rs` (TypeScript contract generation). JSON field names
//! are camelCase so that `.scraft` files and IPC payloads read naturally from the frontend.

mod access;
mod carry_over;
mod column;
mod data_type;
mod definition;
mod foreign_key;
mod identifiers;
mod index;
mod programmability;
mod snapshot;
mod table;
mod view;

pub use access::{
    AccessCounts, AccessCoverage, AccessLevel, AccessProbe, AccessProfile, CaptureScope,
    Completeness, SchemaAccess,
};
pub use carry_over::{CarriedFact, SnapshotFact};
pub use column::Column;
pub use data_type::{SqlDataType, TypeLength};
pub use definition::Definition;
pub use foreign_key::{
    ForeignKey, ForeignKeyColumnPair, ForeignKeyToInvisibleTable, ReferentialAction,
};
pub use identifiers::QualifiedName;
pub use index::{CheckConstraint, Index, IndexKind, PrimaryKey};
pub use programmability::{
    CaptureState, CarriedCode, CarriedPart, CodeCapture, CodeObjectRef, DmlEvent, FiringOrder,
    ModuleBody, NotReadReason, Parameter, Programmability, Routine, RoutineKind, Trigger,
    TriggerEvent, TriggerTiming, ViewModule,
};
pub use snapshot::SchemaSnapshot;
pub use table::Table;
pub use view::View;

/// JSON keys a newer version wrote and this one does not know. Documents keep them in a map
/// at a few chosen levels (the document root, the snapshot root, the snapshot's
/// programmability, the canvas and each node) and write them back unchanged, so opening and
/// saving a file in an older version does not lose what a newer one added.
pub type UnknownFields = serde_json::Map<String, serde_json::Value>;

#[cfg(test)]
pub(crate) mod test_fixtures;
