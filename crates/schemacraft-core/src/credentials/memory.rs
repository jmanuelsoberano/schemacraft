use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use secrecy::SecretString;

use super::{CredentialError, CredentialKey, CredentialStore};

/// Keeps secrets in memory for the lifetime of the process: for tests and for platforms
/// without a system store. Nothing is written to disk.
#[derive(Default)]
pub struct InMemoryCredentialStore {
    entries: Mutex<HashMap<CredentialKey, SecretString>>,
}

impl InMemoryCredentialStore {
    fn entries(&self) -> MutexGuard<'_, HashMap<CredentialKey, SecretString>> {
        // A panic while holding the lock cannot corrupt a plain map; keep serving.
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl CredentialStore for InMemoryCredentialStore {
    fn store(&self, key: &CredentialKey, secret: &SecretString) -> Result<(), CredentialError> {
        self.entries().insert(key.clone(), secret.clone());
        Ok(())
    }

    fn retrieve(&self, key: &CredentialKey) -> Result<Option<SecretString>, CredentialError> {
        Ok(self.entries().get(key).cloned())
    }

    fn remove(&self, key: &CredentialKey) -> Result<bool, CredentialError> {
        Ok(self.entries().remove(key).is_some())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use secrecy::{ExposeSecret, SecretString};

    use super::InMemoryCredentialStore;
    use crate::credentials::{CredentialKey, CredentialStore};

    #[test]
    fn stores_replaces_and_removes_secrets() {
        let store = InMemoryCredentialStore::default();
        let key = CredentialKey::sql_server_login("localhost,1433", "app");
        assert!(store.retrieve(&key).unwrap().is_none());
        assert!(!store.contains(&key).unwrap());

        store
            .store(&key, &SecretString::from("first".to_string()))
            .unwrap();
        store
            .store(&key, &SecretString::from("second".to_string()))
            .unwrap();
        assert!(store.contains(&key).unwrap());
        let secret = store.retrieve(&key).unwrap().expect("stored secret");
        assert_eq!(secret.expose_secret(), "second");

        assert!(store.remove(&key).unwrap());
        assert!(!store.remove(&key).unwrap());
        assert!(store.retrieve(&key).unwrap().is_none());
    }
}
