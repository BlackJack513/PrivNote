//! PrivNote Tauri 命令层：把 vault 文件系统能力暴露给前端。
use crate::vault;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub last_vault: Option<String>,
    #[serde(default)]
    pub ai: AiConfig,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub base_url: String,
    pub model: String,
    pub api_key_set: bool,
}

pub const DEFAULT_AI_BASE: &str = "https://api.deepseek.com";
pub const DEFAULT_AI_MODEL: &str = "deepseek-chat";

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{e}"))?;
    Ok(dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> AppConfig {
    let p = match config_path(app) {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    if !p.exists() {
        return AppConfig::default();
    }
    let data = match fs::read_to_string(&p) {
        Ok(d) => d,
        Err(_) => return AppConfig::default(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let p = config_path(app)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let data = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&p, data).map_err(|e| format!("保存配置失败：{e}"))
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    Ok(load_config(&app))
}

#[tauri::command]
pub fn set_last_vault(app: AppHandle, vault: String) -> Result<(), String> {
    let st = app.state::<crate::protocol::SharedVault>();
    *st.0.lock().unwrap() = Some(vault.clone());
    let mut cfg = load_config(&app);
    cfg.last_vault = Some(vault);
    save_config(&app, &cfg)
}

/// 返回 AI 设置视图（不回传已保存的密钥原文）。
#[tauri::command]
pub fn ai_get_settings(app: AppHandle) -> Result<AiSettingsView, String> {
    let cfg = load_config(&app);
    let base = cfg
        .ai
        .base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AI_BASE.to_string());
    let model = cfg
        .ai
        .model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AI_MODEL.to_string());
    let api_key_set = cfg
        .ai
        .api_key
        .as_ref()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    Ok(AiSettingsView { base_url: base, model, api_key_set })
}

/// 保存 AI 设置。api_key 传 Some(值) 表示设置/覆盖，Some("") 表示清除，None 表示保持不变。
#[tauri::command]
pub fn ai_set_settings(
    app: AppHandle,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    let mut cfg = load_config(&app);
    if let Some(b) = base_url {
        let t = b.trim().trim_end_matches('/').to_string();
        cfg.ai.base_url = if t.is_empty() { None } else { Some(t) };
    }
    if let Some(m) = model {
        let t = m.trim().to_string();
        cfg.ai.model = if t.is_empty() { None } else { Some(t) };
    }
    if let Some(k) = api_key {
        let t = k.trim().to_string();
        cfg.ai.api_key = if t.is_empty() { None } else { Some(t) };
    }
    save_config(&app, &cfg)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// 由 Rust 侧代理调用 OpenAI 兼容的 /chat/completions（API Key 不暴露给前端）。
#[tauri::command]
pub async fn ai_chat(app: AppHandle, messages: Vec<ChatMsg>) -> Result<String, String> {
    let cfg = load_config(&app);
    let base = cfg
        .ai
        .base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AI_BASE.to_string())
        .trim_end_matches('/')
        .to_string();
    let model = cfg
        .ai
        .model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AI_MODEL.to_string());
    let key = cfg
        .ai
        .api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or("尚未配置 AI API Key，请先在设置里填写")?;

    if messages.is_empty() {
        return Err("消息为空".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .map_err(|e| format!("创建网络客户端失败：{e}"))?;

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "temperature": 0.7,
    });

    let resp = client
        .post(format!("{base}/chat/completions"))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 AI 服务失败：{e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败：{e}"))?;

    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(format!("AI 服务返回 {status}: {detail}"));
    }

    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败：{e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or("AI 返回内容为空，请重试")?;
    Ok(content)
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
