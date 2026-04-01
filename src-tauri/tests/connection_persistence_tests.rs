use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use zoocute_lib::commands::{
    load_connections_from_path_with_timestamp, AppState, ConnectionsLoadStatus,
};
use zoocute_lib::domain::{
    LoadPersistedConnectionsResponseDto, PersistedConnectionsDto,
    PersistedConnectionsLoadStatusDto, PersistedConnectionsLoadStatusKindDto, SavedConnectionDto,
};

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("zoocute-{name}-{suffix}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn test_state(data_root: PathBuf) -> AppState {
    AppState::new_for_tests_with_runtime_mode(
        data_root.join("logs/zookeeper-debug.jsonl"),
        zoocute_lib::commands::RuntimeMode::Portable,
        data_root,
    )
}

#[test]
fn missing_connections_file_returns_default_payload() {
    let data_root = temp_dir("connections-defaults");
    let state = test_state(data_root);

    let persisted = state.get_persisted_connections();
    let response = state.load_persisted_connections_response();

    assert_eq!(persisted, PersistedConnectionsDto::default());
    assert_eq!(
        state.connections_load_status(),
        ConnectionsLoadStatus::Missing,
    );
    assert_eq!(
        response,
        LoadPersistedConnectionsResponseDto {
            connections: PersistedConnectionsDto::default(),
            status: PersistedConnectionsLoadStatusDto {
                kind: PersistedConnectionsLoadStatusKindDto::Missing,
                message: None,
            },
        }
    );
}

#[test]
fn malformed_connections_file_is_renamed_aside_before_returning_defaults() {
    let data_root = temp_dir("connections-malformed");
    let bad_path = data_root.join("connections.json");
    fs::write(&bad_path, "{not valid json").unwrap();
    let state = test_state(data_root);

    let persisted = state.get_persisted_connections();
    let backup_files = fs::read_dir(state.data_root())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("connections.json.corrupt-"))
        .collect::<Vec<_>>();

    assert_eq!(persisted, PersistedConnectionsDto::default());
    assert!(!bad_path.exists(), "malformed file should be renamed aside");
    assert_eq!(backup_files.len(), 1, "expected one corrupt backup file");
    match state.connections_load_status() {
        ConnectionsLoadStatus::Quarantined { message } => {
            assert!(message.contains("connections.json"));
        }
        other => panic!("expected quarantined status, got {other:?}"),
    }
}

#[test]
fn unreadable_connections_path_is_quarantined_instead_of_treated_as_missing() {
    let data_root = temp_dir("connections-unreadable");
    let bad_path = data_root.join("connections.json");
    fs::create_dir_all(&bad_path).unwrap();
    let state = test_state(data_root);

    let persisted = state.get_persisted_connections();
    let backup_files = fs::read_dir(state.data_root())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("connections.json.corrupt-"))
        .collect::<Vec<_>>();

    assert_eq!(persisted, PersistedConnectionsDto::default());
    assert!(
        !bad_path.exists(),
        "unreadable path should be renamed aside"
    );
    assert_eq!(backup_files.len(), 1, "expected one unreadable backup path");
    match state.connections_load_status() {
        ConnectionsLoadStatus::Quarantined { message } => {
            assert!(message.contains("failed to read") || message.contains("failed to parse"));
        }
        other => panic!("expected quarantined status, got {other:?}"),
    }
}

#[test]
fn save_persisted_connections_writes_connections_json_in_data_root() {
    let data_root = temp_dir("connections-roundtrip");
    let state = test_state(data_root.clone());
    let payload = PersistedConnectionsDto {
        saved_connections: vec![SavedConnectionDto {
            id: "prod".into(),
            name: "Production".into(),
            connection_string: "10.0.0.1:2181".into(),
            username: Some("admin".into()),
            password: Some("secret".into()),
            timeout_ms: 8000,
        }],
        selected_connection_id: Some("prod".into()),
    };

    state
        .save_persisted_connections(payload.clone())
        .expect("connections should persist");

    let raw = fs::read_to_string(data_root.join("connections.json"))
        .expect("connections file should exist");
    let saved: PersistedConnectionsDto =
        serde_json::from_str(&raw).expect("connections file should be valid json");

    assert_eq!(saved, payload);
    assert_eq!(state.get_persisted_connections(), payload);
}

#[test]
fn load_repairs_invalid_ids_duplicates_and_orphaned_selection() {
    let data_root = temp_dir("connections-sanitize-load");
    fs::write(
        data_root.join("connections.json"),
        r#"{
            "savedConnections": [
                { "id": "prod", "name": "Production", "connectionString": "10.0.0.1:2181", "timeoutMs": 8000 },
                { "id": " ", "name": "Blank", "connectionString": "10.0.0.2:2181", "timeoutMs": 5000 },
                { "id": "prod", "name": "Duplicate", "connectionString": "10.0.0.3:2181", "timeoutMs": 5000 }
            ],
            "selectedConnectionId": "missing"
        }"#,
    )
    .unwrap();
    let state = test_state(data_root);

    let persisted = state.get_persisted_connections();
    let response = state.load_persisted_connections_response();

    assert_eq!(
        persisted,
        PersistedConnectionsDto {
            saved_connections: vec![SavedConnectionDto {
                id: "prod".into(),
                name: "Production".into(),
                connection_string: "10.0.0.1:2181".into(),
                username: None,
                password: None,
                timeout_ms: 8000,
            }],
            selected_connection_id: None,
        }
    );
    match state.connections_load_status() {
        ConnectionsLoadStatus::Sanitized { message } => {
            assert!(message.contains("invalid"));
        }
        other => panic!("expected sanitized status, got {other:?}"),
    }
    assert_eq!(
        response.status.kind,
        PersistedConnectionsLoadStatusKindDto::Sanitized
    );
    assert!(response
        .status
        .message
        .unwrap_or_default()
        .contains("invalid"));
}

#[test]
fn save_rejects_empty_connection_ids_and_preserves_existing_file() {
    let data_root = temp_dir("connections-empty-id");
    let state = test_state(data_root.clone());
    let original = PersistedConnectionsDto {
        saved_connections: vec![SavedConnectionDto {
            id: "prod".into(),
            name: "Production".into(),
            connection_string: "10.0.0.1:2181".into(),
            username: None,
            password: None,
            timeout_ms: 8000,
        }],
        selected_connection_id: Some("prod".into()),
    };
    state
        .save_persisted_connections(original.clone())
        .expect("initial payload should persist");

    let error = state
        .save_persisted_connections(PersistedConnectionsDto {
            saved_connections: vec![SavedConnectionDto {
                id: " ".into(),
                name: "Broken".into(),
                connection_string: "10.0.0.2:2181".into(),
                username: None,
                password: None,
                timeout_ms: 5000,
            }],
            selected_connection_id: None,
        })
        .expect_err("empty IDs should be rejected");

    let saved = fs::read_to_string(data_root.join("connections.json")).unwrap();

    assert!(error.contains("empty connection id"));
    assert_eq!(
        serde_json::from_str::<PersistedConnectionsDto>(&saved).unwrap(),
        original
    );
}

#[test]
fn save_rejects_duplicate_connection_ids() {
    let data_root = temp_dir("connections-duplicate-id");
    let state = test_state(data_root);

    let error = state
        .save_persisted_connections(PersistedConnectionsDto {
            saved_connections: vec![
                SavedConnectionDto {
                    id: "prod".into(),
                    name: "Production".into(),
                    connection_string: "10.0.0.1:2181".into(),
                    username: None,
                    password: None,
                    timeout_ms: 8000,
                },
                SavedConnectionDto {
                    id: "prod".into(),
                    name: "Duplicate".into(),
                    connection_string: "10.0.0.2:2181".into(),
                    username: None,
                    password: None,
                    timeout_ms: 5000,
                },
            ],
            selected_connection_id: Some("prod".into()),
        })
        .expect_err("duplicate IDs should be rejected");

    assert!(error.contains("duplicate connection id"));
}

#[test]
fn save_normalizes_unknown_selected_id_and_cleans_up_temp_files() {
    let data_root = temp_dir("connections-normalize-selected");
    let state = test_state(data_root.clone());

    let saved = state
        .save_persisted_connections(PersistedConnectionsDto {
            saved_connections: vec![SavedConnectionDto {
                id: "prod".into(),
                name: "Production".into(),
                connection_string: "10.0.0.1:2181".into(),
                username: Some("admin".into()),
                password: Some("secret".into()),
                timeout_ms: 8000,
            }],
            selected_connection_id: Some("missing".into()),
        })
        .expect("payload should save with normalized selection");

    let temp_files = fs::read_dir(data_root)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".tmp-"))
        .collect::<Vec<_>>();

    assert_eq!(
        saved.selected_connection_id, None,
        "unknown selected ID should be normalized away"
    );
    assert!(
        temp_files.is_empty(),
        "temporary files should be cleaned up"
    );
}

#[test]
fn quarantine_failure_is_reported_explicitly_in_load_status() {
    let data_root = temp_dir("connections-quarantine-failure");
    let bad_path = data_root.join("connections.json");
    fs::write(&bad_path, "{not valid json").unwrap();
    fs::write(data_root.join("connections.json.corrupt-4242"), "occupied").unwrap();

    let (persisted, status) = load_connections_from_path_with_timestamp(&bad_path, 4242);

    assert_eq!(persisted, PersistedConnectionsDto::default());
    match status {
        ConnectionsLoadStatus::QuarantineFailed { message } => {
            assert!(message.contains("connections.json"));
            assert!(message.contains("corrupt-4242"));
        }
        other => panic!("expected quarantine failure status, got {other:?}"),
    }
    assert!(
        bad_path.exists(),
        "original file should remain when quarantine fails"
    );
}
