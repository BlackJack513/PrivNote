// [[双链]] 文本解析工具。

export interface WikiToken {
  raw: string; // 双链目标原文（不含括号）
  title: string; // 笔记标题（去掉 |别名 与 #锚点 后）
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
    out.push({ raw, title: head, display });
  }
  return out;
}

/** 汇总 links-out（按标题去重统计）。 */
export function summarizeLinksOut(md: string, existing: Set<string>): { title: string; display: string; count: number; exists: boolean }[] {
  const seen = new Map<string, { title: string; display: string; count: number }>();
  for (const t of extractWikiLinks(md)) {
    const cur = seen.get(t.title) ?? { title: t.title, display: t.display, count: 0 };
    cur.count += 1;
    seen.set(t.title, cur);
  }
  return [...seen.values()].map((x) => ({
    ...x,
    exists: existing.has(x.title.toLowerCase()),
  }));
}
