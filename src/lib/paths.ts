// vault 内相对路径工具（统一使用正斜杠 /，不以前导 / 开头）。

/** 笔记所在目录（"" 表示根目录）。 */
export function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

export function baseName(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? rel : rel.slice(i + 1);
}

/** 去掉 .md/.markdown 扩展名（保留目录部分）。 */
export function stripMdExt(rel: string): string {
  return rel.replace(/\.(md|markdown)$/i, "");
}

/** 库内相对路径转 Windows 风格（反斜杠分隔），用于复制到剪贴板。 */
export function toWindowsRel(rel: string): string {
  return rel.split("/").join("\\");
}

export function extOf(rel: string): string {
  const b = baseName(rel);
  const i = b.lastIndexOf(".");
  return i < 0 ? "" : b.slice(i + 1).toLowerCase();
}

export function isMarkdown(rel: string): boolean {
  const e = extOf(rel);
  return e === "md" || e === "markdown";
}

/** 拼接并规范化相对路径（支持 ../）。 */
export function joinRel(...parts: string[]): string {
  const segs: string[] = [];
  for (const p of parts) {
    for (const s of p.split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") {
        segs.pop();
      } else {
        segs.push(s);
      }
    }
  }
  return segs.join("/");
}

/** 由笔记 rel 与其内部引用的相对 src，解析出 vault 内相对 rel。 */
export function resolveNoteRef(noteRel: string, src: string): string | null {
  const s = src.trim().replace(/\\/g, "/");
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) || s.startsWith("//")) return null;
  return s.startsWith("/") ? s.slice(1) : joinRel(dirOf(noteRel), s);
}

/**
 * 把库内相对路径转成可显示的 URL。
 * 注意：Tauri v2 在 Windows/Android 上把自定义协议服务为 `http://<scheme>.localhost/<path>`，
 * macOS/Linux 才是 `<scheme>://localhost/<path>`；用错形式图片会加载失败。
 */
export function toAssetUrl(rel: string): string {
  const segs = rel
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  const isWindows =
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  return isWindows
    ? `http://privnote.localhost/${segs}`
    : `privnote://localhost/${segs}`;
}

/** 把 src（笔记内部引用）解析为可直接显示的 URL；解析不了返回原值。 */
export function displaySrc(vaultRelToSrc: string | null, raw: string): string {
  if (vaultRelToSrc === null) return raw;
  return toAssetUrl(vaultRelToSrc);
}
