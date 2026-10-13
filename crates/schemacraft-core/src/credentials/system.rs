use secrecy::SecretString;

use super::{CredentialError, CredentialKey, CredentialStore};

/// The operating system credential store: the Windows Credential Manager on Windows. Other
/// platforms report the store as unavailable, so the application degrades to typing the
/// password each time.
#[derive(Debug, Default)]
pub struct SystemCredentialStore;

#[cfg(windows)]
mod windows {
    use secrecy::{ExposeSecret, SecretString};

    use crate::credentials::{CredentialError, CredentialKey, SERVICE_NAME};

    fn entry(key: &CredentialKey) -> Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(SERVICE_NAME, key.account()).map_err(|error| failure(&error))
    }

    fn failure(error: &keyring::Error) -> CredentialError {
        CredentialError::StoreFailed {
            details: error.to_string(),
        }
    }

    pub(super) fn store(key: &CredentialKey, secret: &SecretString) -> Result<(), CredentialError> {
        entry(key)?
            .set_password(secret.expose_secret())
            .map_err(|error| failure(&error))
    }

    pub(super) fn retrieve(key: &CredentialKey) -> Result<Option<SecretString>, CredentialError> {
        match entry(key)?.get_password() {
            Ok(password) => Ok(Some(SecretString::from(password))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(failure(&error)),
        }
    }

    pub(super) fn remove(key: &CredentialKey) -> Result<bool, CredentialError> {
        match entry(key)?.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(failure(&error)),
        }
    }
}

impl CredentialStore for SystemCredentialStore {
    fn store(&self, key: &CredentialKey, secret: &SecretString) -> Result<(), CredentialError> {
        #[cfg(windows)]
        {
            windows::store(key, secret)
        }
        #[cfg(not(windows))]
        {
            let _ = (key, secret);
            Err(CredentialError::Unavailable)
        }
    }

    fn retrieve(&self, key: &CredentialKey) -> Result<Option<SecretString>, CredentialError> {
        #[cfg(windows)]
        {
            windows::retrieve(key)
        }
        #[cfg(not(windows))]
        {
            let _ = key;
            Err(CredentialError::Unavailable)
        }
    }

    fn remove(&self, key: &CredentialKey) -> Result<bool, CredentialError> {
        #[cfg(windows)]
        {
            windows::remove(key)
        }
        #[cfg(not(windows))]
        {
            let _ = key;
            Err(CredentialError::Unavailable)
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use secrecy::{ExposeSecret, SecretString};

    use super::SystemCredentialStore;
    use crate::credentials::{CredentialKey, CredentialStore};

    /// Round trip through the real Windows Credential Manager under a test-only key, which is
    /// removed again at the end.
    #[test]
    fn round_trips_through_the_windows_credential_manager() {
        let store = SystemCredentialStore;
        let key = CredentialKey::sql_server_login(
            &format!("schemacraft-test-{},1433", std::process::id()),
            "tester",
        );
        let _ = store.remove(&key);
        assert!(!store.contains(&key).expect("store reachable"));

        store
            .store(&key, &SecretString::from("test-secret".to_string()))
            .expect("store writes");
        let secret = store
            .retrieve(&key)
            .expect("store reads")
            .expect("entry exists");
        assert_eq!(secret.expose_secret(), "test-secret");

        assert!(store.remove(&key).expect("store removes"));
        assert!(!store.remove(&key).expect("store reports absence"));
        assert!(store.retrieve(&key).expect("store reads").is_none());
    }
}
