//! `.scraft` project files.
//!
//! A project holds a schema snapshot, the connection it came from (never a password), the
//! inspection options and the state of the diagram, so a project reopens instantly without
//! touching the database. Files are pretty-printed JSON with camelCase keys, written atomically
//! and tagged with a format version for forward compatibility.

mod canvas;
mod connection;
mod document;
mod error;
mod file;

pub use canvas::{CanvasState, DetailLevel, LayoutKind, NodeState, Point, Viewport};
pub use connection::{SavedConnection, SavedSqlServerAuthentication, SavedSqlServerConnection};
pub use document::{FORMAT_VERSION, Project, ProjectContent};
pub use error::{ProjectError, ProjectErrorKind};
pub use file::{read_project, write_project};

pub(crate) use file::{JsonFileError, read_json_bytes, write_json_atomically};

/// File extension of project files, without the dot.
pub const PROJECT_FILE_EXTENSION: &str = "scraft";

#[cfg(test)]
pub(crate) mod test_fixtures;
