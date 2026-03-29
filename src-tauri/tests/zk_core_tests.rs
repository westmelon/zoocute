use zoocute_lib::commands::AppState;
use zoocute_lib::domain::{ConnectRequestDto, LoadedTreeNodeDto};
use zoocute_lib::zk_core::adapter::ReadOnlyZkAdapter;
use zoocute_lib::zk_core::interpreter::DataKind;
use zoocute_lib::zk_core::mock::MockAdapter;
use zoocute_lib::zk_core::types::AuthMode;

#[test]
fn reports_digest_auth_mode_when_credentials_exist() {
    let request = ConnectRequestDto {
        connection_string: "127.0.0.1:2181".into(),
        username: Some("demo".into()),
        password: Some("secret".into()),
    };

    assert_eq!(request.auth_mode(), AuthMode::Digest);
}

#[test]
fn reports_anonymous_auth_mode_when_credentials_are_absent() {
    let request = ConnectRequestDto {
        connection_string: "127.0.0.1:2181".into(),
        username: None,
        password: None,
    };

    assert_eq!(request.auth_mode(), AuthMode::Anonymous);
}

#[test]
fn mock_adapter_returns_children_for_known_paths() {
    let adapter = MockAdapter::default();
    let children = adapter.list_children("/").expect("children should load");

    assert!(children.iter().any(|child: &LoadedTreeNodeDto| child.name == "configs"));
    assert!(children.iter().any(|child: &LoadedTreeNodeDto| child.name == "services"));
}

#[test]
fn session_blob_is_classified_binary() {
    let adapter = MockAdapter::default();
    let details = adapter.get_node("/services/session_blob").expect("node should exist");

    assert_eq!(details.data_kind, DataKind::Binary);
    assert!(!details.editable);
}

#[test]
fn node_details_includes_full_stat_fields() {
    let adapter = MockAdapter::default();
    let details = adapter.get_node("/configs/payment/switches").expect("node should exist");
    assert!(details.c_zxid.is_some());
    assert!(details.m_zxid.is_some());
    assert!(details.c_version >= 0);
    assert!(details.acl_version >= 0);
    assert!(details.data_length >= 0);
    assert!(details.c_time > 0);
    assert!(details.m_time > 0);
}

#[test]
fn sessions_map_starts_empty() {
    let state = AppState::default();
    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.is_empty());
}

#[test]
fn multiple_connection_ids_stored_independently() {
    let state = AppState::default();
    let sessions = state.sessions.lock().unwrap();
    assert!(!sessions.contains_key("conn-a"));
    assert!(!sessions.contains_key("conn-b"));
}
