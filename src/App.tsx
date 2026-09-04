import { useEffect } from "react";
import { BookOpen, CheckCircle2, Info, LoaderCircle, XCircle } from "lucide-react";
import TreePanel from "./components/TreePanel";
import TabBar from "./components/TabBar";
import EditorPane from "./components/EditorPane";
import RightBar from "./components/RightBar";
import Modals from "./components/Modals";
import SwitchVaultModal from "./components/SwitchVaultModal";
import VaultWelcome from "./components/VaultWelcome";
import { dirOf, extOf } from "./lib/paths";
import { useStore } from "./store";

export default function App() {
  const phase = useStore((s) => s.phase);
  const toast = useStore((s) => s.toast);
  const modal = useStore((s) => s.modal);
  const showRight = useStore((s) => s.showRight);

  /* 初始化：恢复上次笔记库 */
  useEffect(() => {
    void useStore.getState().init();
  }, []);

  /* 文件拖入：Markdown 导入，图片插入当前笔记 */
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webviewWindow").then(async ({ getCurrentWebviewWindow }) => {
      const win = getCurrentWebviewWindow();
      unlisten = await win.onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) return;
        const md: string[] = [];
        const images: string[] = [];
        for (const p of paths) {
          const ext = extOf(p);
          if (ext === "md" || ext === "markdown") md.push(p);
          else if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) images.push(p);
        }
        const st = useStore.getState();
        if (md.length) {
          const folder = st.activeRel ? dirOf(st.activeRel) : "";
          void st.importAction(folder, md);
        }
        if (images.length) {
          if (!st.activeRel) {
            st.toastShow("请先打开一篇笔记，再把图片拖进来", "info");
          } else {
            for (const p of images) {
              window.dispatchEvent(new CustomEvent("pn:image-file", { detail: { absPath: p } }));
            }
          }
        }
      });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  /* 关闭窗口前冲刷未保存内容 */
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault();
        await useStore.getState().flushAll();
        await win.destroy();
      });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  /* Ctrl/Cmd+S 立即保存 */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void useStore.getState().flushAll().then(() => {
          useStore.getState().toastShow("已保存", "ok");
        });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (phase === "loading") {
    return (
      <div className="welcome">
        <div style={{ textAlign: "center", color: "var(--text-3)" }}>
          <BookOpen size={42} style={{ marginBottom: 14, color: "var(--accent)" }} />
          <div><LoaderCircle size={16} className="spin" /> 正在启动 PrivNote…</div>
        </div>
      </div>
    );
  }

  if (phase === "welcome") return <VaultWelcome />;

  return (
    <div className="app">
      <div className="app-body">
        <TreePanel />
        <div className="main">
          <TabBar />
          <div className="workspace">
            <EditorPane />
            {showRight && <RightBar />}
          </div>
        </div>
      </div>

      {modal?.kind === "switchVault" && <SwitchVaultModal onClose={() => useStore.getState().setModal(null)} />}
      <Modals />
      <div className="toast-wrap">
        {toast && (
          <div className={`toast ${toast.kind}`} key={toast.id}>
            {toast.kind === "ok" && <CheckCircle2 size={15} />}
            {toast.kind === "error" && <XCircle size={15} />}
            {toast.kind === "info" && <Info size={15} />}
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
