pub mod commands;
pub mod domain;
pub mod logging;
pub mod zk_core;

use commands::{
    connect_server, disconnect_server,
    create_node, delete_node, get_node_details, list_children, save_node,
    load_full_tree,
    read_zk_logs, clear_zk_logs,
    AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let log_dir = app
                .path()
                .app_data_dir()
                .map(|p| p.join("logs"))
                .unwrap_or_else(|_| std::path::PathBuf::from("logs"));
            let _ = std::fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("zookeeper-debug.jsonl");
            app.manage(AppState::new(log_path, app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_server,
            disconnect_server,
            list_children,
            get_node_details,
            save_node,
            create_node,
            delete_node,
            load_full_tree,
            read_zk_logs,
            clear_zk_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
