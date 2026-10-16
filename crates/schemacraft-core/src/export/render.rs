use resvg::tiny_skia::{Pixmap, Transform};
use usvg::{Options, Tree};

use super::MAX_RASTER_SIDE;
use super::error::ExportError;
use super::fonts::font_database;

/// Scales the exporter accepts for PNG output.
pub const PNG_SCALES: [u8; 3] = [1, 2, 4];

/// A rendered PNG with its pixel size.
pub(crate) struct Raster {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Parses an SVG document with the bundled fonts available to its text.
pub(crate) fn parse(svg: &str) -> Result<Tree, ExportError> {
    let options = Options {
        fontdb: font_database(),
        ..Options::default()
    };
    Tree::from_str(svg, &options).map_err(|error| ExportError::Render {
        details: error.to_string(),
    })
}

/// Rasterises the tree at `scale` device pixels per CSS pixel and encodes it as PNG.
pub(crate) fn to_png(tree: &Tree, scale: u8) -> Result<Raster, ExportError> {
    if !PNG_SCALES.contains(&scale) {
        return Err(ExportError::InvalidRequest {
            details: format!("scale {scale} is not one of 1, 2 or 4"),
        });
    }
    let factor = f32::from(scale);
    let size = tree.size();
    let width = pixels(size.width() * factor);
    let height = pixels(size.height() * factor);
    let limit = u32::from(MAX_RASTER_SIDE);
    if width > limit || height > limit {
        return Err(ExportError::TooLarge {
            width,
            height,
            limit,
        });
    }

    let mut pixmap =
        Pixmap::new(width.max(1), height.max(1)).ok_or_else(|| ExportError::Render {
            details: format!("a {width} x {height} px image cannot be allocated"),
        })?;
    resvg::render(
        tree,
        Transform::from_scale(factor, factor),
        &mut pixmap.as_mut(),
    );
    let bytes = pixmap.encode_png().map_err(|error| ExportError::Render {
        details: error.to_string(),
    })?;
    Ok(Raster {
        bytes,
        width: pixmap.width(),
        height: pixmap.height(),
    })
}

/// Converts the tree to a single-page PDF whose page is the size of the diagram, with the text
/// embedded as selectable text.
pub(crate) fn to_pdf(tree: &Tree) -> Result<Vec<u8>, ExportError> {
    let conversion = svg2pdf::ConversionOptions {
        compress: true,
        embed_text: true,
        ..svg2pdf::ConversionOptions::default()
    };
    // The SVG is laid out in CSS pixels; 96 per inch keeps the printed size true.
    let page = svg2pdf::PageOptions { dpi: 96.0 };
    svg2pdf::to_pdf(tree, conversion, page).map_err(|error| ExportError::Render {
        details: error.to_string(),
    })
}

/// Rounds a CSS length up to whole pixels; huge values saturate instead of overflowing.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "float to integer casts saturate, and negative lengths do not occur"
)]
fn pixels(length: f32) -> u32 {
    length.max(0.0).ceil() as u32
}
