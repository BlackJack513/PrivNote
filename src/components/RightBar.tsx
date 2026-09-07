import { ArrowRightLeft, CornerDownRight, Copy, ExternalLink, Link2, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { toWindowsRel } from "../lib/paths";
import { copyText } from "../lib/clipboard";
import { useStore } from "../store";

export default function RightBar() {
  const vaultPath = useStore((s) => s.vaultPath);
  const activeRel = useStore((s) => s.activeRel);
  const tabs = useStore((s) => s.tabs);
  const backlinks = useStore((s) => s.backlinks);
  const linksOut = useStore((s) => s.linksOut);
  const openNote = useStore((s) => s.openNote);
  const setModal = useStore((s) => s.setModal);

  const activeTab = tabs.find((t) => t.rel === activeRel);
  if (!activeRel || !activeTab) {
    return (
      <aside className="rightbar">
        <div className="rb-section">
          <div className="rb-title">双链</div>
          <div className="rb-empty">打开一篇笔记后，这里会显示它与其它笔记的引用关系。</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rightbar">
      <div className="rb-section" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="rb-title" style={{ marginBottom: 2 }}>
          <ArrowRightLeft size={13} /> 当前笔记
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", wordBreak: "break-all" }}>{activeTab.rel}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="action-btn"
            onClick={async () => {
              const ok = await copyText(toWindowsRel(activeRel));
              useStore.getState().toastShow(ok ? `已复制路径：${toWindowsRel(activeRel)}` : "复制失败", ok ? "ok" : "error");
            }}
            title="复制库内完整路径到剪贴板"
          >
            <Copy size={13} /> 复制路径
          </button>
          <button
            className="action-btn"
            onClick={() => {
              if (vaultPath) void api.reveal(vaultPath, activeRel);
            }}
            title="在资源管理器中显示"
          >
            <ExternalLink size={13} /> 在资源管理器中显示
          </button>
        </div>
      </div>

      <div className="rb-section">
        <div className="rb-title">
          <Link2 size={13} /> 引用出去 · {linksOut.length}
        </div>
        {linksOut.length === 0 && <div className="rb-empty">还没有 [[双链]]。</div>}
        {linksOut.map((l) => {
          const rel = l.exists ? l.rel : undefined;
          return (
            <div
              key={l.key}
              className={`rb-item ${l.exists ? "" : "missing"}`}
              title={l.exists ? `打开 ${rel}` : `创建笔记「${l.key}」`}
              onClick={() => {
                if (rel) void openNote(rel);
                else setModal({ kind: "wikiCreate", target: l.key, folder: activeTab.rel.includes("/") ? activeTab.rel.slice(0, activeTab.rel.lastIndexOf("/")) : "" });
              }}
            >
              <CornerDownRight size={13} style={{ flex: "none", marginTop: 2 }} />
              <span className="rb-name">{l.display}</span>
              <span className="rb-sub">{l.exists ? "" : "（待创建）"}</span>
              <span className="rb-count">{l.count}</span>
            </div>
          );
        })}
      </div>

      <div className="rb-section">
        <div className="rb-title">
          <Undo2 size={13} /> 反向链接 · {backlinks.length}
        </div>
        {backlinks.length === 0 && <div className="rb-empty">没有其它笔记引用本篇。</div>}
        {backlinks.map((b) => (
          <div key={b.rel} className="rb-item" title={b.rel} onClick={() => void openNote(b.rel)}>
            <FileGlyph />
            <span style={{ minWidth: 0 }}>
              <div className="rb-name">{b.name}</div>
              {b.lines.map((ln, i) => (
                <div key={i} className="rb-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <b style={{ color: "var(--text-3)" }}>{ln.num}.</b> {ln.text.slice(0, 80)}
                </div>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="rb-section">
        <div className="rb-hint">
          在笔记中写 <code>[[笔记标题]]</code> 即可建立双链；
          写作模式下会自动高亮，点击可跳转（不存在时提示创建）。格式与 Obsidian 兼容。
        </div>
      </div>
    </aside>
  );
}

function FileGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "none", marginTop: 2, color: "var(--text-3)" }}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
