// 小型 diff 工具（行级），用于审批窗口展示改动。
import { diffLines } from "diff";

export type DiffRow = { type: "add" | "del" | "same"; text: string };

export function computeDiffRows(a: string, b: string): { rows: DiffRow[]; added: number; removed: number } {
  const parts = diffLines(a, b);
  let added = 0;
  let removed = 0;
  const rows: DiffRow[] = [];
  for (const p of parts) {
    if (p.added) {
      added += p.count ?? 1;
      rows.push({ type: "add", text: p.value });
    } else if (p.removed) {
      removed += p.count ?? 1;
      rows.push({ type: "del", text: p.value });
    } else {
      rows.push({ type: "same", text: p.value });
    }
  }
  // 转成行数组（去掉结尾空段）
  const lines: DiffRow[] = [];
  for (const r of rows) {
    const segs = r.text.split("\n");
    segs.forEach((s, i) => {
      if (i === segs.length - 1 && s === "") return;
      lines.push({ type: r.type, text: s });
    });
  }
  return { rows: lines, added, removed };
}
