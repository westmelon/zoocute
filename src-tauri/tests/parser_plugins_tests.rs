use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use zoocute_lib::parser_plugins::{discover_plugins, to_dtos};

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("zoocute-{name}-{suffix}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_manifest(dir: &PathBuf, contents: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("plugin.json"), contents).unwrap();
}

#[test]
fn discovers_enabled_plugins_from_child_directories() {
    let root = temp_dir("plugin-discovery");
    write_manifest(
        &root.join("dubbo"),
        r#"{
            "id": "dubbo-provider",
            "name": "Dubbo Provider Decoder",
            "enabled": true,
            "command": "java",
            "args": ["-jar", "parser.jar"]
        }"#,
    );

    let plugins = discover_plugins(&root).expect("plugins should load");

    assert_eq!(plugins.len(), 1);
    assert_eq!(plugins[0].manifest.id, "dubbo-provider");
    assert_eq!(plugins[0].manifest.name, "Dubbo Provider Decoder");
}

#[test]
fn skips_disabled_plugins() {
    let root = temp_dir("plugin-disabled");
    write_manifest(
        &root.join("disabled"),
        r#"{
            "id": "disabled",
            "name": "Disabled",
            "enabled": false,
            "command": "java",
            "args": ["-jar", "parser.jar"]
        }"#,
    );

    let plugins = discover_plugins(&root).expect("plugins should load");

    assert!(plugins.is_empty());
}

#[test]
fn sorts_plugins_by_manifest_name() {
    let root = temp_dir("plugin-sort");
    write_manifest(
        &root.join("zeta"),
        r#"{
            "id": "zeta",
            "name": "Zeta Decoder",
            "enabled": true,
            "command": "java"
        }"#,
    );
    write_manifest(
        &root.join("alpha"),
        r#"{
            "id": "alpha",
            "name": "Alpha Decoder",
            "enabled": true,
            "command": "java"
        }"#,
    );

    let plugins = discover_plugins(&root).expect("plugins should load");

    assert_eq!(plugins[0].manifest.name, "Alpha Decoder");
    assert_eq!(plugins[1].manifest.name, "Zeta Decoder");
}

#[test]
fn rejects_manifest_without_id() {
    let root = temp_dir("plugin-invalid");
    write_manifest(
        &root.join("invalid"),
        r#"{
            "name": "Broken",
            "enabled": true,
            "command": "java",
            "args": ["-jar", "parser.jar"]
        }"#,
    );

    let plugins = discover_plugins(&root).expect("invalid plugins should be skipped");

    assert!(plugins.is_empty());
}

#[test]
fn discovers_valid_plugins_when_invalid_plugins_coexist() {
    let root = temp_dir("plugin-mixed");
    write_manifest(
        &root.join("valid"),
        r#"{
            "id": "valid",
            "name": "Valid Decoder",
            "enabled": true,
            "command": "java"
        }"#,
    );
    write_manifest(
        &root.join("invalid"),
        r#"{
            "name": "Broken",
            "enabled": true,
            "command": "java",
            "args": ["-jar", "parser.jar"]
        }"#,
    );

    let plugins = discover_plugins(&root).expect("valid plugins should still load");

    assert_eq!(plugins.len(), 1);
    assert_eq!(plugins[0].manifest.id, "valid");
}

#[test]
fn rejects_duplicate_enabled_plugin_ids() {
    let root = temp_dir("plugin-duplicate");
    write_manifest(
        &root.join("first"),
        r#"{
            "id": "duplicate",
            "name": "First Decoder",
            "enabled": true,
            "command": "java"
        }"#,
    );
    write_manifest(
        &root.join("second"),
        r#"{
            "id": "duplicate",
            "name": "Second Decoder",
            "enabled": true,
            "command": "java"
        }"#,
    );

    let error = discover_plugins(&root).expect_err("duplicate enabled ids should fail");
    assert!(error.contains("duplicate"));
}

#[test]
fn exposes_dto_conversion_for_frontend_use() {
    let root = temp_dir("plugin-dtos");
    write_manifest(
        &root.join("dubbo"),
        r#"{
            "id": "dubbo-provider",
            "name": "Dubbo Provider Decoder",
            "enabled": true,
            "command": "java"
        }"#,
    );

    let plugins = discover_plugins(&root).expect("plugins should load");
    let dtos = to_dtos(&plugins);

    assert_eq!(dtos.len(), 1);
    assert_eq!(dtos[0].id, "dubbo-provider");
    assert_eq!(dtos[0].name, "Dubbo Provider Decoder");
}
