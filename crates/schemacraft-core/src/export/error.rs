use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::diagnostics::{ClosedKind, ErrorSummary};

/// Failure to produce an export file.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ExportError {
    /// The request asks for something the exporter cannot do, such as an unknown scale.
    #[error("the export request is invalid: {details}")]
    InvalidRequest {
        /// What is wrong with the request.
        details: String,
    },
    /// The SVG document could not be parsed, rasterised or converted.
    #[error("the diagram could not be rendered: {details}")]
    Render {
        /// Renderer message.
        details: String,
    },
    /// The requested raster is larger than the exporter is willing to allocate.
    #[error("a {width} x {height} px image exceeds the {limit} px limit; choose a smaller scale")]
    TooLarge {
        /// Requested width in pixels.
        width: u32,
        /// Requested height in pixels.
        height: u32,
        /// Longest side allowed, in pixels.
        limit: u32,
    },
    /// The file could not be written.
    #[error("could not write {path}: {details}")]
    Write {
        /// Destination that was requested.
        path: String,
        /// Operating system message.
        details: String,
    },
    /// The user cancelled the export before it was written.
    #[error("the export was cancelled")]
    Cancelled,
}

impl ExportError {
    /// Classification for the UI.
    pub fn kind(&self) -> ExportErrorKind {
        match self {
            Self::InvalidRequest { .. } => ExportErrorKind::InvalidRequest,
            Self::Render { .. } => ExportErrorKind::Render,
            Self::TooLarge { .. } => ExportErrorKind::TooLarge,
            Self::Write { .. } => ExportErrorKind::Write,
            Self::Cancelled => ExportErrorKind::Cancelled,
        }
    }

    /// What the diagnostic log may record of this error: its kind, never the path.
    pub fn log_summary(&self) -> ErrorSummary<ExportErrorKind> {
        ErrorSummary::of(self.kind())
    }
}

impl ClosedKind for ExportErrorKind {}

/// Serialisable classification of an [`ExportError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "export/")]
pub enum ExportErrorKind {
    /// See [`ExportError::InvalidRequest`].
    InvalidRequest,
    /// See [`ExportError::Render`].
    Render,
    /// See [`ExportError::TooLarge`].
    TooLarge,
    /// See [`ExportError::Write`].
    Write,
    /// See [`ExportError::Cancelled`].
    Cancelled,
}

#[cfg(test)]
mod tests {
    use super::{ExportError, ExportErrorKind};

    #[test]
    fn errors_classify_themselves_and_explain() {
        let error = ExportError::TooLarge {
            width: 40_000,
            height: 12_000,
            limit: 16_384,
        };
        assert_eq!(error.kind(), ExportErrorKind::TooLarge);
        assert!(error.to_string().contains("40000 x 12000"));
        assert_eq!(ExportError::Cancelled.kind(), ExportErrorKind::Cancelled);
    }
}
