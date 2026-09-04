//! PrivNote Tauri 命令层：把 vault 文件系统能力暴露给前端。
use crate::vault;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub last_vault: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{e}"))?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let p = config_path(&app)?;
    if !p.exists() {
        return Ok(AppConfig::default());
    }
    let data = fs::read_to_string(&p).map_err(|e| format!("读取配置失败：{e}"))?;
    let cfg: AppConfig = serde_json::from_str(&data).unwrap_or_default();
    Ok(cfg)
}

#[tauri::command]
pub fn set_last_vault(app: AppHandle, vault: String) -> Result<(), String> {
    let st = app.state::<crate::protocol::SharedVault>();
    *st.0.lock().unwrap() = Some(vault.clone());
    let p = config_path(&app)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let cfg = AppConfig { last_vault: Some(vault) };
    let data = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&p, data).map_err(|e| format!("保存配置失败：{e}"))
}

#[tauri::command]
pub fn open_vault(app: AppHandle, vault: String) -> Result<vault::TreeNode, String> {
    // 让 privnote:// 图片协议能解析新库
    let st = app.state::<crate::protocol::SharedVault>();
    *st.0.lock().unwrap() = Some(vault.clone());
    vault::list_tree(&vault)
}

#[tauri::command]
pub fn list_tree(vault: String) -> Result<vault::TreeNode, String> {
    vault::list_tree(&vault)
}

#[tauri::command]
pub fn create_note(
    vault: String,
    parent: String,
    name: String,
    content: String,
) -> Result<String, String> {
    vault::create_note(&vault, &parent, &name, &content)
}

#[tauri::command]
pub fn create_folder(vault: String, parent: String, name: String) -> Result<String, String> {
    vault::create_folder(&vault, &parent, &name)
}

#[tauri::command]
pub fn rename_entry(vault: String, rel: String, new_name: String) -> Result<String, String> {
    vault::rename_entry(&vault, &rel, &new_name)
}

#[tauri::command]
pub fn delete_entries(vault: String, rels: Vec<String>) -> Result<(), String> {
    vault::delete_entries(&vault, rels)
}

#[tauri::command]
pub fn read_note(vault: String, rel: String) -> Result<String, String> {
    vault::read_note(&vault, &rel)
}

#[tauri::command]
pub fn write_note(vault: String, rel: String, content: String) -> Result<(), String> {
    vault::write_note(&vault, &rel, &content)
}

#[tauri::command]
pub fn import_files(
    vault: String,
    parent: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    vault::import_files(&vault, &parent, paths)
}

#[tauri::command]
pub fn save_image(
    vault: String,
    note_rel: String,
    file_name: String,
    data: String,
) -> Result<String, String> {
    vault::save_image(&vault, &note_rel, &file_name, &data)
}

#[tauri::command]
pub fn import_image_file(
    vault: String,
    note_rel: String,
    abs_path: String,
) -> Result<String, String> {
    vault::save_image_from_file(&vault, &note_rel, &abs_path)
}

#[tauri::command]
pub fn search(vault: String, query: String) -> Result<Vec<vault::SearchHit>, String> {
    vault::search(&vault, &query)
}

#[tauri::command]
pub fn backlinks(vault: String, note_rel: String) -> Result<Vec<vault::Backlink>, String> {
    vault::backlinks(&vault, &note_rel)
}

#[tauri::command]
pub fn list_notes(vault: String) -> Result<Vec<vault::NoteRef>, String> {
    vault::list_notes(&vault)
}

#[tauri::command]
pub fn reveal_in_explorer(vault: String, rel: String) -> Result<(), String> {
    let p = vault::resolve(&vault, &rel)?;
    let abs = p.canonicalize().map_err(|e| format!("无法定位文件：{e}"))?;
    if !abs.exists() {
        return Err("文件不存在".into());
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", abs.display()))
        .spawn()
        .map_err(|e| format!("打开资源管理器失败：{e}"))?;
    Ok(())
}
