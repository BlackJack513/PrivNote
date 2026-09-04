import { useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";

/** 切换笔记库弹窗 */
export default function SwitchVaultModal({ onClose }: { onClose: () => void }) {
  const openVault = useStore((s) => s.openVault);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "选择新的笔记库文件夹",
    });
    if (typeof dir !== "string") return;
    setBusy(true);
    await openVault(dir);
    // openVault 成功/失败都会把 phase 切到 ready/welcome，无需手动关闭
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>切换笔记库</h3>
        <p className="m-msg">
          选择另一个文件夹作为笔记库后，左侧目录树与标签页会切换到新库的内容。
          原来的笔记文件不会被改动。
        </p>
        <div className="m-actions">
          <button className="m-btn" onClick={onClose}>取消</button>
          <button className="m-btn primary" disabled={busy} onClick={() => void pick()}>
            {busy ? <LoaderCircle size={14} /> : <FolderOpen size={14} style={{ verticalAlign: -2, marginRight: 4 }} />}
            选择文件夹…
          </button>
        </div>
      </div>
    </div>
  );
}
