use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::inspectors::sqlserver::{EncryptionMode, format_target};

/// A connection as recorded in a project file or in the history: everything but the password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "provider", rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub enum SavedConnection {
    /// Microsoft SQL Server.
    SqlServer(SavedSqlServerConnection),
}

impl SavedConnection {
    /// Server as users write it, e.g. `localhost\SQLEXPRESS` or `db.example.com,1433`.
    pub fn display_target(&self) -> String {
        match self {
            Self::SqlServer(connection) => connection.display_target(),
        }
    }

    /// Database the connection opens, when one was chosen.
    pub fn database(&self) -> Option<&str> {
        match self {
            Self::SqlServer(connection) => connection.database.as_deref(),
        }
    }

    /// Whether both connections open the same database with the same login, ignoring transport
    /// options such as encryption. This is the identity used by the connection history.
    pub fn same_endpoint_as(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::SqlServer(left), Self::SqlServer(right)) => left.same_endpoint_as(right),
        }
    }
}

/// SQL Server connection without its password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct SavedSqlServerConnection {
    /// Host name or IP address.
    pub host: String,
    /// Named instance, when the server is not reached by port.
    #[serde(default)]
    pub instance: Option<String>,
    /// TCP port, when the server is not a named instance.
    #[serde(default)]
    pub port: Option<u16>,
    /// Database that was opened.
    #[serde(default)]
    pub database: Option<String>,
    /// Authentication mode and login name.
    pub authentication: SavedSqlServerAuthentication,
    /// Transport encryption policy.
    #[serde(default)]
    pub encryption: EncryptionMode,
    /// Whether the server certificate was accepted without validation.
    #[serde(default)]
    pub trust_server_certificate: bool,
}

/// Authentication of a saved SQL Server connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub enum SavedSqlServerAuthentication {
    /// Windows Authentication with the current user.
    Integrated,
    /// SQL Server Authentication; only the login name is recorded.
    SqlLogin {
        /// Login name.
        username: String,
    },
}

impl SavedSqlServerConnection {
    /// Server as users write it.
    pub fn display_target(&self) -> String {
        format_target(&self.host, self.instance.as_deref(), self.port)
    }

    /// See [`SavedConnection::same_endpoint_as`].
    pub fn same_endpoint_as(&self, other: &Self) -> bool {
        self.display_target().to_lowercase() == other.display_target().to_lowercase()
            && folded(self.database.as_deref()) == folded(other.database.as_deref())
            && match (&self.authentication, &other.authentication) {
                (
                    SavedSqlServerAuthentication::Integrated,
                    SavedSqlServerAuthentication::Integrated,
                ) => true,
                (
                    SavedSqlServerAuthentication::SqlLogin { username: left },
                    SavedSqlServerAuthentication::SqlLogin { username: right },
                ) => folded(Some(left)) == folded(Some(right)),
                _ => false,
            }
    }
}

/// Trimmed, lower-cased value for case-insensitive comparisons; empty counts as absent.
fn folded(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|trimmed| !trimmed.is_empty())
        .map(str::to_lowercase)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use super::{SavedConnection, SavedSqlServerAuthentication, SavedSqlServerConnection};
    use crate::inspectors::sqlserver::EncryptionMode;

    fn sql_login(host: &str, database: &str, username: &str) -> SavedConnection {
        SavedConnection::SqlServer(SavedSqlServerConnection {
            host: host.to_string(),
            instance: None,
            port: Some(14333),
            database: Some(database.to_string()),
            authentication: SavedSqlServerAuthentication::SqlLogin {
                username: username.to_string(),
            },
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: true,
        })
    }

    #[test]
    fn identity_ignores_case_and_transport_options() {
        let connection = sql_login("localhost", "Northwind", "app");
        let SavedConnection::SqlServer(mut other) = sql_login("LOCALHOST", "northwind", "APP");
        other.encryption = EncryptionMode::Optional;
        other.trust_server_certificate = false;

        assert!(connection.same_endpoint_as(&SavedConnection::SqlServer(other)));
        assert!(!connection.same_endpoint_as(&sql_login("localhost", "Northwind", "sa")));
        assert!(!connection.same_endpoint_as(&sql_login("localhost", "Other", "app")));
        assert!(!connection.same_endpoint_as(&sql_login("otherhost", "Northwind", "app")));
    }

    #[test]
    fn integrated_connections_compare_by_server_and_database() {
        let integrated = SavedConnection::SqlServer(SavedSqlServerConnection {
            host: "localhost".to_string(),
            instance: Some("SQLEXPRESS".to_string()),
            port: None,
            database: None,
            authentication: SavedSqlServerAuthentication::Integrated,
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: false,
        });
        assert_eq!(integrated.display_target(), "localhost\\SQLEXPRESS");
        assert!(integrated.database().is_none());
        assert!(integrated.same_endpoint_as(&integrated.clone()));
        assert!(!integrated.same_endpoint_as(&sql_login("localhost", "x", "app")));
    }

    #[test]
    fn serialises_with_tags_and_only_the_login_name() {
        let json = serde_json::to_value(sql_login("localhost", "Northwind", "app")).unwrap();
        assert_eq!(json["provider"], "sqlServer");
        assert_eq!(json["authentication"]["mode"], "sqlLogin");
        assert_eq!(json["authentication"]["username"], "app");
        assert_eq!(json["authentication"].as_object().unwrap().len(), 2);
        assert_eq!(json["trustServerCertificate"], true);
    }
}
