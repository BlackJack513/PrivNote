import { FileText, X, FolderInput, RefreshCw, PanelRight, Sparkles } from "lucide-react";
import { useStore } from "../store";

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeRel = useStore((s) => s.activeRel);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshNotes = useStore((s) => s.refreshNotes);
  const setModal = useStore((s) => s.setModal);
  const showRight = useStore((s) => s.showRight);
  const setShowRight = useStore((s) => s.setShowRight);
  const showAi = useStore((s) => s.showAi);
  const setShowAi = useStore((s) => s.setShowAi);

  return (
    <div className="tabbar">
      <div className="tabs-scroll">
        {tabs.length === 0 && (
          <div
            className="tab"
            style={{ border: "none", color: "var(--text-3)", minWidth: 0, width: "auto", paddingRight: 4 }}
          >
            未打开笔记
          </div>
        )}
        {tabs.map((t) => (
          <div
            key={t.rel}
            className={`tab ${t.rel === activeRel ? "active" : ""}`}
            onClick={() => activateTab(t.rel)}
            onAuxClick={(e) => {
              if (e.button === 1) void closeTab(t.rel);
            }}
            title={t.rel}
          >
            <FileText size={14} style={{ flex: "none", opacity: 0.75 }} />
            <span className="t-label">{t.name}</span>
            {t.dirty && !t.saving && <span className="dirty-dot" title="有未保存修改" />}
            {t.saving && (
              <span
                className="dirty-dot"
                style={{ background: "var(--text-3)", animation: "pnBlink 1s infinite" }}
              />
            )}
            <button
              className="icon-btn close"
              style={{ width: 20, height: 20 }}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(t.rel);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="tabbar-actions">
        <button
          className="icon-btn"
          title="刷新目录与笔记索引"
          onClick={() => {
            void refreshTree();
            void refreshNotes();
          }}
        >
          <RefreshCw size={15} />
        </button>
        <button className="icon-btn" title="切换笔记库文件夹" onClick={() => setModal({ kind: "switchVault" })}>
          <FolderInput size={15} />
        </button>
        <button
          className={`icon-btn ${showAi ? "on" : ""}`}
          title={showAi ? "收起 AI 助手" : "打开 AI 助手（DeepSeek）"}
          onClick={() => setShowAi(!showAi)}
        >
          <Sparkles size={15} />
        </button>
        <button
          className={`icon-btn ${showRight ? "on" : ""}`}
          title={showRight ? "收起双链面板" : "显示双链面板"}
          onClick={() => setShowRight(!showRight)}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </div>
  );
}
