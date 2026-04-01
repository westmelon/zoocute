use std::path::PathBuf;

use zoocute_lib::commands::{resolve_runtime_mode_and_data_root_from_paths, AppState, RuntimeMode};

#[test]
fn standard_executable_uses_app_data_dir() {
    let exe_path = PathBuf::from("C:/Program Files/ZooCute/ZooCute.exe");
    let app_data_dir = PathBuf::from("C:/Users/Neo/AppData/Roaming/com.zoocute.app");

    let (runtime_mode, data_root) =
        resolve_runtime_mode_and_data_root_from_paths(&exe_path, app_data_dir.clone());

    assert_eq!(runtime_mode, RuntimeMode::Standard);
    assert_eq!(data_root, app_data_dir);
}

#[test]
fn portable_executable_uses_zoo_data_directory() {
    let exe_path = PathBuf::from("D:/portable/ZooCutePortable.exe");
    let app_data_dir = PathBuf::from("C:/Users/Neo/AppData/Roaming/com.zoocute.app");
    let expected_data_root = PathBuf::from("D:/portable/zoo_data");

    let (runtime_mode, data_root) =
        resolve_runtime_mode_and_data_root_from_paths(&exe_path, app_data_dir);

    assert_eq!(runtime_mode, RuntimeMode::Portable);
    assert_eq!(data_root, expected_data_root);
}

#[test]
fn portable_state_uses_single_data_root_for_paths() {
    let data_root = PathBuf::from("D:/portable/zoo_data");
    let state = AppState::new_for_tests_with_runtime_mode(
        data_root.join("logs/zookeeper-debug.jsonl"),
        RuntimeMode::Portable,
        data_root.clone(),
    );

    assert_eq!(state.runtime_mode(), RuntimeMode::Portable);
    assert_eq!(state.data_root(), data_root);
    assert_eq!(
        state.default_plugin_root(),
        PathBuf::from("D:/portable/zoo_data/plugins")
    );
    assert_eq!(
        state.plugin_root(),
        PathBuf::from("D:/portable/zoo_data/plugins")
    );
}
