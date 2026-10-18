//! Translation of driver failures into [`InspectorError`].

use std::io::ErrorKind;

use tiberius::error::Error as DriverError;

use crate::inspectors::InspectorError;

/// SQL Server error numbers that mean the login itself was rejected.
const LOGIN_FAILED_CODES: &[u32] = &[18456, 18452, 18470, 18486, 18487, 18488, 18401, 17892];
/// SQL Server error numbers that mean the requested database cannot be opened.
const DATABASE_UNAVAILABLE_CODES: &[u32] = &[4060, 4064, 911];

/// Context of a connection attempt, used to word the resulting error.
pub(super) struct ConnectionContext<'a> {
    /// Server as the user typed it.
    pub target: &'a str,
    /// Database that was requested, if any.
    pub database: Option<&'a str>,
    /// Time allowed for the attempt.
    pub timeout_seconds: u64,
}

/// Classifies a failure raised while opening a connection or logging in.
pub(super) fn classify_connect_error(
    error: &DriverError,
    context: &ConnectionContext<'_>,
) -> InspectorError {
    match error {
        DriverError::Server(token) if LOGIN_FAILED_CODES.contains(&token.code()) => {
            InspectorError::AuthenticationFailed {
                details: token.message().to_string(),
                error_number: Some(token.code()),
            }
        }
        DriverError::Server(token) if DATABASE_UNAVAILABLE_CODES.contains(&token.code()) => {
            InspectorError::DatabaseUnavailable {
                database: context.database.unwrap_or_default().to_string(),
                details: token.message().to_string(),
                error_number: Some(token.code()),
            }
        }
        DriverError::Tls(message) => InspectorError::UntrustedCertificate {
            details: message.clone(),
        },
        DriverError::Io { kind, message } => {
            if *kind == ErrorKind::TimedOut {
                InspectorError::Timeout {
                    target: context.target.to_string(),
                    seconds: context.timeout_seconds,
                }
            } else {
                InspectorError::Unreachable {
                    target: context.target.to_string(),
                    details: message.clone(),
                }
            }
        }
        other => InspectorError::ConnectionRefused {
            target: context.target.to_string(),
            details: other.to_string(),
            error_number: server_error_number(other),
        },
    }
}

/// Wraps a failure raised while running a catalog query.
pub(super) fn query_error(query: &'static str, error: &DriverError) -> InspectorError {
    InspectorError::QueryFailed {
        query,
        details: error.to_string(),
        error_number: server_error_number(error),
    }
}

/// The SQL Server error number of a failure the server raised, such as 229 for a denied
/// `SELECT`; `None` for a failure of the network, TLS or the driver.
fn server_error_number(error: &DriverError) -> Option<u32> {
    match error {
        DriverError::Server(token) => Some(token.code()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::io::ErrorKind;

    use tiberius::error::Error as DriverError;

    use super::{ConnectionContext, classify_connect_error, query_error};
    use crate::inspectors::InspectorError;

    fn context() -> ConnectionContext<'static> {
        ConnectionContext {
            target: "localhost,1433",
            database: Some("Northwind"),
            timeout_seconds: 15,
        }
    }

    #[test]
    fn tls_failures_become_untrusted_certificate() {
        let error = DriverError::Tls("certificate chain not trusted".to_string());
        assert!(matches!(
            classify_connect_error(&error, &context()),
            InspectorError::UntrustedCertificate { .. }
        ));
    }

    #[test]
    fn io_timeouts_become_timeouts_and_other_io_errors_unreachable() {
        let timed_out = DriverError::Io {
            kind: ErrorKind::TimedOut,
            message: "timed out".to_string(),
        };
        let refused = DriverError::Io {
            kind: ErrorKind::ConnectionRefused,
            message: "connection refused".to_string(),
        };
        assert!(matches!(
            classify_connect_error(&timed_out, &context()),
            InspectorError::Timeout { seconds: 15, .. }
        ));
        assert!(matches!(
            classify_connect_error(&refused, &context()),
            InspectorError::Unreachable { .. }
        ));
    }

    #[test]
    fn protocol_failures_become_connection_refused() {
        let error = DriverError::Protocol("unexpected token".into());
        assert!(matches!(
            classify_connect_error(&error, &context()),
            InspectorError::ConnectionRefused {
                error_number: None,
                ..
            }
        ));
    }

    #[test]
    fn failures_without_a_server_error_carry_no_number() {
        let error = DriverError::Io {
            kind: ErrorKind::ConnectionReset,
            message: "connection reset".to_string(),
        };
        assert!(matches!(
            query_error("columns", &error),
            InspectorError::QueryFailed {
                query: "columns",
                error_number: None,
                ..
            }
        ));
    }
}
