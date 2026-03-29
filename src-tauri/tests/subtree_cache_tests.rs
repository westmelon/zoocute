use zoocute_lib::zk_core::cache::{ConnectionCache, NodeRecord};

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
