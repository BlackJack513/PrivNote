import { useEffect, useState } from "react";
import { Copy, FileText, FolderInput, PanelRight, RefreshCw, Sparkles, X } from "lucide-react";
import { toWindowsRel } from "../lib/paths";
import { copyText } from "../lib/clipboard";
import { useStore } from "../store";

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeRel = useStore((s) => s.activeRel);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const closeTabSide = useStore((s) => s.closeTabSide);
  const toastShow = useStore((s) => s.toastShow);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshNotes = useStore((s) => s.refreshNotes);
  const setModal = useStore((s) => s.setModal);
  const showRight = useStore((s) => s.showRight);
  const setShowRight = useStore((s) => s.setShowRight);
  const showAi = useStore((s) => s.showAi);
  const setShowAi = useStore((s) => s.setShowAi);

  const [menu, setMenu] = useState<{ x: number; y: number; rel: string } | null>(null);

  /* 点击其它处 / Esc 关闭右键菜单 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // 捕获阶段的右键 mousedown 先关掉旧菜单，让随后的 onContextMenu 打开新菜单
    const onDown = (e: MouseEvent) => {
      if (e.button === 2) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, rel: string) => {
    e.preventDefault();
    e.stopPropagation();
    const count = tabs.length;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - (count > 1 ? 250 : 150)),
      rel,
    });
  };

  const indexOf = (rel: string) => tabs.findIndex((t) => t.rel === rel);
  const run = (fn: () => void) => {
    setMenu(null);
    fn();
  };

  const copyPath = async (rel: string) => {
    const txt = toWindowsRel(rel);
    const ok = await copyText(txt);
    toastShow(ok ? `已复制路径：${txt}` : "复制失败", ok ? "ok" : "error");
  };

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
        {tabs.map((t) => {
          const idx = indexOf(t.rel);
          const total = tabs.length;
          const active = t.rel === activeRel;
          return (
            <div
              key={t.rel}
              className={`tab ${active ? "active" : ""}`}
              onClick={() => activateTab(t.rel)}
              onAuxClick={(e) => {
                if (e.button === 1) void closeTab(t.rel);
              }}
              onContextMenu={(e) => openMenu(e, t.rel)}
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

              {menu && menu.rel === t.rel && (
                <TabContextMenu
                  x={menu.x}
                  y={menu.y}
                  canLeft={idx > 0}
                  canRight={idx < total - 1}
                  canOthers={total > 1}
                  onCloseSelf={() => run(() => void closeTab(t.rel))}
                  onCloseLeft={() => run(() => void closeTabSide(t.rel, "left"))}
                  onCloseRight={() => run(() => void closeTabSide(t.rel, "right"))}
                  onCloseOthers={() => run(() => void closeTabSide(t.rel, "others"))}
                  onCopyPath={() => void copyPath(t.rel)}
                />
              )}
            </div>
          );
        })}
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

function TabContextMenu(props: {
  x: number;
  y: number;
  canLeft: boolean;
  canRight: boolean;
  canOthers: boolean;
  onCloseSelf: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onCloseOthers: () => void;
  onCopyPath: () => void;
}) {
  const { x, y, canLeft, canRight, canOthers } = props;
  return (
    <div
      className="ctx-menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 300 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="ctx-item" onClick={props.onCloseSelf}>关闭标签页</div>
      <div className="ctx-sep" />
      <div
        className={`ctx-item ${canLeft ? "" : "ctx-disabled"}`}
        onClick={canLeft ? props.onCloseLeft : undefined}
      >
        关闭左侧的标签页
      </div>
      <div
        className={`ctx-item ${canRight ? "" : "ctx-disabled"}`}
        onClick={canRight ? props.onCloseRight : undefined}
      >
        关闭右侧的标签页
      </div>
      <div
        className={`ctx-item ${canOthers ? "" : "ctx-disabled"}`}
        onClick={canOthers ? props.onCloseOthers : undefined}
      >
        关闭其它标签页
      </div>
      <div className="ctx-sep" />
      <div className="ctx-item" onClick={props.onCopyPath}>
        <Copy size={13} /> 复制笔记路径
      </div>
    </div>
  );
}
