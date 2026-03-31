use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

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
pub struct PluginDiscoveryWarning {
    pub manifest_path: PathBuf,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct PluginDiscoveryReport {
    pub plugins: Vec<ParserPluginDefinition>,
    pub warnings: Vec<PluginDiscoveryWarning>,
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
    Ok(discover_plugins_with_diagnostics(root)?.plugins)
}

pub fn discover_plugins_with_diagnostics(root: &Path) -> Result<PluginDiscoveryReport, String> {
    if !root.exists() {
        return Ok(PluginDiscoveryReport {
            plugins: Vec::new(),
            warnings: Vec::new(),
        });
    }

    let mut definitions = Vec::new();
    let mut warnings = Vec::new();
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
            Err(error) => {
                warnings.push(PluginDiscoveryWarning {
                    manifest_path: manifest_path.clone(),
                    message: format!("failed to read manifest: {error}"),
                });
                continue;
            }
        };
        let manifest: ParserPluginManifest = match serde_json::from_str(&raw_manifest) {
            Ok(manifest) => manifest,
            Err(error) => {
                warnings.push(PluginDiscoveryWarning {
                    manifest_path: manifest_path.clone(),
                    message: format!("failed to parse manifest JSON: {error}"),
                });
                continue;
            }
        };

        if !manifest.enabled {
            continue;
        }

        if let Err(error) = validate_manifest(&manifest, &manifest_path) {
            warnings.push(PluginDiscoveryWarning {
                manifest_path: manifest_path.clone(),
                message: error,
            });
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
    Ok(PluginDiscoveryReport {
        plugins: definitions,
        warnings,
    })
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
    timeout_ms: u64,
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

    let stdout_handle = child
        .stdout
        .take()
        .ok_or_else(|| format!("failed to capture stdout for plugin {}", plugin.manifest.id))?;
    let stderr_handle = child
        .stderr
        .take()
        .ok_or_else(|| format!("failed to capture stderr for plugin {}", plugin.manifest.id))?;

    let stdout_reader = thread::spawn(move || read_pipe(stdout_handle));
    let stderr_reader = thread::spawn(move || read_pipe(stderr_handle));

    let start = Instant::now();
    let status = loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to wait for plugin {}: {error}", plugin.manifest.id))?
        {
            Some(status) => break status,
            None if start.elapsed() >= Duration::from_millis(timeout_ms) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_reader(stdout_reader, "stdout")?;
                let stderr = join_reader(stderr_reader, "stderr")?.trim().to_string();
                let stderr_suffix = if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                };
                return Err(format!(
                    "plugin {} timed out after {} ms{}",
                    plugin.manifest.name, timeout_ms, stderr_suffix
                ));
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };

    let stdout = join_reader(stdout_reader, "stdout")?;
    let stderr = join_reader(stderr_reader, "stderr")?.trim().to_string();

    if !status.success() {
        let code = status.code().unwrap_or(-1);
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

fn read_pipe<R: Read>(mut reader: R) -> Result<String, String> {
    let mut buffer = Vec::new();
    reader
        .read_to_end(&mut buffer)
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

fn join_reader(
    handle: thread::JoinHandle<Result<String, String>>,
    stream_name: &str,
) -> Result<String, String> {
    handle
        .join()
        .map_err(|_| format!("failed to join plugin {stream_name} reader thread"))?
        .map_err(|error| format!("failed to read plugin {stream_name}: {error}"))
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
