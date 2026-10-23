use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{SourceDiffLine, SourceDiffStatus, SourceLineDiff, SourceLineEnding, SourceLineKind};
use crate::source_text::comparable_text;

const MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SOURCE_LINES: usize = 250_000;
const MAX_PAGE_ROWS: usize = 2_000;
const MAX_WORK: usize = 4_000_000;
const LOOKAHEAD: usize = 64;

/// Paging and computation bounds for a literal source comparison.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct SourceDiffOptions {
    /// Zero-based result-row offset, not a source line number.
    pub offset: usize,
    /// Requested result rows, capped at 2,000 independently of input size.
    pub limit: usize,
    /// Maximum comparison steps, capped at four million.
    pub max_work: usize,
}

impl Default for SourceDiffOptions {
    fn default() -> Self {
        Self {
            offset: 0,
            limit: 500,
            max_work: MAX_WORK,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Line<'a> {
    text: &'a str,
    ending: SourceLineEnding,
}

fn source_lines(source: &str) -> Vec<Line<'_>> {
    let bytes = source.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        let Some(byte) = bytes.get(index).copied() else {
            break;
        };
        let ending = match byte {
            b'\n' => Some((SourceLineEnding::Lf, 1)),
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => Some((SourceLineEnding::CrLf, 2)),
            b'\r' => Some((SourceLineEnding::Cr, 1)),
            _ => None,
        };
        if let Some((ending, width)) = ending {
            lines.push(Line {
                text: source.get(start..index).unwrap_or_default(),
                ending,
            });
            index += width;
            start = index;
        } else {
            index += 1;
        }
    }
    if start < source.len() {
        lines.push(Line {
            text: source.get(start..).unwrap_or_default(),
            ending: SourceLineEnding::None,
        });
    }
    lines
}

struct Output {
    options: SourceDiffOptions,
    rows: usize,
    work: usize,
    lines: Vec<SourceDiffLine>,
}

impl Output {
    fn emit(
        &mut self,
        kind: SourceLineKind,
        before: Option<usize>,
        after: Option<usize>,
        line: Line<'_>,
    ) {
        if self.rows >= self.options.offset
            && self.lines.len() < self.options.limit.min(MAX_PAGE_ROWS)
        {
            self.lines.push(SourceDiffLine {
                kind,
                reference_line: before.map(|index| index + 1),
                compared_line: after.map(|index| index + 1),
                text: line.text.to_string(),
                ending: line.ending,
            });
        }
        self.rows += 1;
    }

    fn step(&mut self, cancelled: &mut impl FnMut() -> bool) -> Result<(), SourceDiffStatus> {
        self.work += 1;
        if self.work > self.options.max_work.min(MAX_WORK) {
            Err(SourceDiffStatus::Limited)
        } else if cancelled() {
            Err(SourceDiffStatus::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// Compares original lines with bounded lookahead, linear storage and explicit cancellation.
///
/// This is a deterministic edit script, not a promise of a globally minimal edit script.
/// Bounded lookahead prevents a dissimilar large module from allocating or computing a
/// quadratic whole-file matrix. Replaying non-added/non-removed rows reconstructs each input
/// exactly, including CR, LF, CRLF and a missing final newline. Callers retain the originals
/// separately and disclose `limited`/`cancelled` instead of presenting a partial result as full.
pub fn compare_source_lines(
    reference: &str,
    compared: &str,
    options: SourceDiffOptions,
    mut cancelled: impl FnMut() -> bool,
) -> SourceLineDiff {
    let exact_equal = reference == compared;
    let mut result = SourceLineDiff {
        status: SourceDiffStatus::Complete,
        exact_equal,
        equal_under_legacy_normalization: false,
        lines: Vec::new(),
        total_rows: None,
        next_offset: None,
    };
    if cancelled() {
        result.status = SourceDiffStatus::Cancelled;
        return result;
    }
    if reference.len().max(compared.len()) > MAX_SOURCE_BYTES {
        result.status = SourceDiffStatus::Limited;
        return result;
    }
    result.equal_under_legacy_normalization =
        comparable_text(reference) == comparable_text(compared);
    let before = source_lines(reference);
    let after = source_lines(compared);
    if before.len().max(after.len()) > MAX_SOURCE_LINES {
        result.status = SourceDiffStatus::Limited;
        return result;
    }
    let mut output = Output {
        options,
        rows: 0,
        work: 0,
        lines: Vec::new(),
    };
    let status = edit_script(&before, &after, &mut output, &mut cancelled);
    result.status = status.err().unwrap_or(SourceDiffStatus::Complete);
    if result.status == SourceDiffStatus::Complete {
        result.total_rows = Some(output.rows);
        let next = options.offset.saturating_add(output.lines.len());
        if next < output.rows && !output.lines.is_empty() {
            result.next_offset = Some(next);
        }
    }
    result.lines = output.lines;
    result
}

fn edit_script(
    before: &[Line<'_>],
    after: &[Line<'_>],
    output: &mut Output,
    cancelled: &mut impl FnMut() -> bool,
) -> Result<(), SourceDiffStatus> {
    let mut left = 0;
    let mut right = 0;
    while left < before.len() || right < after.len() {
        output.step(cancelled)?;
        match (before.get(left), after.get(right)) {
            (Some(a), Some(b)) if a == b => {
                output.emit(SourceLineKind::Unchanged, Some(left), Some(right), *a);
                left += 1;
                right += 1;
            }
            (Some(a), Some(b)) => {
                let removed = alignment_distance(before, left, *b, output, cancelled)?;
                let added = alignment_distance(after, right, *a, output, cancelled)?;
                if added.is_some_and(|count| removed.is_none_or(|other| count <= other)) {
                    output.emit(SourceLineKind::Added, None, Some(right), *b);
                    right += 1;
                } else if removed.is_some() {
                    output.emit(SourceLineKind::Removed, Some(left), None, *a);
                    left += 1;
                } else {
                    output.emit(SourceLineKind::Removed, Some(left), None, *a);
                    output.emit(SourceLineKind::Added, None, Some(right), *b);
                    left += 1;
                    right += 1;
                }
            }
            (Some(a), None) => {
                output.emit(SourceLineKind::Removed, Some(left), None, *a);
                left += 1;
            }
            (None, Some(b)) => {
                output.emit(SourceLineKind::Added, None, Some(right), *b);
                right += 1;
            }
            (None, None) => break,
        }
    }
    Ok(())
}

fn alignment_distance(
    lines: &[Line<'_>],
    index: usize,
    target: Line<'_>,
    output: &mut Output,
    cancelled: &mut impl FnMut() -> bool,
) -> Result<Option<usize>, SourceDiffStatus> {
    for distance in 1..=LOOKAHEAD {
        let Some(candidate) = lines.get(index + distance) else {
            break;
        };
        output.step(cancelled)?;
        if *candidate == target {
            return Ok(Some(distance));
        }
    }
    Ok(None)
}
