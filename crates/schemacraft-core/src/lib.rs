//! Database-agnostic core of SchemaCraft.
//!
//! This crate knows nothing about Tauri or any UI framework. It is organised in layers that
//! only depend inwards:
//!
//! * [`model`]: pure data structures describing a relational schema.
//! * `inspectors` (milestone 2): the `DatabaseInspector` strategy and its SQL Server implementation.
//! * `project` (milestone 3): persistence of `.scraft` project files.
//! * `diff` (milestone 3): comparison of two schema snapshots.
//!
//! A module is added to the crate only once it carries real behaviour.

pub mod model;
