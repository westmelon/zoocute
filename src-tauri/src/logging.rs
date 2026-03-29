use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::domain::ZkLogEntry;

pub struct ZkLogStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl ZkLogStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// Append a log entry. Silently ignores write failures so the business
    /// operation is never blocked by logging issues.
    pub fn append(&self, entry: &ZkLogEntry) {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) else {
            return;
        };
        if let Ok(line) = serde_json::to_string(entry) {
            let _ = writeln!(file, "{line}");
        }
    }

    /// Read the most recent `limit` entries. Returns newest-first.
    /// Corrupted lines are silently skipped.
    pub fn read_recent(&self, limit: usize) -> Result<Vec<ZkLogEntry>, String> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let file = File::open(&self.path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let mut entries: Vec<ZkLogEntry> = reader
            .lines()
            .filter_map(|line| {
                let line = line.ok()?;
                if line.trim().is_empty() {
                    return None;
                }
                serde_json::from_str(&line).ok()
            })
            .collect();
        entries.reverse();
        entries.truncate(limit);
        Ok(entries)
    }

    /// Truncate the log file. Does not affect active ZooKeeper sessions.
    pub fn clear(&self) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        File::create(&self.path).map_err(|e| e.to_string())?;
        Ok(())
    }
}
