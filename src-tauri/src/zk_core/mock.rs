use std::collections::HashMap;

use crate::domain::{ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto};
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::interpreter::interpret_data;

pub struct MockAdapter {
    children: HashMap<String, Vec<LoadedTreeNodeDto>>,
    nodes: HashMap<String, NodeDetailsDto>,
}

impl MockAdapter {
    fn with_seed_data() -> Self {
        let mut children = HashMap::new();
        children.insert(
            "/".into(),
            vec![
                LoadedTreeNodeDto {
                    path: "/configs".into(),
                    name: "configs".into(),
                    has_children: true,
                },
                LoadedTreeNodeDto {
                    path: "/services".into(),
                    name: "services".into(),
                    has_children: true,
                },
            ],
        );
        children.insert(
            "/services".into(),
            vec![
                LoadedTreeNodeDto {
                    path: "/services/gateway".into(),
                    name: "gateway".into(),
                    has_children: false,
                },
                LoadedTreeNodeDto {
                    path: "/services/session_blob".into(),
                    name: "session_blob".into(),
                    has_children: false,
                },
            ],
        );
        children.insert(
            "/configs".into(),
            vec![LoadedTreeNodeDto {
                path: "/configs/payment".into(),
                name: "payment".into(),
                has_children: true,
            }],
        );
        children.insert(
            "/configs/payment".into(),
            vec![LoadedTreeNodeDto {
                path: "/configs/payment/switches".into(),
                name: "switches".into(),
                has_children: false,
            }],
        );

        let mut nodes = HashMap::new();
        nodes.insert(
            "/configs/payment/switches".into(),
            {
                let raw = b"{\"gray_release\":true}";
                let interp = interpret_data(raw);
                NodeDetailsDto {
                    path: "/configs/payment/switches".into(),
                    value: String::from_utf8_lossy(raw).into_owned(),
                    format_hint: None,
                    data_kind: interp.kind,
                    display_mode_label: interp.display_mode_label,
                    editable: interp.editable,
                    raw_preview: interp.raw_preview,
                    decoded_preview: interp.decoded_preview,
                    version: 18,
                    children_count: 0,
                    updated_at: "2026-03-26 10:00".into(),
                    c_version: 0,
                    acl_version: 0,
                    c_zxid: Some("0x3a".to_string()),
                    m_zxid: Some("0x1a3".to_string()),
                    c_time: 1740826800000,
                    m_time: 1743144842000,
                    data_length: raw.len() as i32,
                    ephemeral: false,
                }
            },
        );
        nodes.insert(
            "/services/gateway".into(),
            {
                let raw = b"gateway_enabled=true";
                let interp = interpret_data(raw);
                NodeDetailsDto {
                    path: "/services/gateway".into(),
                    value: String::from_utf8_lossy(raw).into_owned(),
                    format_hint: Some("text".into()),
                    data_kind: interp.kind,
                    display_mode_label: interp.display_mode_label,
                    editable: interp.editable,
                    raw_preview: interp.raw_preview,
                    decoded_preview: interp.decoded_preview,
                    version: 7,
                    children_count: 0,
                    updated_at: "2026-03-26 09:58".into(),
                    c_version: 0,
                    acl_version: 0,
                    c_zxid: Some("0x2b".to_string()),
                    m_zxid: Some("0xf4".to_string()),
                    c_time: 1740826800000,
                    m_time: 1743144842000,
                    data_length: raw.len() as i32,
                    ephemeral: false,
                }
            },
        );
        nodes.insert(
            "/services/session_blob".into(),
            {
                // Actual binary bytes representing a Java-serialized object (decoded from hex).
                let raw: &[u8] = &[
                    0xAC, 0xED, 0x00, 0x05, 0x73, 0x72, 0x00, 0x12,
                    0x63, 0x6F, 0x6D, 0x2E, 0x65, 0x78, 0x61, 0x6D,
                    0x70, 0x6C, 0x65, 0x2E, 0x53, 0x65, 0x73, 0x73,
                    0x69, 0x6F, 0x6E,
                ];
                let interp = interpret_data(raw);
                NodeDetailsDto {
                    path: "/services/session_blob".into(),
                    value: interp.raw_preview.clone(),
                    format_hint: Some("binary".into()),
                    data_kind: interp.kind,
                    display_mode_label: interp.display_mode_label,
                    editable: interp.editable,
                    raw_preview: interp.raw_preview,
                    decoded_preview: interp.decoded_preview,
                    version: 4,
                    children_count: 0,
                    updated_at: "2026-03-26 09:40".into(),
                    c_version: 0,
                    acl_version: 0,
                    c_zxid: Some("0x11".to_string()),
                    m_zxid: Some("0x6e".to_string()),
                    c_time: 1740826800000,
                    m_time: 1743144842000,
                    data_length: raw.len() as i32,
                    ephemeral: false,
                }
            },
        );

        Self { children, nodes }
    }
}

impl Default for MockAdapter {
    fn default() -> Self {
        Self::with_seed_data()
    }
}

impl ReadOnlyZkAdapter for MockAdapter {
    fn connect(&self, request: ConnectRequestDto) -> Result<ConnectionStatusDto, String> {
        Ok(ConnectionStatusDto {
            connected: true,
            auth_mode: request.auth_mode(),
            auth_succeeded: true,
            message: format!("connected to {}", request.connection_string),
        })
    }

    fn list_children(&self, path: &str) -> Result<Vec<LoadedTreeNodeDto>, String> {
        Ok(self.children.get(path).cloned().unwrap_or_default())
    }

    fn get_node(&self, path: &str) -> Result<NodeDetailsDto, String> {
        self.nodes
            .get(path)
            .cloned()
            .ok_or_else(|| format!("node not found: {path}"))
    }
}
