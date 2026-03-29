use zoocute_lib::zk_core::interpreter::{interpret_data, DataKind};

#[test]
fn marks_json_as_editable() {
    let result = interpret_data(br#"{"gray_release":true}"#);
    assert_eq!(result.kind, DataKind::Json);
    assert!(result.editable);
}

#[test]
fn marks_plain_text_as_editable() {
    let result = interpret_data(b"hello world");
    assert_eq!(result.kind, DataKind::Text);
    assert!(result.editable);
}

#[test]
fn marks_binary_as_readonly() {
    let result = interpret_data(&[0x00, 0x01, 0x02, 0xFF, 0xFE]);
    assert_eq!(result.kind, DataKind::Binary);
    assert!(!result.editable);
}

#[test]
fn marks_empty_data_as_text_editable() {
    let result = interpret_data(b"");
    assert!(result.editable);
}

#[test]
fn marks_base64_as_cautious() {
    // base64-encoded content should be cautious mode
    let b64 = b"SGVsbG8gV29ybGQ=";
    let result = interpret_data(b64);
    assert_eq!(result.kind, DataKind::Cautious);
    assert!(!result.editable);
}

#[test]
fn json_display_label_is_human_readable() {
    let result = interpret_data(br#"{"key":"value"}"#);
    assert!(result.display_mode_label.contains("JSON"));
}

#[test]
fn text_display_label_is_human_readable() {
    let result = interpret_data(b"plain text content");
    assert!(result.display_mode_label.contains("文本") || result.display_mode_label.contains("Text"));
}

#[test]
fn binary_display_label_is_human_readable() {
    let result = interpret_data(&[0xDE, 0xAD, 0xBE, 0xEF]);
    assert!(result.display_mode_label.contains("二进制") || result.display_mode_label.contains("Binary"));
}

#[test]
fn cautious_display_label_is_human_readable() {
    let base64_bytes = b"SGVsbG8gV29ybGQ="; // "Hello World" in base64
    let result = interpret_data(base64_bytes);
    assert_eq!(result.display_mode_label, "格式数据 · 只读");
}
