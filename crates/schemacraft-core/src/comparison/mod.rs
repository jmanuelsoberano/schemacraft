//! Independent, immutable comparison of captured facts from two project files.
//!
//! Unlike a database refresh, this operation never transfers observations between inputs.
//! Source text is intentionally absent from the result: the application requests a separate,
//! bounded line comparison when the user opens source details.

mod contracts;
mod facts;
mod lines;

pub use contracts::*;
pub use facts::compare_snapshots;
pub use lines::{SourceDiffOptions, compare_source_lines};

#[cfg(test)]
mod tests;
