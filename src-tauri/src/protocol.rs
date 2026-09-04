//! 自定义 privnote:// 协议：让编辑器/预览能够以图片方式显示 vault 内的文件。
use std::borrow::Cow;
use std::sync::{Arc, Mutex};

/// 当前打开的 vault 根目录（与命令层共享）。
#[derive(Clone, Default)]
pub struct SharedVault(pub Arc<Mutex<Option<String>>>);

fn mime_of(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "css" => "text/css",
        "js" => "text/javascript",
        "json" => "application/json",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn serve(
    shared: &Arc<Mutex<Option<String>>>,
    uri_path: &str,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    let vault = shared.lock().map(|g| g.clone()).unwrap_or(None);
    let Some(root) = vault else {
        return response(404, "application/octet-stream", Vec::new());
    };

    // 形如 /assets/xxx.png
    let decoded = pct_decode(uri_path);
    let mut segs: Vec<String> = Vec::new();
    for seg in decoded.split(['/', '\\']) {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return response(404, "application/octet-stream", Vec::new());
        }
        segs.push(seg.to_string());
    }
    if segs.is_empty() {
        return response(404, "application/octet-stream", Vec::new());
    }

    let mut p = std::path::PathBuf::from(&root);
    for s in &segs {
        p.push(s);
    }
    if !p.is_file() {
        return response(404, "application/octet-stream", Vec::new());
    }
    // 防止符号链接逃逸：校验最终真实路径仍在 vault 内
    if let Ok(cr) = std::fs::canonicalize(&root) {
        if let Ok(cp) = std::fs::canonicalize(&p) {
            if !cp.starts_with(&cr) {
                return response(404, "application/octet-stream", Vec::new());
            }
        }
    }

    let data = match std::fs::read(&p) {
        Ok(d) => d,
        Err(_) => return response(404, "application/octet-stream", Vec::new()),
    };
    let mime = mime_of(&p.to_string_lossy());
    response(200, mime, data)
}

fn response(
    status: u16,
    mime: &str,
    body: Vec<u8>,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-cache")
        .body(Cow::Owned(body))
        .unwrap_or_else(|_| tauri::http::Response::default())
}
