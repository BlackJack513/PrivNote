import { useEffect, useState } from "react";
import { AlertTriangle, FilePlus2, FolderPlus, Pencil, Sparkles } from "lucide-react";
import { baseName, dirOf } from "../lib/paths";
import { useStore } from "../store";

function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") fn();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [fn]);
}

export default function Modals() {
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const close = () => setModal(null);

  if (!modal) return null;

  if (modal.kind === "confirmDelete") {
    return <ConfirmDeleteModal rel={modal.rel!} onClose={close} />;
  }
  if (modal.kind === "newNote") {
    return <NameModal kind="note" folder={modal.folder ?? ""} prefill={modal.prefill} onClose={close} />;
  }
  if (modal.kind === "newFolder") {
    return <NameModal kind="folder" folder={modal.folder ?? ""} onClose={close} />;
  }
  if (modal.kind === "rename") {
    return <RenameModal rel={modal.rel!} onClose={close} />;
  }
  if (modal.kind === "wikiCreate") {
    return <WikiCreateModal target={modal.target ?? ""} folder={modal.folder ?? ""} onClose={close} />;
  }
  return null;
}

function ConfirmDeleteModal({ rel, onClose }: { rel: string; onClose: () => void }) {
  const deleteAction = useStore((s) => s.deleteAction);
  const [busy, setBusy] = useState(false);
  const isDir = !rel.includes(".") || rel.endsWith("/");
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <AlertTriangle size={17} style={{ color: "var(--danger)", verticalAlign: -3, marginRight: 6 }} />
          删除确认
        </h3>
        <p className="m-msg">
          确定把「<strong>{baseName(rel)}</strong>」移入回收站吗？
          {isDir ? "（文件夹内的笔记会一并移入回收站）" : ""}
        </p>
        <div className="m-actions">
          <button className="m-btn" onClick={onClose}>取消</button>
          <button
            className="m-btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await deleteAction([rel]);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {busy ? "删除中…" : "移入回收站"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NameModal({
  kind,
  folder,
  prefill,
  onClose,
}: {
  kind: "note" | "folder";
  folder: string;
  prefill?: string;
  onClose: () => void;
}) {
  const createNoteAction = useStore((s) => s.createNoteAction);
  const createFolderAction = useStore((s) => s.createFolderAction);
  const [name, setName] = useState(prefill ?? "");
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  const isNote = kind === "note";
  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    if (isNote) {
      const rel = await createNoteAction(folder, n);
      if (rel) onClose();
    } else {
      const rel = await createFolderAction(folder, n);
      if (rel) onClose();
    }
    setBusy(false);
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          {isNote ? (
            <FilePlus2 size={17} style={{ color: "var(--accent)", verticalAlign: -3, marginRight: 6 }} />
          ) : (
            <FolderPlus size={17} style={{ color: "var(--accent)", verticalAlign: -3, marginRight: 6 }} />
          )}
          {isNote ? "新建笔记" : "新建文件夹"}
        </h3>
        <div className="m-field">
          <label>位置：{folder ? folder : "笔记库根目录"}</label>
          <input
            autoFocus
            placeholder={isNote ? "输入笔记名称（无需扩展名）" : "输入文件夹名称"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            spellCheck={false}
          />
        </div>
        <div className="m-actions">
          <button className="m-btn" onClick={onClose}>取消</button>
          <button className="m-btn primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameModal({ rel, onClose }: { rel: string; onClose: () => void }) {
  const renameAction = useStore((s) => s.renameAction);
  const [name, setName] = useState(baseName(rel));
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const ok = await renameAction(rel, n);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Pencil size={16} style={{ color: "var(--accent)", verticalAlign: -3, marginRight: 6 }} />
          重命名
        </h3>
        <div className="m-field">
          <label>位置：{dirOf(rel) || "笔记库根目录"}</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            spellCheck={false}
          />
        </div>
        <div className="m-actions">
          <button className="m-btn" onClick={onClose}>取消</button>
          <button className="m-btn primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? "重命名中…" : "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WikiCreateModal({
  target,
  folder,
  onClose,
}: {
  target: string;
  folder: string;
  onClose: () => void;
}) {
  const createNoteAction = useStore((s) => s.createNoteAction);
  const openNote = useStore((s) => s.openNote);
  const [name, setName] = useState(target);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  const submit = async (alsoOpen: boolean) => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const rel = await createNoteAction(folder, n);
    setBusy(false);
    if (rel) {
      onClose();
      if (alsoOpen) void openNote(rel);
    }
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Sparkles size={16} style={{ color: "var(--warn)", verticalAlign: -3, marginRight: 6 }} />
          创建双链笔记
        </h3>
        <p className="m-msg">
          「[[{target}]]」指向的笔记还不存在，是否创建它？
        </p>
        <div className="m-field">
          <label>位置：{folder ? folder : "笔记库根目录"}</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </div>
        <div className="m-actions">
          <button className="m-btn" onClick={onClose}>取消</button>
          <button className="m-btn" disabled={busy} onClick={() => void submit(false)}>仅创建</button>
          <button className="m-btn primary" disabled={busy || !name.trim()} onClick={() => void submit(true)}>
            {busy ? "创建中…" : "创建并打开"}
          </button>
        </div>
      </div>
    </div>
  );
}
