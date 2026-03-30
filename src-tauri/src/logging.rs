use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::domain::ZkLogEntry;

pub struct ZkLogStore {
    path: PathBuf,
    lock: Mutex<()>,
    recent: Mutex<VecDeque<ZkLogEntry>>,
}

const RECENT_CACHE_LIMIT: usize = 1000;

impl ZkLogStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
            recent: Mutex::new(VecDeque::new()),
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
            self.push_recent(entry.clone());
        }
    }

    pub fn append_operation(
        &self,
        connection_id: Option<&str>,
        operation: &str,
        path: Option<&str>,
        success: bool,
        message: &str,
        error: Option<String>,
        meta: Option<serde_json::Value>,
    ) {
        self.append(&ZkLogEntry {
            timestamp: current_millis(),
            level: if success { "DEBUG".into() } else { "ERROR".into() },
            connection_id: connection_id.map(|value| value.to_string()),
            operation: operation.to_string(),
            path: path.map(|value| value.to_string()),
            success,
            duration_ms: 0,
            message: message.to_string(),
            error,
            meta,
        });
    }

    /// Read the most recent `limit` entries. Returns newest-first.
    /// Corrupted lines are silently skipped.
    pub fn read_recent(&self, limit: usize) -> Result<Vec<ZkLogEntry>, String> {
        {
            let recent = self.recent.lock().unwrap_or_else(|e| e.into_inner());
            if !recent.is_empty() {
                return Ok(recent.iter().rev().take(limit).cloned().collect());
            }
        }
        let loaded = self.load_recent_from_disk(limit.max(RECENT_CACHE_LIMIT))?;
        {
            let mut recent = self.recent.lock().unwrap_or_else(|e| e.into_inner());
            *recent = loaded.iter().cloned().collect();
        }
        Ok(loaded.into_iter().rev().take(limit).collect())
    }

    /// Truncate the log file. Does not affect active ZooKeeper sessions.
    pub fn clear(&self) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        File::create(&self.path).map_err(|e| e.to_string())?;
        self.recent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        Ok(())
    }

    fn push_recent(&self, entry: ZkLogEntry) {
        let mut recent = self.recent.lock().unwrap_or_else(|e| e.into_inner());
        recent.push_back(entry);
        while recent.len() > RECENT_CACHE_LIMIT {
            recent.pop_front();
        }
    }

    fn load_recent_from_disk(&self, limit: usize) -> Result<VecDeque<ZkLogEntry>, String> {
        if !self.path.exists() {
            return Ok(VecDeque::new());
        }
        let file = File::open(&self.path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let mut entries = VecDeque::new();
        for line in reader.lines() {
            let Ok(line) = line else { continue };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<ZkLogEntry>(&line) else {
                continue;
            };
            entries.push_back(entry);
            while entries.len() > limit {
                entries.pop_front();
            }
        }
        Ok(entries)
    }
}

fn current_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::ZkLogStore;
    use crate::domain::ZkLogEntry;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    fn temp_log_path() -> PathBuf {
        let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        std::env::temp_dir().join(format!("zoocute-log-test-{millis}-{unique}.jsonl"))
    }

    fn sample_entry(seq: i64) -> ZkLogEntry {
        ZkLogEntry {
            timestamp: seq,
            level: "DEBUG".into(),
            connection_id: Some("local".into()),
            operation: format!("op-{seq}"),
            path: Some(format!("/node/{seq}")),
            success: true,
            duration_ms: 1,
            message: format!("message-{seq}"),
            error: None,
            meta: None,
        }
    }

    #[test]
    fn read_recent_uses_in_memory_recent_cache_for_current_process_entries() {
        let path = temp_log_path();
        let store = ZkLogStore::new(path.clone());
        store.append(&sample_entry(1));
        store.append(&sample_entry(2));

        fs::remove_file(&path).expect("remove temp log file");

        let recent = store.read_recent(10).expect("read recent logs");
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].operation, "op-2");
        assert_eq!(recent[1].operation, "op-1");
    }

    #[test]
    fn read_recent_falls_back_to_disk_for_new_store_instances() {
        let path = temp_log_path();
        let store = ZkLogStore::new(path.clone());
        store.append(&sample_entry(1));
        store.append(&sample_entry(2));

        let fresh_store = ZkLogStore::new(path.clone());
        let recent = fresh_store.read_recent(1).expect("read persisted logs");
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].operation, "op-2");

        let _ = fs::remove_file(path);
    }
}
