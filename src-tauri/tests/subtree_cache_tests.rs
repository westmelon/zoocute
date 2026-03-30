use zoocute_lib::zk_core::cache::{ConnectionCache, NodeRecord};
use zoocute_lib::domain::{CachedTreeNodeDto, TreeSnapshotDto};

#[test]
fn inserts_root_children_and_tracks_parent_relationships() {
    let mut cache = ConnectionCache::new();

    cache.upsert_children(
        "/",
        vec![
            NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
            NodeRecord::new("/zookeeper", "zookeeper", Some("/".into()), true),
        ],
    );

    let root_children = cache.children_of("/");
    assert_eq!(root_children.len(), 2);
    assert_eq!(root_children[0].path, "/ssdev");
    assert_eq!(root_children[1].path, "/zookeeper");
}

#[test]
fn removing_subtree_drops_descendants_and_parent_links() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true)],
    );
    cache.upsert_children(
        "/ssdev",
        vec![NodeRecord::new(
            "/ssdev/services",
            "services",
            Some("/ssdev".into()),
            true,
        )],
    );

    cache.remove_subtree("/ssdev");

    assert!(cache.node("/ssdev").is_none());
    assert!(cache.node("/ssdev/services").is_none());
    assert!(cache.children_of("/").is_empty());
}

#[test]
fn refreshing_parent_replaces_stale_children_and_descendants() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true)],
    );
    cache.upsert_children(
        "/ssdev",
        vec![NodeRecord::new(
            "/ssdev/services",
            "services",
            Some("/ssdev".into()),
            true,
        )],
    );

    cache.upsert_children(
        "/",
        vec![NodeRecord::new(
            "/zookeeper",
            "zookeeper",
            Some("/".into()),
            true,
        )],
    );

    assert!(cache.node("/ssdev").is_none());
    assert!(cache.node("/ssdev/services").is_none());

    let root_children = cache.children_of("/");
    assert_eq!(root_children.len(), 1);
    assert_eq!(root_children[0].path, "/zookeeper");
}

#[test]
fn tree_snapshot_dto_carries_nodes_and_status() {
    let snapshot = TreeSnapshotDto {
        status: "bootstrapping".into(),
        nodes: vec![CachedTreeNodeDto {
            path: "/ssdev".into(),
            name: "ssdev".into(),
            parent_path: Some("/".into()),
            has_children: true,
        }],
    };

    assert_eq!(snapshot.status, "bootstrapping");
    assert_eq!(snapshot.nodes[0].path, "/ssdev");
}

#[test]
fn snapshot_can_export_bootstrapped_root_nodes() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![
            NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
            NodeRecord::new("/zookeeper", "zookeeper", Some("/".into()), true),
        ],
    );
    cache.mark_live();

    let snapshot = cache.to_snapshot();
    assert_eq!(snapshot.status, "live");
    assert_eq!(snapshot.nodes.len(), 2);
}

#[test]
fn replace_all_keeps_children_order_stable() {
    let mut cache = ConnectionCache::new();
    cache.replace_all(vec![
        NodeRecord::new("/zookeeper", "zookeeper", Some("/".into()), true),
        NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
    ]);

    let root_children = cache.children_of("/");
    assert_eq!(root_children.len(), 2);
    assert_eq!(root_children[0].path, "/ssdev");
    assert_eq!(root_children[1].path, "/zookeeper");
}

#[test]
fn replace_all_can_recover_from_stale_cache_state() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![NodeRecord::new("/old", "old", Some("/".into()), false)],
    );

    cache.replace_all(vec![
        NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
    ]);
    cache.mark_live();

    assert!(cache.node("/old").is_none());
    assert!(cache.node("/ssdev").is_some());
}

#[test]
fn reconciling_descendant_children_promotes_recreated_parent_back_to_expandable() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true)],
    );
    cache.upsert_children(
        "/ssdev",
        vec![NodeRecord::new(
            "/ssdev/services",
            "services",
            Some("/ssdev".into()),
            true,
        )],
    );

    cache.reconcile_children(
        "/ssdev/services",
        vec![NodeRecord::new(
            "/ssdev/services/bbp",
            "bbp",
            Some("/ssdev/services".into()),
            false,
        )],
    );

    cache.reconcile_children(
        "/ssdev/services/bbp",
        vec![NodeRecord::new(
            "/ssdev/services/bbp/bbp.organizationDAO",
            "bbp.organizationDAO",
            Some("/ssdev/services/bbp".into()),
            false,
        )],
    );

    let bbp = cache.node("/ssdev/services/bbp").expect("bbp node should exist");
    assert!(bbp.has_children, "bbp should become expandable after descendants appear");

    let snapshot = cache.to_snapshot();
    assert!(
        snapshot
            .nodes
            .iter()
            .any(|node| node.path == "/ssdev/services/bbp/bbp.organizationDAO"),
        "descendant node should be present in the exported snapshot"
    );
}

#[test]
fn seed_reconcile_preserves_known_expandability_when_first_branch_read_is_empty() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true)],
    );
    cache.upsert_children(
        "/ssdev",
        vec![NodeRecord::new(
            "/ssdev/services",
            "services",
            Some("/ssdev".into()),
            true,
        )],
    );
    cache.upsert_children(
        "/ssdev/services",
        vec![NodeRecord::new(
            "/ssdev/services/bbp",
            "bbp",
            Some("/ssdev/services".into()),
            true,
        )],
    );

    cache.reconcile_children_preserving_expandability("/ssdev/services/bbp", vec![]);

    let bbp = cache.node("/ssdev/services/bbp").expect("bbp node should exist");
    assert!(
        bbp.has_children,
        "initial subtree seed should not downgrade a known-expandable node"
    );
}

#[test]
fn authoritative_refresh_can_still_demote_parent_when_children_are_truly_gone() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children(
        "/",
        vec![NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true)],
    );
    cache.upsert_children(
        "/ssdev",
        vec![NodeRecord::new(
            "/ssdev/services",
            "services",
            Some("/ssdev".into()),
            true,
        )],
    );
    cache.upsert_children(
        "/ssdev/services",
        vec![NodeRecord::new(
            "/ssdev/services/bbp",
            "bbp",
            Some("/ssdev/services".into()),
            true,
        )],
    );

    cache.reconcile_children("/ssdev/services/bbp", vec![]);

    let bbp = cache.node("/ssdev/services/bbp").expect("bbp node should exist");
    assert!(
        !bbp.has_children,
        "authoritative watch refresh should be able to demote a branch back to leaf"
    );
}
