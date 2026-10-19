//! `.scraft` project files.
//!
//! A project holds a schema snapshot, the connection it came from (never a password), the
//! inspection options and the state of the diagram, so a project reopens instantly without
//! touching the database. Files are pretty-printed JSON with camelCase keys, written atomically
//! and tagged with a format version and the oldest reader version that may open them. Older
//! files are upgraded when read; keys written by a newer version are kept at the document
//! root, the snapshot root, the snapshot's programmability, the canvas and each node, so saving
//! does not drop them.

mod canvas;
mod connection;
mod document;
mod error;
mod file;
mod migrations;

pub use canvas::{CanvasState, DetailLevel, LayoutKind, NodeState, Point, Viewport};
pub use connection::{SavedConnection, SavedSqlServerAuthentication, SavedSqlServerConnection};
pub use document::{FORMAT_VERSION, MIN_READER_VERSION, OpenedProject, Project, ProjectContent};
pub use error::{ProjectError, ProjectErrorKind};
pub use file::{read_project, write_project};

/// File extension of project files, without the dot.
pub const PROJECT_FILE_EXTENSION: &str = "scraft";

#[cfg(test)]
mod forward_read;
#[cfg(test)]
pub(crate) mod test_fixtures;
