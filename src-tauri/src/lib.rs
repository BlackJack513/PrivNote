mod commands;
mod protocol;
mod vault;
mod web;

use protocol::SharedVault;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared = Arc::new(Mutex::new(None::<String>));

    tauri::Builder::default()
        .manage(SharedVault(shared.clone()))
        .register_uri_scheme_protocol("privnote", move |_webview, request| {
            let path = request.uri().path().to_string();
            protocol::serve(&shared, &path)
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_last_vault,
            commands::ai_get_settings,
            commands::ai_set_settings,
            commands::ai_chat,
            commands::open_vault,
            commands::list_tree,
            commands::create_note,
            commands::create_folder,
            commands::rename_entry,
            commands::delete_entries,
            commands::read_note,
            commands::write_note,
            commands::import_files,
            commands::save_image,
            commands::import_image_file,
            commands::resolve_asset,
            commands::search,
            commands::backlinks,
            commands::list_notes,
            commands::reveal_in_explorer,
            commands::web_fetch,
            commands::web_search
        ])
        .setup(|app| {
            // 记录上次使用的 vault，便于协议处理器读取
            let cfg = commands::get_config(app.handle().clone()).unwrap_or_default();
            if let Some(v) = cfg.last_vault {
                let st = app.handle().state::<SharedVault>();
                *st.0.lock().unwrap() = Some(v);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
