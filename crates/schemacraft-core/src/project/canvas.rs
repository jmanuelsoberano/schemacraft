use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{QualifiedName, SchemaSnapshot};

/// How much of each table a node shows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub enum DetailLevel {
    /// Table name and column count only.
    Compact,
    /// Primary and foreign key columns.
    #[default]
    Keys,
    /// Every column with its type and attributes.
    Full,
}

/// Which layout produced the current positions.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub enum LayoutKind {
    /// Positions placed or adjusted by hand.
    #[default]
    Manual,
    /// Hierarchical (Sugiyama) layout.
    Layered,
    /// Force-directed layout.
    Organic,
    /// Concentric layout around a focus entity.
    Radial,
}

/// A position on the canvas, in canvas units.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct Point {
    /// Horizontal coordinate.
    pub x: f64,
    /// Vertical coordinate.
    pub y: f64,
}

/// What part of the canvas is visible.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct Viewport {
    /// Horizontal pan.
    pub x: f64,
    /// Vertical pan.
    pub y: f64,
    /// Zoom factor; `1` is 100 %.
    pub zoom: f64,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

/// Diagram state of one table or view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct NodeState {
    /// Entity the state belongs to.
    pub name: QualifiedName,
    /// Position of the node's top-left corner.
    pub position: Point,
    /// Whether the node shows only its header.
    #[serde(default)]
    pub is_collapsed: bool,
    /// Whether the entity is hidden from the diagram.
    #[serde(default)]
    pub is_hidden: bool,
}

/// The diagram as a value: the Memento the canvas produces when a project is saved and restores
/// when it is opened. Entities without an entry have not been placed yet.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct CanvasState {
    /// Detail level of the nodes.
    #[serde(default)]
    pub detail_level: DetailLevel,
    /// Layout that produced the positions.
    #[serde(default)]
    pub layout: LayoutKind,
    /// Visible region.
    #[serde(default)]
    pub viewport: Viewport,
    /// Per-entity state, sorted by qualified name.
    #[serde(default)]
    pub nodes: Vec<NodeState>,
}

impl CanvasState {
    /// State of the entity called `name`, if it was placed.
    pub fn node(&self, name: &QualifiedName) -> Option<&NodeState> {
        self.nodes.iter().find(|node| &node.name == name)
    }

    /// Keeps the state of the entities that exist in `snapshot` and drops the rest, so a
    /// refresh preserves the positions of surviving tables while new ones wait for a layout.
    #[must_use]
    pub fn retaining_entities_of(&self, snapshot: &SchemaSnapshot) -> Self {
        let exists = |name: &QualifiedName| {
            snapshot.tables.iter().any(|table| &table.name == name)
                || snapshot.views.iter().any(|view| &view.name == name)
        };
        Self {
            nodes: self
                .nodes
                .iter()
                .filter(|node| exists(&node.name))
                .cloned()
                .collect(),
            ..self.clone()
        }
    }

    /// Sorts the nodes by name and keeps the last entry of any duplicated name, so files are
    /// deterministic and lookups unambiguous.
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.nodes.reverse();
        let mut seen = BTreeSet::new();
        self.nodes.retain(|node| seen.insert(node.name.clone()));
        self.nodes.sort_by(|left, right| left.name.cmp(&right.name));
        self
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::float_cmp
    )]

    use super::{CanvasState, NodeState, Point, Viewport};
    use crate::model::QualifiedName;
    use crate::model::test_fixtures::sample_snapshot;

    fn node(schema: &str, name: &str, x: f64) -> NodeState {
        NodeState {
            name: QualifiedName::new(schema, name),
            position: Point { x, y: 0.0 },
            is_collapsed: false,
            is_hidden: false,
        }
    }

    #[test]
    fn defaults_describe_an_untouched_canvas() {
        let canvas = CanvasState::default();
        assert_eq!(canvas.viewport, Viewport::default());
        assert_eq!(canvas.viewport.zoom, 1.0);
        assert_eq!(canvas.nodes, []);
    }

    #[test]
    fn keeps_only_entities_that_still_exist() {
        let canvas = CanvasState {
            nodes: vec![
                node("dbo", "Customers", 10.0),
                node("sales", "Orders", 20.0),
                node("sales", "RecentOrders", 30.0),
                node("dbo", "Dropped", 40.0),
            ],
            ..CanvasState::default()
        };

        let retained = canvas.retaining_entities_of(&sample_snapshot());
        let names: Vec<String> = retained
            .nodes
            .iter()
            .map(|node| node.name.to_string())
            .collect();
        assert_eq!(
            names,
            ["dbo.Customers", "sales.Orders", "sales.RecentOrders"]
        );
        let orders = retained
            .node(&QualifiedName::new("sales", "Orders"))
            .expect("orders survives");
        assert_eq!(orders.position.x, 20.0);
        assert!(
            retained
                .node(&QualifiedName::new("dbo", "Dropped"))
                .is_none()
        );
    }

    #[test]
    fn normalizing_sorts_and_keeps_the_latest_duplicate() {
        let canvas = CanvasState {
            nodes: vec![
                node("sales", "Orders", 1.0),
                node("dbo", "Customers", 2.0),
                node("sales", "Orders", 3.0),
            ],
            ..CanvasState::default()
        }
        .normalized();

        assert_eq!(canvas.nodes.len(), 2);
        assert_eq!(canvas.nodes[0].name.to_string(), "dbo.Customers");
        assert_eq!(canvas.nodes[1].name.to_string(), "sales.Orders");
        assert_eq!(canvas.nodes[1].position.x, 3.0);
    }

    #[test]
    fn missing_fields_take_defaults_when_deserialising() {
        let canvas: CanvasState = serde_json::from_str("{}").unwrap();
        assert_eq!(canvas, CanvasState::default());

        let json = r#"{ "nodes": [ { "name": { "schema": "dbo", "name": "T" }, "position": { "x": 1, "y": 2 } } ] }"#;
        let canvas: CanvasState = serde_json::from_str(json).unwrap();
        assert_eq!(canvas.nodes.len(), 1);
        assert!(!canvas.nodes[0].is_collapsed);
        assert!(!canvas.nodes[0].is_hidden);
    }
}
