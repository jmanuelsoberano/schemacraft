//! Database-agnostic core of SchemaCraft.
//!
//! This crate knows nothing about Tauri or any UI framework. It is organised in layers that
//! only depend inwards:
//!
//! * [`model`]: pure data structures describing a relational schema.
//! * [`inspectors`]: the `DatabaseInspector` strategy and its SQL Server implementation.
//! * [`project`]: persistence of `.scraft` project files, including the diagram state.
//! * [`diff`]: comparison of two schema snapshots, driving "refresh from database".
//! * [`preferences`]: connection history and recent projects, stored per user.
//! * [`credentials`]: remembered passwords, kept by the operating system credential store.
//! * [`export`]: SVG, HTML, PNG and PDF files from a rendered diagram, with bundled fonts.
//! * [`diagnostics`]: the typed events of the local diagnostic log, counts, timings and kinds
//!   only.
//!
//! A crate-private `fs` module holds the atomic file writes the persisting modules share, so
//! none of them depends sideways on another. `diagnostics` depends on `model` alone: the other
//! modules call its events and mark their own kinds as closed, so it never imports them.
//!
//! A module is added to the crate only once it carries real behaviour.

pub mod credentials;
pub mod diagnostics;
pub mod diff;
pub mod export;
mod fs;
pub mod inspectors;
pub mod model;
pub mod preferences;
pub mod project;
