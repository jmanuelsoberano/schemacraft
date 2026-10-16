use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Phase of an inspection. The access check and the catalog stages run concurrently, so they
/// may complete in any order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub enum InspectionStage {
    /// Opening connections and identifying the server.
    Connecting,
    /// Reading what the login is allowed to see, so the snapshot can say what it may lack.
    CheckingAccess,
    /// Reading tables and views.
    ReadingObjects,
    /// Reading columns, types and defaults.
    ReadingColumns,
    /// Reading primary keys, unique constraints and indexes.
    ReadingIndexes,
    /// Reading foreign keys.
    ReadingForeignKeys,
    /// Reading check constraints.
    ReadingConstraints,
    /// Building the snapshot from the catalog rows.
    Assembling,
    /// The snapshot is ready.
    Completed,
}

/// A progress update. `count` is the number of objects read in the stage, when known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub struct InspectionProgress {
    /// Stage the update refers to.
    pub stage: InspectionStage,
    /// Objects read in this stage, or `None` when the stage has no meaningful count.
    pub count: Option<u32>,
}

impl InspectionProgress {
    /// An update without a count, e.g. the start of a stage.
    pub fn stage(stage: InspectionStage) -> Self {
        Self { stage, count: None }
    }

    /// An update carrying how many objects the stage produced.
    pub fn counted(stage: InspectionStage, count: usize) -> Self {
        Self {
            stage,
            count: Some(u32::try_from(count).unwrap_or(u32::MAX)),
        }
    }
}

/// Receives progress updates from an inspection. Implementations must return quickly.
pub trait ProgressReporter: Send + Sync {
    /// Called when connecting and assembling start, when the access check finishes, when a
    /// catalog query that carries a count finishes, and once at completion.
    fn report(&self, progress: InspectionProgress);
}

/// Reporter that discards updates, for callers that do not display progress.
#[derive(Debug, Default, Clone, Copy)]
pub struct SilentProgress;

impl ProgressReporter for SilentProgress {
    fn report(&self, _progress: InspectionProgress) {}
}
