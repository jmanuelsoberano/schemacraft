//! Hand-built project content shared by the unit tests of this crate.

use super::{
    CanvasState, NodeState, Point, ProjectContent, SavedConnection, SavedSqlServerAuthentication,
    SavedSqlServerConnection,
};
use crate::inspectors::InspectionOptions;
use crate::inspectors::sqlserver::EncryptionMode;
use crate::model::test_fixtures::sample_snapshot;
use crate::model::{QualifiedName, UnknownFields};

/// A project as SchemaCraft 1.0 wrote it, edited by hand to hold what the upgrade to format 2
/// must handle: an empty `CHECK` text in `sales`, readable and missing defaults in both
/// schemas, and keys 1.0 did not know at the root and in the canvas.
pub(crate) const FORMAT_1_PROJECT: &str = include_str!("fixtures/format-1.scraft");

/// The sample snapshot with a SQL login connection and two placed nodes, deliberately out of
/// canonical order.
pub(crate) fn sample_project_content() -> ProjectContent {
    ProjectContent {
        connection: SavedConnection::SqlServer(SavedSqlServerConnection {
            host: "db.example.com".to_string(),
            instance: None,
            port: Some(1433),
            database: Some("Northwind".to_string()),
            authentication: SavedSqlServerAuthentication::SqlLogin {
                username: "reporting".to_string(),
            },
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: true,
        }),
        inspection: InspectionOptions::default(),
        snapshot: sample_snapshot(),
        canvas: CanvasState {
            nodes: vec![
                NodeState {
                    name: QualifiedName::new("sales", "Orders"),
                    position: Point { x: 420.0, y: 80.0 },
                    is_collapsed: false,
                    is_hidden: false,
                    unknown: UnknownFields::new(),
                },
                NodeState {
                    name: QualifiedName::new("dbo", "Customers"),
                    position: Point { x: 40.0, y: 80.0 },
                    is_collapsed: true,
                    is_hidden: false,
                    unknown: UnknownFields::new(),
                },
            ],
            ..CanvasState::default()
        },
        unknown: UnknownFields::new(),
    }
}
