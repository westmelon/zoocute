import type { ConnectionSummary, NodeDetails, NodeTreeItem } from "./types";

export const connections: ConnectionSummary[] = [
  { id: "prod", name: "production-zk", status: "connected", region: "cn-shanghai" },
  { id: "staging", name: "staging-zk", status: "degraded", region: "cn-hangzhou" }
];

export const favorites = ["/configs/payment/switches", "/services/gateway"];
export const recentPaths = ["/configs/payment/switches", "/services/gateway"];

export const tree: NodeTreeItem[] = [
  {
    path: "/configs",
    name: "configs",
    children: [
      {
        path: "/configs/payment",
        name: "payment",
        children: [
          {
            path: "/configs/payment/switches",
            name: "switches",
            children: [
              { path: "/configs/payment/switches/gray_release", name: "gray_release" },
              { path: "/configs/payment/switches/downgrade_mode", name: "downgrade_mode" }
            ]
          }
        ]
      }
    ]
  },
  {
    path: "/services",
    name: "services",
    children: [
      { path: "/services/gateway", name: "gateway" },
      { path: "/services/session_blob", name: "session_blob" }
    ]
  }
];

export const nodeDetailsByPath: Record<string, NodeDetails> = {
  "/configs/payment/switches": {
    path: "/configs/payment/switches",
    value: `{
  "gray_release": true,
  "downgrade_mode": false,
  "allowed_regions": ["cn", "us"]
}`,
    dataKind: "json",
    displayModeLabel: "JSON · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 18,
    childrenCount: 2,
    updatedAt: "2026-03-25 23:10",
    cVersion: 0,
    aclVersion: 0,
    cZxid: "0x3a",
    mZxid: "0x1a3",
    cTime: 1740826800000,
    mTime: 1743144842000,
    dataLength: 62,
    ephemeral: false,
  },
  "/services/gateway": {
    path: "/services/gateway",
    value: `gateway_enabled=true
rate_limit=240
origin=internal`,
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 7,
    childrenCount: 0,
    updatedAt: "2026-03-25 22:41",
    cVersion: 0,
    aclVersion: 0,
    cZxid: "0x2b",
    mZxid: "0xf4",
    cTime: 1740826800000,
    mTime: 1743144842000,
    dataLength: 42,
    ephemeral: false,
  },
  "/services/session_blob": {
    path: "/services/session_blob",
    value: "ACED000573720012636F6D2E6578616D706C652E53657373696F6E",
    formatHint: "binary",
    dataKind: "binary",
    displayModeLabel: "二进制 · 只读",
    editable: false,
    rawPreview: "ACED000573720012636F6D2E6578616D706C652E53657373696F6E",
    decodedPreview: "ACED000573720012636F6D2E6578616D706C652E53657373696F6E",
    version: 4,
    childrenCount: 0,
    updatedAt: "2026-03-25 20:18",
    cVersion: 0,
    aclVersion: 0,
    cZxid: "0x11",
    mZxid: "0x6e",
    cTime: 1740826800000,
    mTime: 1743144842000,
    dataLength: 27,
    ephemeral: false,
  }
};

export const defaultNodePath = "/configs/payment/switches";
