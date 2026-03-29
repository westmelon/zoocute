use serde::{Deserialize, Serialize};

/// Classification of ZooKeeper node data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataKind {
    /// Valid JSON bytes.
    Json,
    /// Valid UTF-8 text (non-JSON).
    Text,
    /// Recognized transform format (e.g., base64-encoded content, protobuf-like patterns).
    Cautious,
    /// Binary / serialized / unknown bytes.
    Binary,
}

/// Result of interpreting a ZooKeeper node's raw bytes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretResult {
    pub kind: DataKind,
    pub editable: bool,
    pub display_mode_label: String,
    /// Hex-encoded representation of the raw bytes.
    pub raw_preview: String,
    /// UTF-8 string if decodable, otherwise same as `raw_preview`.
    pub decoded_preview: String,
}

/// Hex-encode a byte slice into an uppercase hex string.
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02X}"));
    }
    out
}

/// Interpret raw ZooKeeper node data and classify it.
///
/// Classification rules (in priority order):
/// 1. Valid JSON bytes => `DataKind::Json`, editable
/// 2. Recognized transform format (base64-encoded, protobuf-like) => `DataKind::Cautious`, read-only
/// 3. Valid UTF-8 text (non-JSON) => `DataKind::Text`, editable
/// 4. Binary / serialized / unknown => `DataKind::Binary`, read-only
pub fn interpret_data(data: &[u8]) -> InterpretResult {
    let raw_preview = hex_encode(data);

    // Empty data is treated as editable text.
    if data.is_empty() {
        return InterpretResult {
            kind: DataKind::Text,
            editable: true,
            display_mode_label: "文本 · 可编辑".to_string(),
            raw_preview,
            decoded_preview: String::new(),
        };
    }

    // Try JSON first.
    if let Ok(s) = std::str::from_utf8(data) {
        let trimmed = s.trim();
        let decoded_preview = s.to_string();

        if is_json(trimmed) {
            return InterpretResult {
                kind: DataKind::Json,
                editable: true,
                display_mode_label: "JSON · 可编辑".to_string(),
                raw_preview,
                decoded_preview,
            };
        }

        // Check for cautious patterns in UTF-8 text before treating as plain text.
        if is_cautious_text(trimmed) {
            return InterpretResult {
                kind: DataKind::Cautious,
                editable: false,
                display_mode_label: "格式数据 · 只读".to_string(),
                raw_preview,
                decoded_preview,
            };
        }

        // Plain UTF-8 text.
        return InterpretResult {
            kind: DataKind::Text,
            editable: true,
            display_mode_label: "文本 · 可编辑".to_string(),
            raw_preview,
            decoded_preview,
        };
    }

    // Not valid UTF-8 — binary or serialized data.
    InterpretResult {
        kind: DataKind::Binary,
        editable: false,
        display_mode_label: "二进制 · 只读".to_string(),
        decoded_preview: raw_preview.clone(),
        raw_preview,
    }
}

/// Returns true if the trimmed string is a valid JSON value.
fn is_json(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    // Fast structural check: JSON objects, arrays, strings, numbers, booleans, null.
    let first = s.chars().next().unwrap_or(' ');
    let last = s.chars().last().unwrap_or(' ');
    let structurally_plausible = matches!(
        (first, last),
        ('{', '}') | ('[', ']') | ('"', '"') | ('t', 'e') | ('f', 'e') | ('n', 'l')
    ) || first.is_ascii_digit()
        || first == '-';

    if !structurally_plausible {
        return false;
    }

    serde_json::from_str::<serde_json::Value>(s).is_ok()
}

/// Returns true if the text matches a recognized transform format that
/// should be treated as cautious (read-only) rather than plain editable text.
///
/// Currently detects:
/// - Base64-encoded content (strict base64 alphabet, padded, length ≥ 16 and divisible by 4)
/// - Protobuf-like binary-in-text patterns (high proportion of non-printable lookalikes)
fn is_cautious_text(s: &str) -> bool {
    is_base64(s) || is_protobuf_like(s)
}

/// Heuristic: is the entire string a padded base64-encoded value?
///
/// Criteria:
/// - Only base64 alphabet characters (A-Z, a-z, 0-9, +, /, =)
/// - Length ≥ 16 and divisible by 4 (padded form)
/// - Ends with 0–2 `=` padding chars
/// - Has a mix of upper + lower or digit characters (avoids false-positive on plain words)
fn is_base64(s: &str) -> bool {
    if s.len() < 16 || s.len() % 4 != 0 {
        return false;
    }

    let bytes = s.as_bytes();

    // Count padding at end (max 2).
    let pad_count = bytes.iter().rev().take(2).filter(|&&b| b == b'=').count();

    // All chars must be valid base64 alphabet.
    let data_len = s.len() - pad_count;
    for &b in &bytes[..data_len] {
        if !matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/') {
            return false;
        }
    }

    // Require uppercase letters to be present — real base64 almost always has them.
    // This avoids false-positives on plain lowercase English words followed by digits.
    let has_upper = bytes[..data_len].iter().any(|b| b.is_ascii_uppercase());
    let has_lower = bytes[..data_len].iter().any(|b| b.is_ascii_lowercase());

    // Must have both upper and lower, OR upper plus digits/specials.
    // Pure lowercase + digits (e.g. "helloworld1234") is not treated as base64.
    has_upper && has_lower
}

/// Heuristic: detect protobuf-like binary serialisation encoded as raw bytes
/// that happened to be valid UTF-8 (edge case: Rust's from_utf8 accepted them).
///
/// If more than 20% of the characters are non-printable ASCII (control chars
/// excluding common whitespace), treat as cautious.
fn is_protobuf_like(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let non_printable = s
        .bytes()
        .filter(|&b| b < 0x20 && !matches!(b, b'\n' | b'\r' | b'\t'))
        .count();
    non_printable * 5 > s.len() // > 20%
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_object_recognised() {
        assert!(is_json(r#"{"key": "value"}"#));
    }

    #[test]
    fn plain_text_not_json() {
        assert!(!is_json("hello world"));
    }

    #[test]
    fn base64_detected() {
        assert!(is_base64("SGVsbG8gV29ybGQ="));
    }

    #[test]
    fn short_base64_like_not_detected() {
        assert!(!is_base64("SGVs"));
    }

    #[test]
    fn plain_word_not_base64() {
        assert!(!is_base64("helloworld1234=="));
    }
}
