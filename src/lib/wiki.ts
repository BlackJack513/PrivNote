// [[双链]] 文本解析与目标解析（支持完整路径形式，如 [[notes/react/useState]]）。
import type { NoteRef } from "./types";
import { stripMdExt } from "./paths";

export interface WikiToken {
  raw: string; // 双链目标原文（不含括号）
  key: string; // 去掉 |别名/#锚点 后的引用键（可能是完整路径或短标题）
  display: string; // 用于显示的文本
}

const WIKI_RE = /\[\[([^\[\]\n]+?)\]\]/g;

/** 从 markdown 文本中提取所有双链。 */
export function extractWikiLinks(md: string): WikiToken[] {
  const out: WikiToken[] = [];
  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(md))) {
    const raw = m[1].trim();
    if (!raw) continue;
    const parts = raw.split("|");
    const head = parts[0].split("#")[0].trim();
    if (!head) continue;
    const display = parts.length > 1 ? parts[1].trim() : head;
    out.push({ raw, key: head, display });
  }
  return out;
}

/** 依据完整路径 / 标题把双链键解析为存在的笔记相对路径；解析不到返回 null。 */
export function resolveLinkTarget(notes: NoteRef[], key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  const lower = k.toLowerCase();

  // 1) 完整路径匹配（含不带扩展名写法）
  const byRel = notes.find((n) => n.rel === k || stripMdExt(n.rel).toLowerCase() === lower);
  if (byRel) return byRel.rel;

  // 2) 带路径时按最后一段匹配标题（需唯一）
  if (k.includes("/")) {
    const seg = k.slice(k.lastIndexOf("/") + 1).toLowerCase();
    const hits = notes.filter((n) => n.title.toLowerCase() === seg);
    return hits.length === 1 ? hits[0].rel : null;
  }

  // 3) 无路径：按标题匹配（需唯一）
  const hits = notes.filter((n) => n.title.toLowerCase() === lower);
  return hits.length === 1 ? hits[0].rel : null;
}

/** 汇总 links-out（按引用键去重统计），exists 依据实际库内笔记解析。 */
export function summarizeLinksOut(
  md: string,
  notes: NoteRef[],
): { key: string; display: string; count: number; exists: boolean; rel?: string }[] {
  const seen = new Map<string, { key: string; display: string; count: number }>();
  for (const t of extractWikiLinks(md)) {
    const cur = seen.get(t.key) ?? { key: t.key, display: t.display, count: 0 };
    cur.count += 1;
    seen.set(t.key, cur);
  }
  return [...seen.values()].map((x) => {
    const rel = resolveLinkTarget(notes, x.key);
    return { ...x, exists: !!rel, rel: rel ?? undefined };
  });
}
