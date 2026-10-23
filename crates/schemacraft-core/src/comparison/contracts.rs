use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{AccessLevel, CaptureScope, DatabaseProvider, QualifiedName};

/// A comparison cannot assign equivalence to facts from different database engines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum ComparisonError {
    /// Choose two captures of the same engine instead of comparing unlike SQL dialects.
    #[error("Choose two projects captured from the same database engine.")]
    DifferentProviders,
}

/// Logical identity in a comparison, never a dotted string or a capture-local object ID.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonObjectRef {
    /// Closed kind of the compared object.
    pub kind: ComparisonObjectKind,
    /// Entity name, or the parent table/view for a trigger or foreign key.
    pub name: QualifiedName,
    /// Trigger or foreign-key name; absent for an independently named entity.
    pub member_name: Option<String>,
    /// Native input identity types, in declaration order, for overloaded routines.
    pub identity_arguments: Option<Vec<QualifiedName>>,
}

/// Object families understood by the comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum ComparisonObjectKind {
    /// Base table.
    Table,
    /// Database view and its captured settings/source state.
    View,
    /// Stored procedure or function.
    Routine,
    /// DML trigger identified within its parent.
    Trigger,
    /// Foreign key identified within its referencing table.
    ForeignKey,
}

/// What one capture can establish about an object or property.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum ComparisonObservationStatus {
    /// Positively read by this capture.
    Observed,
    /// The capture can establish that the object/property was absent.
    Absent,
    /// Outside the selected scope or explicitly disabled.
    Excluded,
    /// The capture cannot establish absence because visibility was incomplete.
    NotVisible,
    /// The file did not record the required evidence.
    NotRecorded,
    /// A historical observation retained after an incomplete refresh.
    Retained,
    /// An optional query failed or timed out.
    Failed,
    /// This reader does not understand the recorded observation.
    Unknown,
}

/// Evidence on one side; dates name actual observations rather than file-save time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonObservation {
    /// Evidence classification.
    pub status: ComparisonObservationStatus,
    /// Last actual read, including the older date of retained facts.
    pub read_at: Option<DateTime<Utc>>,
}

/// A structural value. Module bodies never occur here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonValue {
    /// Whether the value is observed, historical, absent or unavailable.
    pub observation: ComparisonObservation,
    /// JSON-encoded structural value, or no value when unavailable/absent.
    pub value: Option<String>,
}

/// A directional difference or an explicit inability to compare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum ComparisonResultKind {
    /// Observed in Reference and confirmed absent in Compared.
    OnlyReference,
    /// Confirmed absent in Reference and observed in Compared.
    OnlyCompared,
    /// Observed values differ.
    Different,
    /// Evidence is insufficient to decide equality or absence.
    NotComparable,
}

/// Difference of one named structural property.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonProperty {
    /// Structured path, for example `["columns", "Order.Id", "dataType"]`.
    pub path: Vec<String>,
    /// Difference or uncertainty; never a temporal migration instruction.
    pub result: ComparisonResultKind,
    /// Reference observation/value.
    pub reference: ComparisonValue,
    /// Compared observation/value.
    pub compared: ComparisonValue,
}

/// Source comparison metadata, intentionally without either module body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct DefinitionTextComparison {
    /// Exact captured text differs, including line endings and whitespace.
    pub differs: bool,
    /// Supplemental legacy refresh rule; this does not establish semantic equivalence.
    pub equal_under_legacy_normalization: bool,
}

/// One differing or not-fully-comparable object. Fully understood equal objects are omitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonItem {
    /// Stable structured identity.
    pub object: ComparisonObjectRef,
    /// Object-level result; properties can additionally explain partial evidence.
    pub result: ComparisonResultKind,
    /// Reference object evidence.
    pub reference: ComparisonObservation,
    /// Compared object evidence.
    pub compared: ComparisonObservation,
    /// Changed and unavailable structural properties, deterministically ordered.
    pub properties: Vec<ComparisonProperty>,
    /// Exact text outcome when both definitions were freshly observed and readable.
    pub definition_text: Option<DefinitionTextComparison>,
}

/// Capture context, with no server, user, connection or access-probe details.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonCapture {
    /// Engine that gives the captured types and rules their meaning.
    pub provider: DatabaseProvider,
    /// Actual capture completion time.
    pub extracted_at: DateTime<Utc>,
    /// Scope whose evidence was recorded; absent in old files.
    pub scope: Option<CaptureScope>,
    /// Coarse recorded visibility verdict, without raw permission evidence.
    pub access_level: Option<AccessLevel>,
    /// Unknown snapshot/programming extensions prevent a whole-project equality claim.
    pub has_unknown_extensions: bool,
}

/// Counts of object outcomes, not an inferred count of database modifications.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ComparisonSummary {
    /// Union of understood object identities considered.
    pub objects_compared: usize,
    /// Fully understood objects with equal compared facts.
    pub equal: usize,
    /// Objects observed only in Reference, with an absence proved in Compared.
    pub only_reference: usize,
    /// Objects observed only in Compared, with an absence proved in Reference.
    pub only_compared: usize,
    /// Objects with at least one confirmed differing fact.
    pub different: usize,
    /// Objects for which no confirmed difference can be established and facts remain unavailable.
    pub not_comparable: usize,
    /// Result objects that also contain unavailable/historical properties.
    pub with_limitations: usize,
}

/// Immutable independent comparison, not suitable for unfiltered export serialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct ProjectComparison {
    /// Reference capture evidence.
    pub reference: ComparisonCapture,
    /// Compared capture evidence.
    pub compared: ComparisonCapture,
    /// Differing or uncertain items, sorted by structured identity.
    pub items: Vec<ComparisonItem>,
    /// Outcome counts computed in the core.
    pub summary: ComparisonSummary,
}

/// Original terminator of a source line; a trailing newline does not create a phantom line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum SourceLineEnding {
    /// No terminator, at the end of the input.
    None,
    /// LF.
    Lf,
    /// CRLF.
    CrLf,
    /// CR.
    Cr,
}

/// A line operation; no semantic SQL interpretation is performed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum SourceLineKind {
    /// Exact text and terminator shared by both inputs.
    Unchanged,
    /// Original line occurs on the Reference side of this operation.
    Removed,
    /// Original line occurs on the Compared side of this operation.
    Added,
}

/// One original source line for an in-app-only, literal-text presentation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct SourceDiffLine {
    /// Added, removed or unchanged.
    pub kind: SourceLineKind,
    /// One-based original Reference line number when applicable.
    pub reference_line: Option<usize>,
    /// One-based original Compared line number when applicable.
    pub compared_line: Option<usize>,
    /// Literal line text, without its terminator.
    pub text: String,
    /// Original terminator, including differences invisible in rendered SQL.
    pub ending: SourceLineEnding,
}

/// Whether a requested source page completed within the explicit work budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub enum SourceDiffStatus {
    /// The source was processed; this may be a page of the complete result.
    Complete,
    /// Cancellation was requested; returned rows are not a complete diff.
    Cancelled,
    /// Explicit size/work bounds were reached; originals remain available separately.
    Limited,
}

/// A bounded page of literal source operations. Never embed this in an export/report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "comparison/")]
pub struct SourceLineDiff {
    /// Completion classification.
    pub status: SourceDiffStatus,
    /// Exact original strings are equal.
    pub exact_equal: bool,
    /// Supplemental refresh comparison, not a semantic equivalence statement.
    pub equal_under_legacy_normalization: bool,
    /// Requested slice of line operations, bounded independently of source size.
    pub lines: Vec<SourceDiffLine>,
    /// Total operation rows when processing completed, otherwise unknown.
    pub total_rows: Option<usize>,
    /// Offset for a subsequent page, when more rows remain.
    pub next_offset: Option<usize>,
}
