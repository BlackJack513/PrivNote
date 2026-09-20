//! Vault 文件系统操作：目录树、笔记 CRUD、导入、图片、搜索、反向链接。
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const MD_EXTS: [&str; 2] = ["md", "markdown"];
const IMG_EXTS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"];
const SKIP_DIRS: [&str; 5] = [".git", "node_modules", "target", "dist", ".svn"];

// ---------- 基础工具 ----------

/// 清洗用户输入的名称，禁止路径分隔符与危险字符。
pub fn sanitize_name(raw: &str) -> Option<String> {
    let mut s = String::new();
    for ch in raw.trim().chars() {
        let c = ch as u32;
        if c < 32
            || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0')
        {
            continue;
        }
        s.push(ch);
    }
    if s.is_empty() || s == "." || s == ".." || s.ends_with('.') {
        None
    } else {
        Some(s)
    }
}

/// 将相对路径拆成组件；拒绝向上越界。
pub fn split_rel(rel: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for seg in rel.split(['/', '\\']) {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("非法路径：不允许使用 ..".into());
        }
        out.push(seg.to_string());
    }
    Ok(out)
}

/// 由 vault 根目录 + 相对路径得到受保护的绝对路径。
pub fn resolve(vault: &str, rel: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(vault).map_err(|e| format!("无法访问笔记库目录：{e}"))?;
    if !root.is_dir() {
        return Err("笔记库路径不是文件夹".into());
    }
    let mut p = root.clone();
    for seg in split_rel(rel)? {
        p.push(seg);
    }
    // 防御：确保解析结果仍在根目录内
    let canon = p.canonicalize().map_err(|_| ());
    if let Ok(c) = canon {
        if !c.starts_with(&root) {
            return Err("路径越界".into());
        }
    } else {
        // 目标不存在时校验父目录
        let parent = p.parent().ok_or("路径无效")?;
        let cparent = fs::canonicalize(parent).map_err(|e| format!("父目录不存在：{e}"))?;
        if !cparent.starts_with(&root) {
            return Err("路径越界".into());
        }
    }
    Ok(p)
}

/// 确保 vault 根目录存在并返回其规范化路径。
pub fn ensure_vault(vault: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(vault);
    if !p.exists() {
        fs::create_dir_all(&p).map_err(|e| format!("无法创建笔记库目录：{e}"))?;
    }
    let canon = fs::canonicalize(&p).map_err(|e| format!("无法访问笔记库目录：{e}"))?;
    if !canon.is_dir() {
        return Err("笔记库路径不是文件夹".into());
    }
    Ok(canon)
}

fn is_md_path(p: &Path) -> bool {
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) => MD_EXTS.contains(&e.to_ascii_lowercase().as_str()),
        None => false,
    }
}

fn path_to_rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default()
}

// ---------- 目录树 ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

fn should_skip_file(name: &str) -> bool {
    name.starts_with('.')
}

fn walk(root: &Path, dir: &Path, base_rel: &str) -> Result<Vec<TreeNode>, String> {
    let mut dirs: Vec<(String, PathBuf, String)> = Vec::new();
    let mut files: Vec<(String, PathBuf, String)> = Vec::new();

    let rd = fs::read_dir(dir).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let p = entry.path();
        let rel = if base_rel.is_empty() {
            name.clone()
        } else {
            format!("{base_rel}/{name}")
        };
        if p.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            dirs.push((name, p, rel));
        } else {
            if should_skip_file(&name) {
                continue;
            }
            files.push((name, p, rel));
        }
    }

    let mut cmp = |a: &(String, PathBuf, String), b: &(String, PathBuf, String)| {
        a.0.to_lowercase().cmp(&b.0.to_lowercase())
    };
    dirs.sort_by(&mut cmp);
    files.sort_by(&mut cmp);

    let mut nodes: Vec<TreeNode> = Vec::new();
    for (name, p, rel) in dirs {
        let children = walk(root, &p, &rel)?;
        nodes.push(TreeNode {
            name,
            rel,
            is_dir: true,
            children,
        });
    }
    for (name, _p, rel) in files {
        nodes.push(TreeNode {
            name,
            rel,
            is_dir: false,
            children: Vec::new(),
        });
    }
    Ok(nodes)
}

pub fn list_tree(vault: &str) -> Result<TreeNode, String> {
    let root = ensure_vault(vault)?;
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "笔记库".into());
    let children = walk(&root, &root, "")?;
    Ok(TreeNode {
        name,
        rel: String::new(),
        is_dir: true,
        children,
    })
}

// ---------- 笔记 / 文件夹 操作 ----------

fn ext_of(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
}

pub fn create_note(vault: &str, parent_rel: &str, name_raw: &str, content: &str) -> Result<String, String> {
    let name = sanitize_name(name_raw).ok_or("文件名不合法")?;
    let mut fname = name.clone();
    match ext_of(&fname) {
        Some(e) if MD_EXTS.contains(&e.as_str()) => {}
        _ => fname.push_str(".md"),
    }
    let parent = resolve(vault, parent_rel)?;
    let target = parent.join(&fname);
    if target.exists() {
        return Err(format!("「{fname}」已存在"));
    }
    let abs = fs::canonicalize(&parent).map_err(|e| e.to_string())?;
    let root = ensure_vault(vault)?;
    let _ = abs; // 防御由 resolve 完成
    let rel = if parent_rel.is_empty() {
        fname.clone()
    } else {
        format!("{parent_rel}/{fname}")
    };
    let _ = root;
    fs::write(&target, content).map_err(|e| format!("写入失败：{e}"))?;
    Ok(rel)
}

pub fn create_folder(vault: &str, parent_rel: &str, name_raw: &str) -> Result<String, String> {
    let name = sanitize_name(name_raw).ok_or("文件夹名不合法")?;
    let parent = resolve(vault, parent_rel)?;
    let target = parent.join(&name);
    if target.exists() {
        return Err(format!("「{name}」已存在"));
    }
    fs::create_dir(&target).map_err(|e| format!("创建失败：{e}"))?;
    Ok(if parent_rel.is_empty() {
        name.clone()
    } else {
        format!("{parent_rel}/{name}")
    })
}

pub fn rename_entry(vault: &str, rel: &str, new_name_raw: &str) -> Result<String, String> {
    let old = resolve(vault, rel)?;
    if !old.exists() {
        return Err("原文件不存在".into());
    }
    let new_name = sanitize_name(new_name_raw).ok_or("新名称不合法")?;
    let parent = old.parent().ok_or("路径无效")?;
    let is_file = old.is_file();

    let mut final_name = new_name;
    if is_file {
        let old_ext = ext_of(rel).unwrap_or_default();
        // 若用户输入的名称不带扩展名，则保留原扩展名
        if !old_ext.is_empty() && ext_of(&final_name).is_none() {
            final_name.push('.');
            final_name.push_str(&old_ext);
        }
    }
    let target = parent.join(&final_name);
    if target.exists() {
        return Err(format!("「{final_name}」已存在"));
    }
    fs::rename(&old, &target).map_err(|e| format!("重命名失败：{e}"))?;

    // 返回新的相对路径
    let root = ensure_vault(vault)?;
    let rel_of = |p: &Path| path_to_rel(&root, p);
    let new_abs = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    Ok(rel_of(&new_abs))
}

pub fn delete_entries(vault: &str, rels: Vec<String>) -> Result<(), String> {
    for rel in rels {
        let p = resolve(vault, &rel)?;
        if !p.exists() {
            continue;
        }
        let res = trash::delete(&p);
        if res.is_err() {
            // 回收站失败时退回永久删除
            if p.is_dir() {
                fs::remove_dir_all(&p).map_err(|e| format!("删除失败：{e}"))?;
            } else {
                fs::remove_file(&p).map_err(|e| format!("删除失败：{e}"))?;
            }
        }
    }
    Ok(())
}

pub fn read_note(vault: &str, rel: &str) -> Result<String, String> {
    let p = resolve(vault, rel)?;
    if !p.is_file() {
        return Err("文件不存在".into());
    }
    if !is_md_path(&p) {
        return Err("仅支持打开 Markdown 笔记".into());
    }
    let data = fs::read(&p).map_err(|e| format!("读取失败：{e}"))?;
    if data.len() > 8 * 1024 * 1024 {
        return Err("笔记超过 8MB，暂不支持打开".into());
    }
    String::from_utf8(data).map_err(|_| "笔记不是有效的 UTF-8 文本".into())
}

pub fn write_note(vault: &str, rel: &str, content: &str) -> Result<(), String> {
    let p = resolve(vault, rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    fs::write(&p, content).map_err(|e| format!("写入失败：{e}"))
}

pub fn import_files(vault: &str, parent_rel: &str, abs_paths: Vec<String>) -> Result<Vec<String>, String> {
    let parent = resolve(vault, parent_rel)?;
    let root = ensure_vault(vault)?;
    let mut imported = Vec::new();
    for src in abs_paths {
        let src_path = PathBuf::from(&src);
        if !src_path.is_file() {
            continue;
        }
        let Some(fname) = src_path.file_name().map(|s| s.to_string_lossy().into_owned()) else {
            continue;
        };
        if !is_md_path(&src_path) {
            continue;
        }
        // 重名自动加后缀
        let mut target = parent.join(&fname);
        let mut n = 1;
        while target.exists() {
            let stem = src_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let ext = ext_of(&fname).unwrap_or_else(|| "md".into());
            let mut next = format!("{stem} ({n}).{ext}");
            // 防文件名过长
            if next.len() > 120 {
                next = format!("{stem:.60} ({n}).{ext}");
            }
            target = parent.join(&next);
            n += 1;
        }
        fs::copy(&src_path, &target).map_err(|e| format!("导入失败：{e}"))?;
        let rel = path_to_rel(&root, &target);
        imported.push(rel);
    }
    Ok(imported)
}

// ---------- 图片保存 ----------

pub fn save_image(vault: &str, note_rel: &str, filename_raw: &str, data_b64: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    // 1. 解码
    let bytes = B64
        .decode(data_b64)
        .map_err(|_| "图片数据解码失败")?;
    if bytes.is_empty() {
        return Err("图片数据为空".into());
    }
    if bytes.len() > 30 * 1024 * 1024 {
        return Err("图片超过 30MB".into());
    }

    // 2. 确定扩展名
    let ext = ext_of(filename_raw)
        .filter(|e| IMG_EXTS.contains(&e.as_str()))
        .unwrap_or_else(|| "png".into());
    let stem_raw = Path::new(filename_raw)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".into());
    let stem: String = sanitize_name(&stem_raw)
        .unwrap_or_else(|| "image".into())
        .chars()
        .take(60)
        .collect();
    let stem = if stem.is_empty() { "image".into() } else { stem };

    // 3. 写入 <vault>/assets/<ts>-<stem>.<ext>
    let root = ensure_vault(vault)?;
    let assets = root.join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("无法创建 assets 目录：{e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut name = format!("{now}-{stem}.{ext}");
    let mut target = assets.join(&name);
    let mut n = 1u64;
    while target.exists() {
        name = format!("{now}-{stem}-{n}.{ext}");
        target = assets.join(&name);
        n += 1;
    }
    fs::write(&target, &bytes).map_err(|e| format!("保存图片失败：{e}"))?;

    // 4. 计算相对笔记目录的引用路径
    let asset_rel = format!("assets/{name}");
    let rel_from_note = relative_to_note(note_rel, &asset_rel)?;
    Ok(rel_from_note)
}

/// 由笔记相对路径计算目标相对路径在笔记“所在目录”视角下的相对引用。
pub fn relative_to_note(note_rel: &str, target_rel: &str) -> Result<String, String> {
    let note_dir = note_rel
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default();
    let note_parts = split_rel(&note_dir)?;
    let target_parts = split_rel(target_rel)?;

    let common = note_parts
        .iter()
        .zip(target_parts.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let mut out: Vec<String> = Vec::new();
    for _ in common..note_parts.len() {
        out.push("..".into());
    }
    for seg in &target_parts[common..] {
        out.push(seg.clone());
    }
    if out.is_empty() {
        return Err("路径计算失败".into());
    }
    Ok(out.join("/"))
}

/// 将磁盘上已存在的图片文件复制进 <vault>/assets 并返回相对笔记目录的引用路径。
pub fn save_image_from_file(vault: &str, note_rel: &str, abs_path: &str) -> Result<String, String> {
    let src_path = PathBuf::from(abs_path);
    if !src_path.is_file() {
        return Err("图片文件不存在".into());
    }
    let Some(fname) = src_path.file_name().map(|s| s.to_string_lossy().into_owned()) else {
        return Err("文件名无效".into());
    };
    let ext = ext_of(&fname).filter(|e| IMG_EXTS.contains(&e.as_str()));
    let Some(ext) = ext else {
        return Err("不支持的图片格式".into());
    };
    let stem_raw = Path::new(&fname)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".into());
    let stem: String = sanitize_name(&stem_raw)
        .unwrap_or_else(|| "image".into())
        .chars()
        .take(60)
        .collect();
    let stem = if stem.is_empty() { "image".into() } else { stem };

    let root = ensure_vault(vault)?;
    let assets = root.join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("无法创建 assets 目录：{e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut name = format!("{now}-{stem}.{ext}");
    let mut target = assets.join(&name);
    let mut n = 1u64;
    while target.exists() {
        name = format!("{now}-{stem}-{n}.{ext}");
        target = assets.join(&name);
        n += 1;
    }
    fs::copy(&src_path, &target).map_err(|e| format!("导入图片失败：{e}"))?;

    let asset_rel = format!("assets/{name}");
    relative_to_note(note_rel, &asset_rel)
}

// ---------- 全文搜索 ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LineHit {
    pub num: usize,
    pub text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub rel: String,
    pub name: String,
    pub lines: Vec<LineHit>,
}

pub fn search(vault: &str, query: &str) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root = ensure_vault(vault)?;
    let mut hits: Vec<SearchHit> = Vec::new();

    fn walk_dir(root: &Path, dir: &Path, q: &str, hits: &mut Vec<SearchHit>) -> Result<(), String> {
        let rd = fs::read_dir(dir).map_err(|e| format!("读取目录失败：{e}"))?;
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let p = entry.path();
            if p.is_dir() {
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                walk_dir(root, &p, q, hits)?;
            } else if is_md_path(&p) {
                if hits.len() >= 300 {
                    return Ok(());
                }
                let data = match fs::read(&p) {
                    Ok(d) => d,
                    Err(_) => continue,
                };
                if data.len() > 1024 * 1024 {
                    continue;
                }
                let Ok(text) = String::from_utf8(data) else { continue };
                let mut lines: Vec<LineHit> = Vec::new();
                for (i, line) in text.lines().enumerate() {
                    if line.to_lowercase().contains(q) {
                        lines.push(LineHit { num: i + 1, text: line.trim().to_string() });
                        if lines.len() >= 3 {
                            break;
                        }
                    }
                }
                if !lines.is_empty() {
                    let rel = path_to_rel(root, &p);
                    hits.push(SearchHit { rel, name: name.clone(), lines });
                }
            }
        }
        Ok(())
    }

    walk_dir(&root, &root, &q, &mut hits)?;
    // 文件名也参与排序权重：把命中文件名的放前面
    hits.sort_by_key(|h| {
        let name_hit = h.name.to_lowercase().contains(&q);
        (!name_hit, h.name.to_lowercase())
    });
    Ok(hits)
}

// ---------- 反向链接 / 笔记索引 ----------

fn file_stem_of(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub rel: String,
    pub name: String,
    pub lines: Vec<LineHit>,
}

pub fn backlinks(vault: &str, note_rel: &str) -> Result<Vec<Backlink>, String> {
    let target = file_stem_of(note_rel);
    if target.is_empty() {
        return Ok(Vec::new());
    }
    let needle = format!("[[{}", target.to_lowercase());
    let root = ensure_vault(vault)?;
    let mut out: Vec<Backlink> = Vec::new();

    fn walk_dir(
        root: &Path,
        dir: &Path,
        needle: &str,
        self_rel: &str,
        out: &mut Vec<Backlink>,
    ) -> Result<(), String> {
        let rd = fs::read_dir(dir).map_err(|e| format!("读取目录失败：{e}"))?;
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let p = entry.path();
            if p.is_dir() {
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                walk_dir(root, &p, needle, self_rel, out)?;
            } else if is_md_path(&p) {
                let rel = path_to_rel(root, &p);
                if rel == self_rel {
                    continue;
                }
                let data = match fs::read(&p) {
                    Ok(d) => d,
                    Err(_) => continue,
                };
                if data.len() > 1024 * 1024 {
                    continue;
                }
                let Ok(text) = String::from_utf8(data) else { continue };
                let mut lines: Vec<LineHit> = Vec::new();
                for (i, line) in text.lines().enumerate() {
                    if line.to_lowercase().contains(needle) {
                        lines.push(LineHit { num: i + 1, text: line.trim().to_string() });
                        if lines.len() >= 2 {
                            break;
                        }
                    }
                }
                if !lines.is_empty() {
                    out.push(Backlink { rel, name: name.clone(), lines });
                }
            }
        }
        Ok(())
    }

    walk_dir(&root, &root, &needle, note_rel, &mut out)?;
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub rel: String,
    pub title: String,
}

/// 收集库里所有笔记的标题索引（用于 [[双链]] 提示与跳转）。
pub fn list_notes(vault: &str) -> Result<Vec<NoteRef>, String> {
    let root = ensure_vault(vault)?;
    let mut out: Vec<NoteRef> = Vec::new();
    fn walk_dir(root: &Path, dir: &Path, out: &mut Vec<NoteRef>) -> Result<(), String> {
        let rd = fs::read_dir(dir).map_err(|e| format!("读取目录失败：{e}"))?;
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let p = entry.path();
            if p.is_dir() {
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                walk_dir(root, &p, out)?;
            } else if is_md_path(&p) {
                let rel = path_to_rel(root, &p);
                let title = file_stem_of(&rel);
                out.push(NoteRef { rel, title });
            }
        }
        Ok(())
    }
    walk_dir(&root, &root, &mut out)?;
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

/// 由双链目标（不含 [[]]）寻找已存在的笔记相对路径（前端自行维护索引，暂未使用）。
#[allow(dead_code)]
pub fn find_note_by_title(notes: &[NoteRef], target: &str) -> Option<String> {
    let t = target.trim().to_lowercase();
    notes
        .iter()
        .find(|n| n.title.to_lowercase() == t)
        .map(|n| n.rel.clone())
}

/* ---------------- 图片等资源的引用解析 ---------------- */

fn pct_decode_min(s: &str) -> String {
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

/// 规范化相对路径为组件序列（支持 .. 回退；越界部分自然丢弃）。
fn norm_segments(rel: &str) -> Vec<String> {
    let mut segs: Vec<String> = Vec::new();
    for seg in rel.split(['/', '\\']) {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            segs.pop();
        } else {
            segs.push(seg.to_string());
        }
    }
    segs
}

fn is_external_ref(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("privnote:")
        || lower.starts_with("blob:")
        || s.starts_with("//")
}

fn collect_matching(
    root: &Path,
    dir: &Path,
    base_lower: &str,
    out: &mut Vec<String>,
    depth: usize,
) {
    if depth > 8 || out.len() > 20 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let p = entry.path();
        if p.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            collect_matching(root, &p, base_lower, out, depth + 1);
        } else if name.to_lowercase() == base_lower {
            if let Ok(cp) = fs::canonicalize(&p) {
                if cp.starts_with(root) {
                    out.push(path_to_rel(root, &cp));
                }
            }
        }
    }
}

/// 把笔记里的图片引用（相对路径/裸文件名/带 .. 的路径）解析为库内真实存在的相对路径。
/// 找不到返回 None；外部 URL 直接返回 None（由前端原样使用）。
pub fn resolve_asset(vault: &str, note_rel: &str, src: &str) -> Result<Option<String>, String> {
    let root = ensure_vault(vault)?;
    let raw = src.trim();
    if raw.is_empty() || is_external_ref(raw) {
        return Ok(None);
    }
    let decoded = pct_decode_min(raw);
    let norm = decoded.replace('\\', "/");
    let note_dir = note_rel.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
    let base_name = Path::new(&norm)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    // 依次尝试：笔记同级目录 → 库根目录 → assets/ → 同级 assets/
    let mut cands: Vec<PathBuf> = Vec::new();
    let push_cand = |segs: Vec<String>, cands: &mut Vec<PathBuf>| {
        let mut q = root.clone();
        for s in segs {
            q.push(s);
        }
        if !cands.contains(&q) {
            cands.push(q);
        }
    };
    if norm.starts_with('/') {
        push_cand(norm_segments(&norm), &mut cands);
    } else {
        if !note_dir.is_empty() {
            push_cand(norm_segments(&format!("{note_dir}/{norm}")), &mut cands);
            push_cand(norm_segments(&format!("{note_dir}/assets/{norm}")), &mut cands);
        }
        push_cand(norm_segments(&norm), &mut cands);
        if !base_name.is_empty() {
            push_cand(vec!["assets".into(), base_name.clone()], &mut cands);
        }
    }

    for c in &cands {
        if c.is_file() {
            if let Ok(cp) = fs::canonicalize(c) {
                if cp.starts_with(&root) {
                    return Ok(Some(path_to_rel(&root, &cp)));
                }
            }
        }
    }

    // 最后兜底：全库搜索唯一同名文件（优先 assets/、其次路径最短）
    if !base_name.is_empty() {
        let mut hits: Vec<String> = Vec::new();
        collect_matching(&root, &root, &base_name.to_lowercase(), &mut hits, 0);
        if !hits.is_empty() {
            hits.sort_by_key(|r| {
                (
                    if r.starts_with("assets/") { 0 } else { 1 },
                    r.len(),
                    r.clone(),
                )
            });
            return Ok(Some(hits.remove(0)));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_vault(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("pn-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(p.join("assets")).unwrap();
        fs::create_dir_all(p.join("notes/react")).unwrap();
        fs::write(p.join("assets").join("pic.png"), b"x").unwrap();
        fs::write(p.join("notes/react").join("local.png"), b"x").unwrap();
        fs::write(p.join("notes/react").join("a.md"), b"# a").unwrap();
        p
    }

    #[test]
    fn resolve_asset_variants() {
        let v = tmp_vault("resolve");
        let vault = v.to_string_lossy().into_owned();

        // 裸文件名 → assets/
        assert_eq!(
            resolve_asset(&vault, "root.md", "pic.png").unwrap(),
            Some("assets/pic.png".into())
        );
        // assets/ 前缀
        assert_eq!(
            resolve_asset(&vault, "root.md", "assets/pic.png").unwrap(),
            Some("assets/pic.png".into())
        );
        // 子目录笔记的同级文件
        assert_eq!(
            resolve_asset(&vault, "notes/react/a.md", "local.png").unwrap(),
            Some("notes/react/local.png".into())
        );
        // 子目录笔记用 ../ 回到 assets
        assert_eq!(
            resolve_asset(&vault, "notes/react/a.md", "../../assets/pic.png").unwrap(),
            Some("assets/pic.png".into())
        );
        // 反斜杠写法
        assert_eq!(
            resolve_asset(&vault, "root.md", "assets\\pic.png").unwrap(),
            Some("assets/pic.png".into())
        );
        // URL 编码空格/中文（此文件不存在，应回退并在全库找不到 → None）
        assert_eq!(resolve_asset(&vault, "root.md", "nope%20x.png").unwrap(), None);
        // 外部 URL 不处理
        assert_eq!(resolve_asset(&vault, "root.md", "https://a/b.png").unwrap(), None);

        let _ = fs::remove_dir_all(&v);
    }
}
