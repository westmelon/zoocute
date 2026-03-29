use std::collections::HashMap;

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

#[derive(Debug, Default)]
pub struct ConnectionCache {
    nodes_by_path: HashMap<String, NodeRecord>,
    children_by_parent: HashMap<String, Vec<String>>,
}

impl ConnectionCache {
    pub fn new() -> Self {
        Self::default()
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
        let child_paths = self
            .children_by_parent
            .remove(path)
            .unwrap_or_default();

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
