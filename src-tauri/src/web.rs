//! AI 联网工具：抓取网页正文 + DuckDuckGo 文本搜索（尽力而为，无需额外 Key）。
use serde::Serialize;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn strip_html(html: &str) -> String {
    // 去掉脚本与样式
    let re = regex::Regex::new(r"(?is)<(script|style)[^>]*>.*?</\1>").unwrap();
    let no_block = re.replace_all(html, " ");
    // 去标签
    let re_tag = regex::Regex::new(r"(?s)<[^>]+>").unwrap();
    let text = re_tag.replace_all(&no_block, " ");
    let clean = unescape(&text);
    // 压缩空白
    let re_ws = regex::Regex::new(r"\s+").unwrap();
    re_ws.replace_all(&clean, " ").trim().to_string()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub title: String,
    pub text: String,
    pub url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(UA)
        .build()
        .map_err(|e| format!("创建网络客户端失败：{e}"))
}

/// 抓取网页并抽取标题与正文纯文本。
pub async fn fetch_url(url: &str) -> Result<FetchResult, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持抓取 http(s) 网页".into());
    }
    let c = client()?;
    let resp = c
        .get(url)
        .send()
        .await
        .map_err(|e| format!("抓取失败：{e}"))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取内容失败：{e}"))?;
    if !status.is_success() {
        return Err(format!("网页返回 HTTP {status}"));
    }

    let title = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
        .ok()
        .and_then(|re| re.captures(&body))
        .and_then(|c| c.get(1))
        .map(|m| unescape(&m.as_str()).trim().to_string())
        .unwrap_or_default();

    let mut text = strip_html(&body);
    if text.len() > 60000 {
        text.truncate(60000);
        text.push_str("…（内容过长已截断）");
    }
    if text.is_empty() {
        return Err("该网页没有可读文本（可能是纯 JS 页面）".into());
    }
    Ok(FetchResult { title, text, url: url.to_string() })
}

/// DuckDuckGo 文本搜索。
pub async fn search_web(query: &str) -> Result<Vec<SearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let c = client()?;
    let url = format!("https://html.duckduckgo.com/html/?q={}", urlencoding_encode(q));
    let resp = c
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("搜索失败：{e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取搜索结果失败：{e}"))?;

    let re_a = regex::Regex::new(r#"(?is)class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#).unwrap();
    let re_s = regex::Regex::new(r#"(?is)class="result__snippet"[^>]*>(.*?)</a>"#).unwrap();

    let hrefs: Vec<String> = re_a
        .captures_iter(&body)
        .map(|cap| {
            let raw = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            normalize_ddg_url(&raw)
        })
        .collect();
    let titles: Vec<String> = re_a
        .captures_iter(&body)
        .map(|cap| {
            cap.get(2)
                .map(|m| unescape(&strip_html(m.as_str())).trim().to_string())
                .unwrap_or_default()
        })
        .collect();
    let snippets: Vec<String> = re_s
        .captures_iter(&body)
        .map(|cap| {
            cap.get(1)
                .map(|m| unescape(&strip_html(m.as_str())).trim().to_string())
                .unwrap_or_default()
        })
        .collect();

    let mut out: Vec<SearchResult> = Vec::new();
    for i in 0..hrefs.len() {
        if out.len() >= 6 {
            break;
        }
        if hrefs[i].is_empty() || titles[i].is_empty() {
            continue;
        }
        out.push(SearchResult {
            title: titles[i].clone(),
            url: hrefs[i].clone(),
            snippet: snippets.get(i).cloned().unwrap_or_default(),
        });
    }
    Ok(out)
}

fn urlencoding_encode(s: &str) -> String {
    // 简易百分号编码（保留常用字符）
    let mut out = String::new();
    for b in s.as_bytes() {
        let ch = *b as char;
        if b.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~' | ' ') {
            if ch == ' ' {
                out.push('+');
            } else {
                out.push(ch);
            }
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn normalize_ddg_url(raw: &str) -> String {
    let cleaned = raw.trim();
    if let Some(rest) = cleaned.strip_prefix("//duckduckgo.com/l/?uddg=") {
        let real = pct_decode(rest);
        // 去掉 &rut= 等尾参
        if let Some(idx) = real.find('&') {
            return real[..idx].to_string();
        }
        return real;
    }
    if let Some(rest) = cleaned.strip_prefix("//") {
        return format!("https://{rest}");
    }
    cleaned.to_string()
}
