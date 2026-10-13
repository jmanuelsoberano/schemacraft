use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

/// Failure to read or write a project file.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProjectError {
    /// There is no file at the path, for example a recent project that was moved.
    #[error("the project file {path} does not exist")]
    NotFound {
        /// Path that was requested.
        path: String,
    },
    /// The file exists but could not be read.
    #[error("could not read {path}: {details}")]
    Read {
        /// Path that was requested.
        path: String,
        /// Operating system message.
        details: String,
    },
    /// The file could not be written.
    #[error("could not write {path}: {details}")]
    Write {
        /// Path that was requested.
        path: String,
        /// Operating system or serialisation message.
        details: String,
    },
    /// The file is not a SchemaCraft project, or it is damaged.
    #[error("{path} is not a SchemaCraft project: {details}")]
    NotAProject {
        /// Path that was requested.
        path: String,
        /// Parser message.
        details: String,
    },
    /// The file was written by a newer SchemaCraft.
    #[error("{path} uses project format {found}; this version reads up to format {supported}")]
    UnsupportedFormatVersion {
        /// Path that was requested.
        path: String,
        /// Version declared by the file.
        found: u32,
        /// Newest version this build understands.
        supported: u32,
    },
}

impl ProjectError {
    /// Classification for the UI.
    pub fn kind(&self) -> ProjectErrorKind {
        match self {
            Self::NotFound { .. } => ProjectErrorKind::NotFound,
            Self::Read { .. } => ProjectErrorKind::Read,
            Self::Write { .. } => ProjectErrorKind::Write,
            Self::NotAProject { .. } => ProjectErrorKind::NotAProject,
            Self::UnsupportedFormatVersion { .. } => ProjectErrorKind::UnsupportedFormatVersion,
        }
    }
}

/// Serialisable classification of a [`ProjectError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub enum ProjectErrorKind {
    /// See [`ProjectError::NotFound`].
    NotFound,
    /// See [`ProjectError::Read`].
    Read,
    /// See [`ProjectError::Write`].
    Write,
    /// See [`ProjectError::NotAProject`].
    NotAProject,
    /// See [`ProjectError::UnsupportedFormatVersion`].
    UnsupportedFormatVersion,
}

#[cfg(test)]
mod tests {
    use super::{ProjectError, ProjectErrorKind};

    #[test]
    fn errors_classify_themselves_and_name_the_file() {
        let error = ProjectError::UnsupportedFormatVersion {
            path: "C:\\projects\\shop.scraft".to_string(),
            found: 7,
            supported: 1,
        };
        assert_eq!(error.kind(), ProjectErrorKind::UnsupportedFormatVersion);
        assert!(error.to_string().contains("shop.scraft"));
        assert!(error.to_string().contains("format 7"));

        let missing = ProjectError::NotFound {
            path: "gone.scraft".to_string(),
        };
        assert_eq!(missing.kind(), ProjectErrorKind::NotFound);
    }
}
