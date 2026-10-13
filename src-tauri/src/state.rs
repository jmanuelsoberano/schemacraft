//! Application state shared by commands and managed by Tauri.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tokio_util::sync::CancellationToken;

/// Identifier of a running operation, handed to the frontend so it can cancel it.
pub type JobId = String;

/// Registry of cancellable operations.
#[derive(Default)]
pub struct InspectionJobs {
    next_number: AtomicU64,
    cancellations: Mutex<HashMap<JobId, CancellationToken>>,
}

impl InspectionJobs {
    /// Registers a new job. The returned token must be honoured by the operation.
    pub fn start(&self) -> (JobId, CancellationToken) {
        let number = self.next_number.fetch_add(1, Ordering::Relaxed) + 1;
        let job_id = format!("inspection-{number}");
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

/// Everything commands share across invocations.
#[derive(Default)]
pub struct AppState {
    /// Running inspections.
    pub inspection_jobs: InspectionJobs,
}

#[cfg(test)]
mod tests {
    use super::InspectionJobs;

    #[test]
    fn jobs_get_unique_ids_and_cancel_their_tokens() {
        let jobs = InspectionJobs::default();
        let (first_id, first_token) = jobs.start();
        let (second_id, second_token) = jobs.start();
        assert_ne!(first_id, second_id);

        assert!(jobs.cancel(&first_id));
        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
    }

    #[test]
    fn finished_or_unknown_jobs_cannot_be_cancelled() {
        let jobs = InspectionJobs::default();
        let (job_id, _token) = jobs.start();
        jobs.finish(&job_id);
        assert!(!jobs.cancel(&job_id));
        assert!(!jobs.cancel("inspection-999"));
    }
}
