//! Process-wide diagnostics based on `tracing`.

use tracing_subscriber::EnvFilter;

/// Environment variable that overrides the log filter, e.g. `SCHEMACRAFT_LOG=debug`.
const LOG_FILTER_ENVIRONMENT_VARIABLE: &str = "SCHEMACRAFT_LOG";
/// Development builds trace the application's own crates; release builds stay quiet.
const DEFAULT_LOG_FILTER: &str = if cfg!(debug_assertions) {
    "info,schemacraft=debug"
} else {
    "info"
};

/// Installs the global subscriber. Calling it more than once is harmless.
pub fn initialize() {
    let filter = EnvFilter::try_from_env(LOG_FILTER_ENVIRONMENT_VARIABLE)
        .unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));

    // A subscriber may already be installed (for example by a test harness); that is not an error.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}
