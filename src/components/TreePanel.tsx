import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { dirOf, isMarkdown } from "../lib/paths";
import type { TreeNode } from "../lib/types";
import { useStore } from "../store";

interface CtxState {
  x: number;
  y: number;
  node: TreeNode;
}

export default function TreePanel() {
  const tree = useStore((s) => s.tree);
  const vaultName = useStore((s) => s.vaultName);
  const vaultPath = useStore((s) => s.vaultPath);
  const expanded = useStore((s) => s.expanded);
  const toggleExpand = useStore((s) => s.toggleExpand);
  const openNote = useStore((s) => s.openNote);
  const setModal = useStore((s) => s.setModal);
  const importAction = useStore((s) => s.importAction);
  const searchQuery = useStore((s) => s.searchQuery);
  const searching = useStore((s) => s.searching);
  const runSearch = useStore((s) => s.runSearch);

  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [curFolder, setCurFolder] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const searchTimer = useRef<number | undefined>(undefined);

  // 清除搜索时同步清空输入框
  useEffect(() => {
    if (searchQuery === "" && searchInput !== "") setSearchInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const closeCtx = useCallback(() => setCtx(null), []);
  useEffect(() => {
    const h = () => closeCtx();
    window.addEventListener("click", h);
    window.addEventListener("blur", h);
    return () => {
      window.removeEventListener("click", h);
      window.removeEventListener("blur", h);
    };
  }, [closeCtx]);

  const onSearchInput = (v: string) => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    setSearchInput(v);
    searchTimer.current = window.setTimeout(() => {
      void runSearch(v);
    }, 380);
  };

  const importInto = async (folder: string) => {
    if (!vaultPath) return;
    const files = await open({
      multiple: true,
      directory: false,
      title: "导入 Markdown 文件",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (!files) return;
    const arr = Array.isArray(files) ? files : [files];
    const paths = arr.filter((f): f is string => typeof f === "string");
    if (paths.length) await importAction(folder, paths);
  };

  const openMenuAt = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setSel(node.isDir ? node.rel : dirOf(node.rel));
    setCtx({ x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 260), node });
  };

  const rowClick = (node: TreeNode) => {
    if (node.isDir) {
      toggleExpand(node.rel);
      setCurFolder(node.rel);
      setSel(node.rel);
    } else {
      setSel(node.rel);
      setCurFolder(dirOf(node.rel));
    }
  };

  const searchingNow = searchInput.trim().length > 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand-mark"><BookOpen size={16} /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="brand-name">PrivNote</div>
          <div className="brand-sub" title={vaultPath ?? ""}>{vaultName || "笔记库"}</div>
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="action-btn" title="在当前位置新建笔记" onClick={() => setModal({ kind: "newNote", folder: curFolder })}>
          <FilePlus2 size={13} /> 笔记
        </button>
        <button className="action-btn" title="新建文件夹" onClick={() => setModal({ kind: "newFolder", folder: curFolder })}>
          <FolderPlus size={13} /> 文件夹
        </button>
        <button className="action-btn" title="把磁盘上的 .md 文件导入当前文件夹" onClick={() => void importInto(curFolder)}>
          <FolderInput size={13} /> 导入
        </button>
      </div>

      <div className="folder-chip" title={curFolder || "笔记库根目录"}>
        {curFolder ? (
          <>
            <span>操作位置：{curFolder}</span>
            <button className="icon-btn" style={{ width: 18, height: 18 }} title="回到根目录" onClick={() => { setCurFolder(""); setSel(""); }}>
              <X size={12} />
            </button>
          </>
        ) : (
          <span>操作位置：笔记库根目录</span>
        )}
      </div>

      <div className="search-box">
        <input
          placeholder="搜索文件名与笔记内容…"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          spellCheck={false}
        />
        <span className="search-icon">
          {searching ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}
        </span>
      </div>

      {searchingNow ? (
        <SearchResults />
      ) : (
        <div className="tree-area" onClick={() => { setCurFolder(""); setSel(null); }}>
          {tree ? (
            <Row
              node={tree}
              depth={0}
              expanded={expanded}
              toggleExpand={toggleExpand}
              openNote={openNote}
              onMenu={openMenuAt}
              rowClick={rowClick}
              sel={sel}
            />
          ) : (
            <div className="tree-empty">正在读取目录…</div>
          )}
        </div>
      )}

      {ctx && (
        <div
          className="ctx-menu"
          style={{ left: ctx.x, top: ctx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuBody
            node={ctx.node}
            onPick={(m) => {
              const n = ctx.node;
              const folder = n.isDir ? n.rel : dirOf(n.rel);
              closeCtx();
              if (m === "note") setModal({ kind: "newNote", folder });
              else if (m === "folder") setModal({ kind: "newFolder", folder });
              else if (m === "import") void importInto(folder);
              else if (m === "rename") setModal({ kind: "rename", rel: n.rel });
              else if (m === "delete") setModal({ kind: "confirmDelete", rel: n.rel });
              else if (m === "reveal" && vaultPath) void api.reveal(vaultPath, folder);
              else if (m === "refresh") { void useStore.getState().refreshTree(); void useStore.getState().refreshNotes(); }
            }}
          />
        </div>
      )}
    </aside>
  );
}

function Row(props: {
  node: TreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  toggleExpand: (rel: string) => void;
  openNote: (rel: string) => Promise<void>;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
  rowClick: (node: TreeNode) => void;
  sel: string | null;
}) {
  const { node, depth, expanded, toggleExpand, openNote, onMenu, rowClick, sel } = props;
  const open = !!expanded[node.rel] || node.rel === "";
  const isNote = !node.isDir;
  return (
    <>
      {!(node.rel === "") && (
        <div
          className={`tree-row ${node.isDir && open ? "folder-open" : ""} ${sel === node.rel ? "sel" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={(e) => {
            e.stopPropagation();
            rowClick(node);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (isNote) void openNote(node.rel);
          }}
          onContextMenu={(e) => onMenu(e, node)}
          title={isNote ? node.rel : undefined}
        >
          {node.isDir ? (
            <ChevronRight size={14} className="chev" onClick={(e) => { e.stopPropagation(); toggleExpand(node.rel); }} />
          ) : (
            <span style={{ width: 14, flex: "none" }} />
          )}
          {node.isDir ? (
            open ? <FolderOpen size={15} style={{ color: "#7c3aed", flex: "none" }} /> : <Folder size={15} style={{ color: "#7c3aed", flex: "none" }} />
          ) : (
            <FileText size={14} style={{ color: "#475569", flex: "none", opacity: 0.75 }} />
          )}
          <span className="t-name">{node.name}</span>
          <button className="icon-btn t-more" onClick={(e) => onMenu(e, node)}>
            <MoreHorizontal size={14} />
          </button>
        </div>
      )}
      {node.isDir && open &&
        node.children.map((c) => (
          <Row
            key={c.rel}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggleExpand={toggleExpand}
            openNote={openNote}
            onMenu={onMenu}
            rowClick={rowClick}
            sel={sel}
          />
        ))}
      {node.isDir && open && node.children.length === 0 && (
        <div style={{ paddingLeft: 34 + depth * 14, color: "var(--text-3)", fontSize: 12 }}>（空文件夹）</div>
      )}
    </>
  );
}

type MenuAction = "note" | "folder" | "import" | "rename" | "delete" | "reveal" | "refresh";

function MenuBody({ node, onPick }: { node: TreeNode; onPick: (m: MenuAction) => void }) {
  const isDir = node.isDir;
  const isNoteMd = !isDir && isMarkdown(node.rel);
  return (
    <>
      {isDir && (
        <>
          <div className="ctx-item" onClick={() => onPick("note")}><FilePlus2 size={14} /> 在这里新建笔记</div>
          <div className="ctx-item" onClick={() => onPick("folder")}><FolderPlus size={14} /> 新建子文件夹</div>
          <div className="ctx-item" onClick={() => onPick("import")}><FolderInput size={14} /> 导入 Markdown…</div>
          <div className="ctx-sep" />
        </>
      )}
      {isNoteMd && <div className="ctx-item" onClick={() => onPick("note")} style={{ display: "none" }} />}
      <div className="ctx-item" onClick={() => onPick("rename")}><Pencil size={14} /> 重命名</div>
      <div className="ctx-item" onClick={() => onPick("reveal")}><ExternalLink size={14} /> 在资源管理器中显示</div>
      <div className="ctx-item" onClick={() => onPick("refresh")}><RefreshCw size={14} /> 刷新目录</div>
      <div className="ctx-sep" />
      <div className="ctx-item danger" onClick={() => onPick("delete")}><Trash2 size={14} /> 移入回收站</div>
    </>
  );
}

function SearchResults() {
  const results = useStore((s) => s.searchResults);
  const query = useStore((s) => s.searchQuery).trim();
  const openNote = useStore((s) => s.openNote);
  const clearSearch = useStore((s) => s.clearSearch);

  const hl = (text: string) => {
    if (!query) return text;
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${q})`, "ig"));
    return parts.map((p, i) =>
      p.toLowerCase() === query.toLowerCase() ? <b key={i}>{p}</b> : p,
    );
  };

  if (!results) {
    return (
      <div className="search-results">
        <div className="sr-empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <LoaderCircle size={15} className="spin" /> 搜索中…
        </div>
      </div>
    );
  }

  return (
    <div className="search-results">
      {results && results.length === 0 && (
        <div className="sr-empty">
          没有找到与「{query}」相关的内容
        </div>
      )}
      {results?.map((h) => (
        <div className="sr-group" key={h.rel}>
          <div
            className="sr-head"
            title={h.rel}
            onClick={() => {
              void openNote(h.rel);
              clearSearch();
            }}
          >
            <FileText size={13} style={{ flex: "none", color: "var(--text-3)" }} />
            <span className="sr-name">{h.name}</span>
            <span className="sr-rel">{h.rel}</span>
          </div>
          {h.lines.map((ln) => (
            <div className="sr-line" key={ln.num}>{hl(ln.text)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
