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

/** 由笔记 rel 与其内部引用的相对 src，解析出 vault 内绝对 rel。 */
export function resolveNoteRef(noteRel: string, src: string): string | null {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith("//")) return null;
  const base = src.startsWith("/") ? src.slice(1) : joinRel(dirOf(noteRel), src);
  return base;
}

/** 将 vault rel 转为 privnote://vault/... 显示 URL。 */
export function toAssetUrl(rel: string): string {
  const segs = rel.split("/").filter(Boolean);
  const enc = segs.map((s) => encodeURIComponent(s)).join("/");
  return `privnote://vault/${enc}`;
}

/** 把 src（笔记内部引用）解析为可直接显示的 URL；解析不了返回原值。 */
export function displaySrc(vaultRelToSrc: string | null, raw: string): string {
  if (vaultRelToSrc === null) return raw;
  return toAssetUrl(vaultRelToSrc);
}
