pub mod commands;
pub mod domain;
pub mod logging;
pub mod parser_plugins;
pub mod zk_core;

use commands::{
    choose_plugin_directory, clear_zk_logs, connect_server, create_node, delete_node,
    disconnect_server, get_app_settings, get_effective_plugin_directory, get_node_details,
    get_tree_snapshot, list_children, list_parser_plugins, load_full_tree, open_plugin_directory,
    read_zk_logs, reset_plugin_directory, run_parser_plugin, save_node, set_theme_preference,
    set_write_mode, AppState,
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
            get_tree_snapshot,
            save_node,
            create_node,
            delete_node,
            load_full_tree,
            read_zk_logs,
            clear_zk_logs,
            get_app_settings,
            set_theme_preference,
            set_write_mode,
            choose_plugin_directory,
            reset_plugin_directory,
            get_effective_plugin_directory,
            open_plugin_directory,
            list_parser_plugins,
            run_parser_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
