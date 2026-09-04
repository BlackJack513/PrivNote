import { useState } from "react";
import { BookOpen, FolderOpen, FolderInput, LoaderCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";

export default function VaultWelcome() {
  const openVault = useStore((s) => s.openVault);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const browse = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "选择笔记库文件夹",
    });
    if (typeof dir === "string") setPath(dir);
  };

  const useDocumentsDefault = async () => {
    setBusy(true);
    try {
      let base = "";
      try {
        const { documentDir } = await import("@tauri-apps/api/path");
        base = await documentDir();
      } catch {
        base = "C:\\Users\\Public\\Documents";
      }
      await openVault(`${base}\\PrivNote`);
    } finally {
      setBusy(false);
    }
  };

  const start = async (p?: string) => {
    const target = (p ?? path).trim();
    if (!target) return;
    setBusy(true);
    try {
      await openVault(target);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="wl-logo">
          <BookOpen size={30} />
        </div>
        <h1>欢迎使用 PrivNote</h1>
        <p>
          PrivNote 把你的学习笔记当作<strong>磁盘上真实的 Markdown 文件</strong>来管理。
          先选择一个文件夹作为「笔记库」，之后左侧目录树会直接显示这个文件夹里的内容，
          你也可以随时切换到其他库。
        </p>

        <div className="wl-field">
          <input
            placeholder="笔记库路径，例如：C:\\Users\\你\\Documents\\PrivNote"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void start();
            }}
            spellCheck={false}
          />
          <button className="wl-secondary" onClick={() => void browse()}>
            <FolderOpen size={15} style={{ verticalAlign: -2, marginRight: 4 }} />
            浏览…
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="wl-primary" disabled={busy} onClick={() => void start()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <FolderInput size={15} style={{ verticalAlign: -2, marginRight: 5 }} />}
            打开 / 创建此笔记库
          </button>
          <button className="wl-secondary" disabled={busy} onClick={() => void useDocumentsDefault()}>
            在“我的文档”新建 PrivNote
          </button>
        </div>

        <div className="wl-tip">
          提示：路径不存在时会自动创建；一个文件夹就是一个笔记库，多台设备间可用同步盘（如 OneDrive）同步笔记。
        </div>
      </div>
    </div>
  );
}
