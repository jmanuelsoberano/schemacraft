//! High-fidelity export of a rendered diagram.
//!
//! The frontend renders the diagram to SVG from the same geometry the canvas uses and hands the
//! document over. This module writes it as SVG or HTML, rasterises it to PNG with resvg, or
//! converts it to a single-page PDF with svg2pdf. The fonts are bundled, so every machine
//! produces the same file.

mod error;
mod fonts;
mod render;

use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

pub use error::{ExportError, ExportErrorKind};
pub use fonts::{MONO_FAMILY, SANS_FAMILY};
pub use render::PNG_SCALES;

use crate::project::write_bytes_atomically;

/// Longest side a PNG may have, in pixels; larger rasters would exhaust memory.
pub const MAX_RASTER_SIDE: u16 = 16_384;

/// Output format of an export.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "export/")]
pub enum ExportFormat {
    /// Continuous vector graphic with selectable text.
    Svg,
    /// Self-contained interactive page.
    Html,
    /// Raster image at 1x, 2x or 4x.
    Png,
    /// Single-page vector document the size of the diagram.
    Pdf,
}

/// What to export and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "export/")]
pub struct ExportRequest {
    /// Output format.
    pub format: ExportFormat,
    /// Destination path; an existing file is replaced atomically.
    pub destination: String,
    /// The SVG document for `svg`, `png` and `pdf`; the complete page for `html`.
    pub document: String,
    /// Device pixels per CSS pixel for `png`; ignored by the other formats.
    pub scale: u8,
}

/// Stage an export is in, for progress display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "export/")]
pub enum ExportStage {
    /// Parsing the document and rasterising or converting it.
    Rendering,
    /// Writing the file.
    Writing,
}

/// What an export produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "export/")]
pub struct ExportOutcome {
    /// Path of the written file.
    pub path: String,
    /// Size of the written file.
    #[ts(type = "number")]
    pub bytes: u64,
    /// Pixel width of a PNG; `None` for the other formats.
    pub width: Option<u32>,
    /// Pixel height of a PNG; `None` for the other formats.
    pub height: Option<u32>,
}

/// Writes the export described by `request`, reporting each stage through `on_stage` and giving
/// up between stages once `cancellation` fires. The destination is only touched at the end.
pub fn export_diagram(
    request: &ExportRequest,
    on_stage: &dyn Fn(ExportStage),
    cancellation: &CancellationToken,
) -> Result<ExportOutcome, ExportError> {
    on_stage(ExportStage::Rendering);
    let (bytes, size) = match request.format {
        ExportFormat::Svg | ExportFormat::Html => (request.document.clone().into_bytes(), None),
        ExportFormat::Png => {
            let tree = render::parse(&request.document)?;
            let raster = render::to_png(&tree, request.scale)?;
            (raster.bytes, Some((raster.width, raster.height)))
        }
        ExportFormat::Pdf => {
            let tree = render::parse(&request.document)?;
            (render::to_pdf(&tree)?, None)
        }
    };
    if cancellation.is_cancelled() {
        return Err(ExportError::Cancelled);
    }

    on_stage(ExportStage::Writing);
    write_bytes_atomically(Path::new(&request.destination), &bytes).map_err(|error| {
        ExportError::Write {
            path: request.destination.clone(),
            details: error.to_string(),
        }
    })?;
    Ok(ExportOutcome {
        path: request.destination.clone(),
        bytes: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
        width: size.map(|(width, _)| width),
        height: size.map(|(_, height)| height),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use std::fs;
    use std::sync::Mutex;

    use tokio_util::sync::CancellationToken;

    use super::{ExportError, ExportFormat, ExportRequest, ExportStage, export_diagram};

    const DIAGRAM: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">
  <style>.name { font-family: "JetBrains Mono"; font-weight: 600; font-size: 12px; } .column { font-family: Inter; font-size: 12px; }</style>
  <rect width="320" height="120" fill="#f6f7f9"/>
  <rect x="20" y="20" width="240" height="60" rx="10" fill="#ffffff" stroke="#dcdee3"/>
  <text x="34" y="44" class="name">dbo.Órdenes</text>
  <text x="34" y="68" class="column">CustomerId</text>
</svg>"##;

    fn request(format: ExportFormat, destination: &std::path::Path, scale: u8) -> ExportRequest {
        ExportRequest {
            format,
            destination: destination.display().to_string(),
            document: DIAGRAM.to_string(),
            scale,
        }
    }

    fn run(
        request: &ExportRequest,
    ) -> (Result<super::ExportOutcome, ExportError>, Vec<ExportStage>) {
        let stages = Mutex::new(Vec::new());
        let outcome = export_diagram(
            request,
            &|stage| stages.lock().unwrap().push(stage),
            &CancellationToken::new(),
        );
        (outcome, stages.into_inner().unwrap())
    }

    fn png_size(bytes: &[u8]) -> (u32, u32) {
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        (width, height)
    }

    #[test]
    fn writes_svg_verbatim_and_reports_stages() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested").join("diagram.svg");
        let (outcome, stages) = run(&request(ExportFormat::Svg, &path, 1));
        let outcome = outcome.unwrap();
        assert_eq!(stages, vec![ExportStage::Rendering, ExportStage::Writing]);
        assert_eq!(fs::read_to_string(&path).unwrap(), DIAGRAM);
        assert_eq!(outcome.bytes, u64::try_from(DIAGRAM.len()).unwrap());
        assert_eq!((outcome.width, outcome.height), (None, None));
        assert!(
            !directory
                .path()
                .join("nested")
                .join("diagram.svg.tmp")
                .exists()
        );
    }

    #[test]
    fn rasterises_png_at_the_requested_scale() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("diagram.png");
        let (outcome, _) = run(&request(ExportFormat::Png, &path, 2));
        let outcome = outcome.unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(png_size(&bytes), (640, 240));
        assert_eq!((outcome.width, outcome.height), (Some(640), Some(240)));
        assert_eq!(outcome.bytes, u64::try_from(bytes.len()).unwrap());
    }

    #[test]
    fn refuses_unknown_scales_and_oversized_rasters() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("diagram.png");
        let (outcome, _) = run(&request(ExportFormat::Png, &path, 3));
        assert!(matches!(outcome, Err(ExportError::InvalidRequest { .. })));

        let mut huge = request(ExportFormat::Png, &path, 4);
        huge.document = DIAGRAM.replace("width=\"320\"", "width=\"9000\"");
        let (outcome, _) = run(&huge);
        assert!(matches!(
            outcome,
            Err(ExportError::TooLarge { width: 36_000, .. })
        ));
        assert!(!path.exists());
    }

    #[test]
    fn converts_to_a_single_page_pdf_the_size_of_the_diagram() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("diagram.pdf");
        let (outcome, _) = run(&request(ExportFormat::Pdf, &path, 1));
        outcome.unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"%PDF-1."));
        let text = String::from_utf8_lossy(&bytes);
        // 320 x 120 CSS px at 96 dpi are 240 x 90 PDF points.
        assert!(
            text.contains("/MediaBox [0 0 240 90]"),
            "page must match the diagram size"
        );
        assert_eq!(
            text.matches("/Type /Page\n").count() + text.matches("/Type /Page ").count(),
            1
        );
    }

    #[test]
    fn honours_cancellation_before_writing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("diagram.svg");
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let outcome = export_diagram(
            &request(ExportFormat::Svg, &path, 1),
            &|_| {},
            &cancellation,
        );
        assert_eq!(outcome, Err(ExportError::Cancelled));
        assert!(!path.exists());
    }

    #[test]
    fn reports_unwritable_destinations() {
        let directory = tempfile::tempdir().unwrap();
        let blocker = directory.path().join("taken");
        fs::write(&blocker, "a file, not a directory").unwrap();
        let path = blocker.join("diagram.svg");
        let (outcome, _) = run(&request(ExportFormat::Svg, &path, 1));
        assert!(matches!(outcome, Err(ExportError::Write { .. })));
    }
}
