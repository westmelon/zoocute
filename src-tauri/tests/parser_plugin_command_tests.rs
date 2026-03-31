use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use zoocute_lib::parser_plugins::{discover_plugins, run_plugin_with_bytes};

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
fn runs_plugin_and_collects_stdout() {
    let root = temp_dir("plugin-runner");
    write_manifest(
        &root.join("echoer"),
        r#"{
            "id": "echoer",
            "name": "Echoer",
            "enabled": true,
            "command": "powershell",
            "args": [
                "-NoProfile",
                "-Command",
                "$reader = New-Object System.IO.BinaryReader([Console]::OpenStandardInput()); $bytes = New-Object byte[] 4; [void]$reader.Read($bytes, 0, 4); [Console]::Out.Write([System.BitConverter]::ToString($bytes))"
            ]
        }"#,
    );

    let plugin = discover_plugins(&root)
        .expect("plugins should load")
        .into_iter()
        .next()
        .expect("expected plugin");

    let output = run_plugin_with_bytes(&plugin, &[0xDE, 0xAD, 0xBE, 0xEF], 5_000)
        .expect("plugin should run");

    assert_eq!(output.stdout.trim(), "DE-AD-BE-EF");
    assert!(output.stderr.trim().is_empty());
}

#[test]
fn returns_non_zero_exit_as_error() {
    let root = temp_dir("plugin-fail");
    write_manifest(
        &root.join("broken"),
        r#"{
            "id": "broken",
            "name": "Broken",
            "enabled": true,
            "command": "powershell",
            "args": ["-NoProfile", "-Command", "[Console]::Error.Write('boom'); exit 7"]
        }"#,
    );

    let plugin = discover_plugins(&root)
        .expect("plugins should load")
        .into_iter()
        .next()
        .expect("expected plugin");

    let error = run_plugin_with_bytes(&plugin, &[1, 2, 3], 5_000).expect_err("plugin should fail");

    assert!(error.contains("exit code 7"));
    assert!(error.contains("boom"));
}
