//! Application state shared by commands and managed by Tauri.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use schemacraft_core::credentials::{CredentialStore, SystemCredentialStore};
use schemacraft_core::preferences::{Preferences, PreferencesError};
use tokio_util::sync::CancellationToken;

/// Identifier of a running operation, handed to the frontend so it can cancel it.
pub type JobId = String;

/// Registry of cancellable operations of one kind; ids read `<prefix>-<number>`.
pub struct Jobs {
    prefix: &'static str,
    next_number: AtomicU64,
    cancellations: Mutex<HashMap<JobId, CancellationToken>>,
}

impl Jobs {
    /// Creates an empty registry whose job ids start with `prefix`.
    pub fn new(prefix: &'static str) -> Self {
        Self {
            prefix,
            next_number: AtomicU64::new(0),
            cancellations: Mutex::new(HashMap::new()),
        }
    }

    /// Registers a new job. The returned token must be honoured by the operation.
    pub fn start(&self) -> (JobId, CancellationToken) {
        let number = self.next_number.fetch_add(1, Ordering::Relaxed) + 1;
        let job_id = format!("{}-{number}", self.prefix);
        let token = CancellationToken::new();
        self.cancellations().insert(job_id.clone(), token.clone());
        (job_id, token)
    }

    /// Requests cancellation. Returns `false` when no such job is running.
    pub fn cancel(&self, job_id: &str) -> bool {
        self.cancellations()
            .get(job_id)
            .map(CancellationToken::cancel)
            .is_some()
    }

    /// Forgets a job once it finished, succeeded or not.
    pub fn finish(&self, job_id: &str) {
        self.cancellations().remove(job_id);
    }

    fn cancellations(&self) -> MutexGuard<'_, HashMap<JobId, CancellationToken>> {
        // A panic while holding the lock cannot corrupt a plain map; keep serving.
        self.cancellations
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Preferences held in memory and mirrored to disk on every change.
pub struct PreferencesStore {
    path: PathBuf,
    current: Mutex<Preferences>,
    /// Set when the file was written by a newer version: it is never overwritten, and every
    /// change fails with this error instead.
    newer_file: Option<PreferencesError>,
}

impl PreferencesStore {
    /// Loads the file at `path`. A missing or damaged file starts from defaults, since losing
    /// the history is better than refusing to start; a newer file is kept and left untouched.
    pub fn load(path: PathBuf) -> Self {
        let (current, newer_file) = match Preferences::load(&path) {
            Ok(preferences) => (preferences, None),
            Err(error @ PreferencesError::UnsupportedFormatVersion { .. }) => {
                tracing::warn!(%error, "preferences come from a newer version; leaving them untouched");
                (Preferences::default(), Some(error))
            }
            Err(error) => {
                tracing::warn!(%error, "preferences could not be loaded; starting from defaults");
                (Preferences::default(), None)
            }
        };
        tracing::debug!(
            path = %path.display(),
            recent_connections = current.recent_connections.len(),
            recent_projects = current.recent_projects.len(),
            "preferences loaded"
        );
        Self {
            path,
            current: Mutex::new(current),
            newer_file,
        }
    }

    /// A copy of the current preferences.
    pub fn current(&self) -> Preferences {
        self.guard().clone()
    }

    /// Applies `change` to a copy and writes it to disk; the copy replaces the preferences in
    /// memory only once the file holds it, so a failed write changes nothing.
    pub fn update(
        &self,
        change: impl FnOnce(&mut Preferences),
    ) -> Result<Preferences, PreferencesError> {
        if let Some(error) = &self.newer_file {
            return Err(error.clone());
        }
        let mut guard = self.guard();
        let mut next = guard.clone();
        change(&mut next);
        next.save(&self.path)?;
        *guard = next.clone();
        Ok(next)
    }

    fn guard(&self) -> MutexGuard<'_, Preferences> {
        // Preferences are plain data; a panic elsewhere cannot leave them half-updated.
        self.current.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Everything commands share across invocations.
pub struct AppState {
    /// Running inspections.
    pub inspection_jobs: Jobs,
    /// Running exports.
    pub export_jobs: Jobs,
    /// Running literal source comparisons.
    pub comparison_jobs: Jobs,
    /// Connection history and recent projects.
    pub preferences: PreferencesStore,
    /// Remembered passwords, kept by the operating system.
    pub credentials: Box<dyn CredentialStore>,
    /// Folder of the diagnostic log, or `None` when this session writes none (ADR-041).
    pub log_directory: Option<PathBuf>,
}

impl AppState {
    /// Creates the state, loading the preferences stored at `preferences_path`. `log_directory`
    /// is where logging writes, as it was opened before the application started.
    pub fn new(preferences_path: PathBuf, log_directory: Option<PathBuf>) -> Self {
        Self {
            inspection_jobs: Jobs::new("inspection"),
            export_jobs: Jobs::new("export"),
            comparison_jobs: Jobs::new("comparison"),
            preferences: PreferencesStore::load(preferences_path),
            credentials: Box::new(SystemCredentialStore),
            log_directory,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use std::fs;

    use chrono::Utc;
    use schemacraft_core::preferences::PreferencesError;

    use super::{Jobs, PreferencesStore};

    #[test]
    fn jobs_get_unique_ids_and_cancel_their_tokens() {
        let jobs = Jobs::new("inspection");
        let (first_id, first_token) = jobs.start();
        let (second_id, second_token) = jobs.start();
        assert_ne!(first_id, second_id);
        assert_eq!(first_id, "inspection-1");

        assert!(jobs.cancel(&first_id));
        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
    }

    #[test]
    fn finished_or_unknown_jobs_cannot_be_cancelled() {
        let jobs = Jobs::new("export");
        let (job_id, _token) = jobs.start();
        assert_eq!(job_id, "export-1");
        jobs.finish(&job_id);
        assert!(!jobs.cancel(&job_id));
        assert!(!jobs.cancel("export-999"));
    }

    #[test]
    fn preference_updates_are_written_to_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config").join("preferences.json");

        let store = PreferencesStore::load(path.clone());
        assert_eq!(store.current().recent_projects, []);
        let updated = store
            .update(|preferences| preferences.remember_project("C:\\work\\shop.scraft", Utc::now()))
            .unwrap();
        assert_eq!(updated.recent_projects[0].path, "C:\\work\\shop.scraft");

        let reloaded = PreferencesStore::load(path);
        assert_eq!(reloaded.current(), updated);
    }

    #[test]
    fn a_failed_write_leaves_the_preferences_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        // A folder where the file should be makes every save fail.
        let path = directory.path().join("preferences.json");
        fs::create_dir(&path).unwrap();

        let store = PreferencesStore::load(path);
        let result =
            store.update(|preferences| preferences.remember_project("C:\\shop.scraft", Utc::now()));

        assert!(matches!(result, Err(PreferencesError::Write { .. })));
        assert_eq!(store.current().recent_projects, []);
    }

    #[test]
    fn a_file_from_a_newer_version_is_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.json");
        let newer = r#"{ "formatVersion": 99, "recentProjects": [] }"#;
        fs::write(&path, newer).unwrap();

        let store = PreferencesStore::load(path.clone());
        let result =
            store.update(|preferences| preferences.remember_project("C:\\shop.scraft", Utc::now()));

        assert!(matches!(
            result,
            Err(PreferencesError::UnsupportedFormatVersion { found: 99, .. })
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), newer);
    }
}
