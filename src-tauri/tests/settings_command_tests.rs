use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use zoocute_lib::commands::{AppState, RuntimeMode};

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("zoocute-{name}-{suffix}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn defaults_to_system_theme_readonly_mode_and_default_plugin_root() {
    let root = temp_dir("settings-defaults");
    let state = AppState::new_for_tests_with_paths(
        root.join("log.jsonl"),
        root.join("settings.json"),
        root.join("plugins"),
    );

    let settings = state.get_settings();

    assert_eq!(settings.theme, "system");
    assert_eq!(settings.write_mode, "readonly");
    assert_eq!(settings.plugin_directory, None);
    assert_eq!(state.plugin_root(), root.join("plugins"));
}

#[test]
fn custom_plugin_directory_overrides_default_root_and_can_reset() {
    let root = temp_dir("settings-plugin-root");
    let custom = root.join("custom-plugins");
    let state = AppState::new_for_tests_with_paths(
        root.join("log.jsonl"),
        root.join("settings.json"),
        root.join("plugins"),
    );

    let updated = state
        .set_plugin_directory(Some(custom.display().to_string()))
        .expect("settings should update");
    assert_eq!(updated.plugin_directory, Some(custom.display().to_string()));
    assert_eq!(state.plugin_root(), custom);

    let reset = state
        .set_plugin_directory(None)
        .expect("settings should reset");
    assert_eq!(reset.plugin_directory, None);
    assert_eq!(state.plugin_root(), root.join("plugins"));
}

#[test]
fn readonly_mode_blocks_write_commands() {
    let root = temp_dir("settings-readonly");
    let state = AppState::new_for_tests_with_paths(
        root.join("log.jsonl"),
        root.join("settings.json"),
        root.join("plugins"),
    );

    let error = state
        .ensure_write_enabled()
        .expect_err("readonly should block writes");
    assert!(error.contains("只读"));

    state
        .set_write_mode("readwrite".to_string())
        .expect("write mode should update");
    assert!(state.ensure_write_enabled().is_ok());
}

#[test]
fn portable_mode_ignores_custom_plugin_directory_from_settings_file() {
    let root = temp_dir("settings-portable-fixed-plugin-root");
    let custom = root.join("custom-plugins");
    fs::write(
        root.join("settings.json"),
        format!(
            r#"{{
                "theme": "dark",
                "writeMode": "readonly",
                "pluginDirectory": "{}"
            }}"#,
            custom.display()
        ),
    )
    .unwrap();

    let state = AppState::new_for_tests_with_runtime_mode(
        root.join("log.jsonl"),
        RuntimeMode::Portable,
        root.clone(),
    );

    assert_eq!(state.get_settings().plugin_directory, None);
    assert_eq!(state.plugin_root(), root.join("plugins"));
}

#[test]
fn portable_mode_rejects_runtime_plugin_directory_override() {
    let root = temp_dir("settings-portable-reject-plugin-root");
    let state = AppState::new_for_tests_with_runtime_mode(
        root.join("log.jsonl"),
        RuntimeMode::Portable,
        root.clone(),
    );

    let error = state
        .set_plugin_directory(Some(root.join("custom-plugins").display().to_string()))
        .expect_err("portable mode should reject custom plugin roots");

    assert!(error.contains("zoo_data/plugins"));
    assert_eq!(state.get_settings().plugin_directory, None);
    assert_eq!(state.plugin_root(), root.join("plugins"));
}
