use std::time::Duration;

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use tiberius::{AuthMethod, Config, EncryptionLevel};
use ts_rs::TS;

use crate::inspectors::InspectorError;

/// Default TCP port of a SQL Server default instance.
pub const DEFAULT_PORT: u16 = 1433;
/// Name reported to the server, visible in `sys.dm_exec_sessions.program_name`.
pub const APPLICATION_NAME: &str = "SchemaCraft";
const DEFAULT_CONNECT_TIMEOUT_SECONDS: u32 = 15;
/// Catalog queries on very large databases can legitimately take a while.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

/// How to reach and authenticate against a SQL Server instance.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub struct SqlServerConnectionSettings {
    /// Host name or IP address, e.g. `localhost` or `192.168.1.50`.
    pub host: String,
    /// Named instance resolved through the SQL Browser service, e.g. `SQLEXPRESS`.
    /// Takes precedence over `port`.
    #[serde(default)]
    pub instance: Option<String>,
    /// TCP port, defaults to 1433 when no instance is given.
    #[serde(default)]
    pub port: Option<u16>,
    /// Database to open; `None` lands in the login's default database.
    #[serde(default)]
    pub database: Option<String>,
    /// Credentials.
    pub authentication: SqlServerAuthentication,
    /// Transport encryption policy.
    #[serde(default)]
    pub encryption: EncryptionMode,
    /// Accept the server certificate without validating its chain or host name.
    #[serde(default)]
    pub trust_server_certificate: bool,
    /// Seconds allowed for the TCP connection and, separately, for the login handshake.
    #[serde(default = "default_connect_timeout_seconds")]
    pub connect_timeout_seconds: u32,
}

fn default_connect_timeout_seconds() -> u32 {
    DEFAULT_CONNECT_TIMEOUT_SECONDS
}

/// Credentials for SQL Server.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub enum SqlServerAuthentication {
    /// Windows Authentication with the credentials of the current user. Windows only.
    Integrated,
    /// SQL Server Authentication with a login name and password.
    SqlLogin {
        /// Login name, e.g. `sa`.
        username: String,
        /// Password, kept out of logs and never serialised.
        #[ts(type = "string")]
        password: SecretString,
    },
}

/// Transport encryption policy, from most permissive to strictest.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub enum EncryptionMode {
    /// Encrypt when the server supports it, otherwise continue in clear text.
    Optional,
    /// Encrypt everything and fail when the server cannot. The default.
    #[default]
    Mandatory,
    /// TDS 8.0 strict mode: TLS is established before the protocol handshake.
    Strict,
}

impl EncryptionMode {
    fn to_tiberius(self) -> EncryptionLevel {
        match self {
            Self::Optional => EncryptionLevel::On,
            Self::Mandatory => EncryptionLevel::Required,
            Self::Strict => EncryptionLevel::Strict,
        }
    }
}

impl SqlServerConnectionSettings {
    /// Validates the settings and translates them into a driver configuration.
    pub fn to_tiberius_config(&self) -> Result<Config, InspectorError> {
        let host = self.host.trim();
        if host.is_empty() {
            return Err(InspectorError::InvalidSettings {
                reason: "the server host is empty".to_string(),
            });
        }

        let mut config = Config::new();
        config.host(host);
        match self.instance_name() {
            Some(instance) => config.instance_name(instance),
            None => config.port(self.port.unwrap_or(DEFAULT_PORT)),
        }
        if let Some(database) = non_empty(self.database.as_deref()) {
            config.database(database);
        }
        config.application_name(APPLICATION_NAME);
        config.authentication(self.auth_method()?);
        config.encryption(self.encryption.to_tiberius());
        if self.trust_server_certificate {
            config.trust_cert();
        }
        config.handshake_timeout(Some(self.connect_timeout()));
        config.command_timeout(Some(COMMAND_TIMEOUT));

        Ok(config)
    }

    /// Time allowed for the TCP connection, and separately for the login handshake.
    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(u64::from(self.connect_timeout_seconds.max(1)))
    }

    /// Server as users write it, e.g. `localhost\SQLEXPRESS` or `db.example.com,1433`.
    pub fn display_target(&self) -> String {
        let host = self.host.trim();
        match self.instance_name() {
            Some(instance) => format!("{host}\\{instance}"),
            None => format!("{host},{}", self.port.unwrap_or(DEFAULT_PORT)),
        }
    }

    fn instance_name(&self) -> Option<&str> {
        non_empty(self.instance.as_deref())
    }

    fn auth_method(&self) -> Result<AuthMethod, InspectorError> {
        match &self.authentication {
            SqlServerAuthentication::Integrated => {
                #[cfg(windows)]
                {
                    Ok(AuthMethod::Integrated)
                }
                #[cfg(not(windows))]
                {
                    Err(InspectorError::UnsupportedOnPlatform {
                        feature: "Windows Authentication",
                    })
                }
            }
            SqlServerAuthentication::SqlLogin { username, password } => {
                let username = username.trim();
                if username.is_empty() {
                    return Err(InspectorError::InvalidSettings {
                        reason: "the login name is empty".to_string(),
                    });
                }
                Ok(AuthMethod::sql_server(username, password.expose_secret()))
            }
        }
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|trimmed| !trimmed.is_empty())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use secrecy::SecretString;

    use super::{EncryptionMode, SqlServerAuthentication, SqlServerConnectionSettings};
    use crate::inspectors::InspectorError;

    fn sql_login_settings() -> SqlServerConnectionSettings {
        SqlServerConnectionSettings {
            host: "db.example.com".to_string(),
            instance: None,
            port: Some(14333),
            database: Some("Northwind".to_string()),
            authentication: SqlServerAuthentication::SqlLogin {
                username: "app".to_string(),
                password: SecretString::from("s3cret".to_string()),
            },
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: false,
            connect_timeout_seconds: 5,
        }
    }

    #[test]
    fn maps_host_and_explicit_port() {
        let config = sql_login_settings().to_tiberius_config();
        let Ok(config) = config else {
            panic!("settings should be valid");
        };
        assert_eq!(config.get_addr(), "db.example.com:14333");
        assert_eq!(
            sql_login_settings().display_target(),
            "db.example.com,14333"
        );
    }

    #[test]
    fn defaults_to_port_1433_without_instance() {
        let settings = SqlServerConnectionSettings {
            port: None,
            ..sql_login_settings()
        };
        assert_eq!(settings.display_target(), "db.example.com,1433");
        let Ok(config) = settings.to_tiberius_config() else {
            panic!("settings should be valid");
        };
        assert_eq!(config.get_addr(), "db.example.com:1433");
    }

    #[test]
    fn named_instance_wins_over_port_in_display_target() {
        let settings = SqlServerConnectionSettings {
            host: " localhost ".to_string(),
            instance: Some("SQLEXPRESS".to_string()),
            ..sql_login_settings()
        };
        assert_eq!(settings.display_target(), "localhost\\SQLEXPRESS");
    }

    #[test]
    fn rejects_empty_host() {
        let settings = SqlServerConnectionSettings {
            host: "   ".to_string(),
            ..sql_login_settings()
        };
        assert!(matches!(
            settings.to_tiberius_config(),
            Err(InspectorError::InvalidSettings { .. })
        ));
    }

    #[test]
    fn rejects_empty_login_name() {
        let settings = SqlServerConnectionSettings {
            authentication: SqlServerAuthentication::SqlLogin {
                username: String::new(),
                password: SecretString::from("x".to_string()),
            },
            ..sql_login_settings()
        };
        assert!(matches!(
            settings.to_tiberius_config(),
            Err(InspectorError::InvalidSettings { .. })
        ));
    }

    #[test]
    fn connect_timeout_is_at_least_one_second() {
        let settings = SqlServerConnectionSettings {
            connect_timeout_seconds: 0,
            ..sql_login_settings()
        };
        assert_eq!(settings.connect_timeout().as_secs(), 1);
    }

    #[test]
    fn password_is_redacted_in_debug_output() {
        let rendered = format!("{:?}", sql_login_settings());
        assert!(!rendered.contains("s3cret"));
    }

    #[test]
    fn deserialises_with_defaults() {
        let json = r#"{
            "host": "localhost",
            "authentication": { "mode": "integrated" }
        }"#;
        let settings: Result<SqlServerConnectionSettings, _> = serde_json::from_str(json);
        let Ok(settings) = settings else {
            panic!("settings should deserialise");
        };
        assert_eq!(settings.encryption, EncryptionMode::Mandatory);
        assert!(!settings.trust_server_certificate);
        assert_eq!(settings.connect_timeout_seconds, 15);
        assert!(matches!(
            settings.authentication,
            SqlServerAuthentication::Integrated
        ));
    }
}
