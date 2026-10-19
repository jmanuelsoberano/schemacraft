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

/// A project written by the SchemaCraft 1.1.0 core, never by a later version, so the upgrade to
/// format 3 is tested against what 1.1.0 really writes.
///
/// It was produced on 2026-10-18 by a throwaway test, never committed, in a worktree of the tag
/// `v1.1.0`, against the local SQL Server 2022 container of `scripts/dev-sqlserver.ps1`:
///
/// 1. As `sa`, it recreated `SchemaCraftFixture` from 1.1.0's `fixture.sql`, disabled
///    `CK_OrderLines_Quantity` (`NOCHECK`) and mapped the login `schemacraft_two_tables` of
///    1.1.0's permission fixtures into it, with `SELECT` on `sales.Orders` and
///    `sales.OrderLines` only and a password made up for the run.
/// 2. It inspected the database as `sa` with the schemas `dbo` and `sales` and views on, and
///    placed seven nodes on a canvas, one collapsed and one hidden.
/// 3. It inspected again as `schemacraft_two_tables` with the same options and applied the
///    refresh with `ProjectContent::with_refreshed_snapshot`, as 1.1.0 does. That login reads no
///    text and vouches for no absence, so the refresh kept 14 facts as not checked (tables, the
///    view, texts and keys) and left `FK_Orders_Employees`, whose table `hr.Employees` is
///    outside the selection, as a key to an invisible table.
/// 4. It added one key a newer version could have written at each level 1.1.0 keeps:
///    `reviewNotes`, `snapshot.lineage`, `canvas.gridSize` and `colour` on the `sales.Orders`
///    node.
/// 5. It wrote the file with 1.1.0's `Project::new` and `write_project`, read it back with
///    1.1.0's `read_project`, and recreated the fixture database.
///
/// The header says `formatVersion` 2 and `minReaderVersion` 2, `savedWith` "SchemaCraft 1.1.0".
pub(crate) const FORMAT_2_PROJECT: &str = include_str!("fixtures/format-2.scraft");

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
