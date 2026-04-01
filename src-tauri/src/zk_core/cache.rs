use std::collections::HashMap;

use crate::domain::{CachedTreeNodeDto, TreeSnapshotDto};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRecord {
    pub path: String,
    pub name: String,
    pub parent_path: Option<String>,
    pub has_children: bool,
}

impl NodeRecord {
    pub fn new(path: &str, name: &str, parent_path: Option<String>, has_children: bool) -> Self {
        Self {
            path: path.to_string(),
            name: name.to_string(),
            parent_path,
            has_children,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheStatus {
    Bootstrapping,
    Live,
    Resyncing,
    Stale,
}

#[derive(Debug)]
pub struct ConnectionCache {
    status: CacheStatus,
    nodes_by_path: HashMap<String, NodeRecord>,
    children_by_parent: HashMap<String, Vec<String>>,
}

impl ConnectionCache {
    pub fn new() -> Self {
        Self {
            status: CacheStatus::Bootstrapping,
            nodes_by_path: HashMap::new(),
            children_by_parent: HashMap::new(),
        }
    }

    pub fn status_label(&self) -> &'static str {
        match self.status {
            CacheStatus::Bootstrapping => "bootstrapping",
            CacheStatus::Live => "live",
            CacheStatus::Resyncing => "resyncing",
            CacheStatus::Stale => "stale",
        }
    }

    pub fn set_status(&mut self, status: CacheStatus) {
        self.status = status;
    }

    pub fn mark_live(&mut self) {
        self.status = CacheStatus::Live;
    }

    pub fn mark_resyncing(&mut self) {
        self.status = CacheStatus::Resyncing;
    }

    pub fn replace_all(&mut self, nodes: Vec<NodeRecord>) {
        self.nodes_by_path.clear();
        self.children_by_parent.clear();

        for node in nodes {
            if let Some(parent_path) = node.parent_path.clone() {
                self.children_by_parent
                    .entry(parent_path)
                    .or_default()
                    .push(node.path.clone());
            }
            self.nodes_by_path.insert(node.path.clone(), node);
        }

        for child_paths in self.children_by_parent.values_mut() {
            child_paths.sort();
        }
    }

    pub fn to_snapshot(&self) -> TreeSnapshotDto {
        let mut nodes = self
            .nodes_by_path
            .values()
            .cloned()
            .map(|node| CachedTreeNodeDto {
                path: node.path,
                name: node.name,
                parent_path: node.parent_path,
                has_children: node.has_children,
            })
            .collect::<Vec<_>>();
        nodes.sort_by(|left, right| left.path.cmp(&right.path));

        TreeSnapshotDto {
            status: self.status_label().to_string(),
            nodes,
        }
    }

    pub fn upsert_children(&mut self, parent_path: &str, children: Vec<NodeRecord>) {
        if let Some(previous_children) = self.children_by_parent.remove(parent_path) {
            for child_path in previous_children {
                self.remove_subtree(&child_path);
            }
        }

        let child_paths = children
            .iter()
            .map(|child| child.path.clone())
            .collect::<Vec<_>>();

        self.children_by_parent
            .insert(parent_path.to_string(), child_paths);

        for child in children {
            self.nodes_by_path.insert(child.path.clone(), child);
        }
    }

    pub fn reconcile_children(&mut self, parent_path: &str, children: Vec<NodeRecord>) {
        self.reconcile_children_internal(parent_path, children, false);
    }

    pub fn reconcile_children_preserving_expandability(
        &mut self,
        parent_path: &str,
        children: Vec<NodeRecord>,
    ) {
        self.reconcile_children_internal(parent_path, children, true);
    }

    fn reconcile_children_internal(
        &mut self,
        parent_path: &str,
        children: Vec<NodeRecord>,
        preserve_known_expandability: bool,
    ) {
        let previous_child_paths = self
            .children_by_parent
            .remove(parent_path)
            .unwrap_or_default();

        let mut next_child_paths = children
            .iter()
            .map(|child| child.path.clone())
            .collect::<Vec<_>>();
        next_child_paths.sort();

        let next_child_path_set = next_child_paths
            .iter()
            .cloned()
            .collect::<std::collections::HashSet<_>>();

        for child_path in previous_child_paths {
            if !next_child_path_set.contains(&child_path) {
                self.remove_subtree(&child_path);
            }
        }

        let should_preserve_expandability = preserve_known_expandability
            && next_child_paths.is_empty()
            && parent_path != "/"
            && self
                .nodes_by_path
                .get(parent_path)
                .map(|node| node.has_children)
                .unwrap_or(false);

        if parent_path != "/" {
            if let Some(parent) = self.nodes_by_path.get_mut(parent_path) {
                parent.has_children = should_preserve_expandability || !next_child_paths.is_empty();
            }
        }

        self.children_by_parent
            .insert(parent_path.to_string(), next_child_paths);

        for child in children {
            self.nodes_by_path.insert(child.path.clone(), child);
        }
    }

    pub fn children_of(&self, parent_path: &str) -> Vec<NodeRecord> {
        self.children_by_parent
            .get(parent_path)
            .into_iter()
            .flat_map(|paths| paths.iter())
            .filter_map(|path| self.nodes_by_path.get(path).cloned())
            .collect()
    }

    pub fn node(&self, path: &str) -> Option<&NodeRecord> {
        self.nodes_by_path.get(path)
    }

    pub fn remove_subtree(&mut self, path: &str) {
        let child_paths = self.children_by_parent.remove(path).unwrap_or_default();

        if let Some(parent_path) = self
            .nodes_by_path
            .get(path)
            .and_then(|node| node.parent_path.clone())
        {
            if let Some(children) = self.children_by_parent.get_mut(&parent_path) {
                children.retain(|child_path| child_path != path);
            }
        }

        for child_path in child_paths {
            self.remove_subtree(&child_path);
        }

        self.nodes_by_path.remove(path);
    }
}

impl Default for ConnectionCache {
    fn default() -> Self {
        Self::new()
    }
}
