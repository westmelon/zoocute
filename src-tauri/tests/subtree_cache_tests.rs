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
