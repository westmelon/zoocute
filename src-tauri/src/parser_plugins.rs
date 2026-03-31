use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct ParserPluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParserPluginDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct ParserPluginDefinition {
    pub manifest: ParserPluginManifest,
    pub directory: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginExecutionOutput {
    pub stdout: String,
    pub stderr: String,
}

fn default_enabled() -> bool {
    true
}

pub fn discover_plugins(root: &Path) -> Result<Vec<ParserPluginDefinition>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut definitions = Vec::new();
    let mut seen_ids = HashSet::new();
    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let directory = entry.path();
        if !directory.is_dir() {
            continue;
        }

        let manifest_path = directory.join("plugin.json");
        if !manifest_path.exists() {
            continue;
        }

        let raw_manifest = match fs::read_to_string(&manifest_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let manifest: ParserPluginManifest = match serde_json::from_str(&raw_manifest) {
            Ok(manifest) => manifest,
            Err(_) => continue,
        };

        if !manifest.enabled {
            continue;
        }

        if let Err(_) = validate_manifest(&manifest, &manifest_path) {
            continue;
        }

        if !seen_ids.insert(manifest.id.clone()) {
            return Err(format!("duplicate enabled plugin id: {}", manifest.id));
        }

        definitions.push(ParserPluginDefinition {
            manifest,
            directory,
        });
    }

    definitions.sort_by(|left, right| left.manifest.name.cmp(&right.manifest.name));
    Ok(definitions)
}

pub fn to_dtos(definitions: &[ParserPluginDefinition]) -> Vec<ParserPluginDto> {
    definitions
        .iter()
        .map(|definition| ParserPluginDto {
            id: definition.manifest.id.clone(),
            name: definition.manifest.name.clone(),
        })
        .collect()
}

pub fn run_plugin_with_bytes(
    plugin: &ParserPluginDefinition,
    bytes: &[u8],
    _timeout_ms: u64,
) -> Result<PluginExecutionOutput, String> {
    let mut child = Command::new(&plugin.manifest.command)
        .args(&plugin.manifest.args)
        .current_dir(&plugin.directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start plugin {} ({}): {error}",
                plugin.manifest.name, plugin.manifest.id
            )
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(bytes)
            .map_err(|error| format!("failed to write plugin stdin: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for plugin {}: {error}", plugin.manifest.id))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        let stderr_suffix = if stderr.is_empty() {
            String::new()
        } else {
            format!(": {stderr}")
        };
        return Err(format!(
            "plugin {} failed with exit code {}{}",
            plugin.manifest.name, code, stderr_suffix
        ));
    }

    Ok(PluginExecutionOutput { stdout, stderr })
}

fn validate_manifest(manifest: &ParserPluginManifest, manifest_path: &Path) -> Result<(), String> {
    if manifest.id.trim().is_empty() {
        return Err(format!("{}: id must not be empty", manifest_path.display()));
    }
    if manifest.name.trim().is_empty() {
        return Err(format!(
            "{}: name must not be empty",
            manifest_path.display()
        ));
    }
    if manifest.command.trim().is_empty() {
        return Err(format!(
            "{}: command must not be empty",
            manifest_path.display()
        ));
    }

    Ok(())
}
