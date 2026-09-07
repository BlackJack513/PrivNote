import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Braces,
  Check,
  ChevronRight,
  Code,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  LoaderCircle,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table,
  Undo2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/preset-commonmark";
import { insertTableCommand, toggleStrikethroughCommand } from "@milkdown/preset-gfm";
import { redoCommand, undoCommand } from "@milkdown/plugin-history";
import { api } from "../lib/api";
import { baseName, isMarkdown, stripMdExt, toWindowsRel } from "../lib/paths";
import { copyText } from "../lib/clipboard";
import { useStore } from "../store";
import type { TreeNode } from "../lib/types";
import {
  callCommand,
  createWysiwyg,
  insertImage,
  insertText,
  selectionTextSuffix,
  type EditorHandle,
} from "../lib/editor/milkdown";

export default function EditorPane() {
  const vaultPath = useStore((s) => s.vaultPath);
  const tree = useStore((s) => s.tree);
  const tabs = useStore((s) => s.tabs);
  const activeRel = useStore((s) => s.activeRel);
  const setContent = useStore((s) => s.setContent);
  const setTabMode = useStore((s) => s.setTabMode);
  const jumpToWiki = useStore((s) => s.jumpToWiki);
  const toastShow = useStore((s) => s.toastShow);

  const tab = tabs.find((t) => t.rel === activeRel);
  const [editorApi, setEditorApi] = useState<EditorHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [busyImg, setBusyImg] = useState(false);
  const [ctxReady, setCtxReady] = useState(false);
  const [linkPicker, setLinkPicker] = useState<{ mode: "full" | "tail" } | null>(null);
  const pickerOpenRef = useRef(false);

  const rel = tab?.rel ?? null;
  const mode = tab?.mode ?? "wysiwyg";
  const content = tab?.content ?? "";

  /* ---------- WYSIWYG 编辑器生命周期 ---------- */
  useEffect(() => {
    if (!tab || mode !== "wysiwyg" || !vaultPath || !containerRef.current) return;
    let cancelled = false;
    let handle: EditorHandle | null = null;
    setCtxReady(false);
    (async () => {
      const h = await createWysiwyg({
        root: containerRef.current!,
        markdown: tab.content,
        vaultPath,
        noteRel: tab.rel,
        onMarkdown: (md) => setContent(tab.rel, md),
      });
      if (cancelled) {
        await h.destroy();
        return;
      }
      handle = h;
      setEditorApi(h);
      setCtxReady(true);
    })();
    return () => {
      cancelled = true;
      setEditorApi(null);
      setCtxReady(false);
      if (handle) void handle.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel, mode, vaultPath]);

  /* ---------- 保存/粘贴图片 ---------- */
  const saveAndInsertImage = useCallback(
    async (file: { name: string; dataB64?: string; absPath?: string }) => {
      if (!vaultPath || !rel) return;
      setBusyImg(true);
      try {
        let markdownRel: string;
        if (file.absPath) {
          markdownRel = await api.importImageFile(vaultPath, rel, file.absPath);
        } else if (file.dataB64) {
          markdownRel = await api.saveImage(vaultPath, rel, file.name, file.dataB64);
        } else {
          return;
        }
        const st = useStore.getState();
        const modeNow = st.tabs.find((t) => t.rel === rel)?.mode ?? "wysiwyg";
        if (modeNow === "wysiwyg") {
          if (editorApi) insertImage(editorApi.editor, markdownRel, baseName(file.name));
        } else {
          const md = `\n![${baseName(file.name)}](${markdownRel})\n`;
          const ta = textareaRef.current;
          const cur = st.tabs.find((t) => t.rel === rel)?.content ?? "";
          const next = ta
            ? ta.value.slice(0, ta.selectionStart) + md + ta.value.slice(ta.selectionEnd)
            : cur + md;
          setContent(rel, next);
        }
        toastShow("图片已保存到库内 assets 文件夹", "ok");
      } catch (e) {
        toastShow(`保存图片失败：${String(e)}`, "error");
      } finally {
        setBusyImg(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultPath, rel, editorApi],
  );

  /* 剪贴板粘贴图片 */
  useEffect(() => {
    if (!tab || mode !== "wysiwyg") return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (!f) continue;
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const url = String(reader.result || "");
            const b64 = url.slice(url.indexOf(",") + 1);
            void saveAndInsertImage({ name: f.name || "clipboard.png", dataB64: b64 });
          };
          reader.readAsDataURL(f);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tab, mode, saveAndInsertImage]);

  /* 系统拖放图片（由 App 层转发） */
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<{ absPath: string }>).detail;
      if (!detail) return;
      void saveAndInsertImage({ name: baseName(detail.absPath), absPath: detail.absPath });
    };
    window.addEventListener("pn:image-file", h);
    return () => window.removeEventListener("pn:image-file", h);
  }, [saveAndInsertImage]);

  /* 点击双链装饰文本跳转 */
  const onWikiClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.(".pn-wiki") as HTMLElement | null;
      if (el?.dataset.wiki) {
        e.preventDefault();
        e.stopPropagation();
        jumpToWiki(el.dataset.wiki);
      }
    },
    [jumpToWiki],
  );

  /* ---------- 双链插入 ---------- */

  const openLinkPicker = useCallback(
    (m: "full" | "tail") => {
      if (!rel) return;
      setLinkPicker({ mode: m });
    },
    [rel],
  );

  const closeLinkPicker = useCallback(() => {
    setLinkPicker(null);
    pickerOpenRef.current = false;
  }, []);

  const insertWikiRel = useCallback(
    (noteRel: string) => {
      if (!rel) return;
      const target = stripMdExt(noteRel);
      const m = linkPicker?.mode ?? "full";
      closeLinkPicker();
      const text = m === "tail" ? `${target}]]` : `[[${target}]]`;
      if (mode === "wysiwyg" && editorApi) {
        insertText(editorApi.editor, text);
      } else {
        const ta = textareaRef.current;
        if (ta) {
          const next = ta.value.slice(0, ta.selectionStart) + text + ta.value.slice(ta.selectionEnd);
          setContent(rel, next);
          requestAnimationFrame(() => {
            ta.focus();
            const pos = ta.selectionStart + text.length;
            ta.setSelectionRange(pos, pos);
          });
        } else {
          setContent(rel, content + text);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rel, mode, editorApi, linkPicker?.mode, content],
  );

  /* 写作模式输入 [[ 自动弹出 */
  useEffect(() => {
    if (!ctxReady || !editorApi || mode !== "wysiwyg") return;
    const host = containerRef.current;
    if (!host) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || pickerOpenRef.current) return;
      window.setTimeout(() => {
        if (pickerOpenRef.current) return;
        const suffix = selectionTextSuffix(editorApi.editor, 2);
        if (suffix.endsWith("[[")) openLinkPicker("tail");
      }, 0);
    };
    host.addEventListener("keydown", onKey);
    return () => host.removeEventListener("keydown", onKey);
  }, [ctxReady, editorApi, mode, openLinkPicker]);

  /* 源码模式输入 [[ 自动弹出 */
  const onSourceKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "[" && !pickerOpenRef.current) {
      const ta = e.currentTarget;
      const before = ta.value.slice(0, ta.selectionStart);
      if (before.endsWith("[[")) openLinkPicker("tail");
    }
  };

  /* 全局快捷键：Ctrl+Shift+K 插入双链；Ctrl+Shift+C 复制路径 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        if (!rel) return;
        e.preventDefault();
        openLinkPicker("full");
      } else if (k === "c") {
        if (!rel) return;
        e.preventDefault();
        const txt = toWindowsRel(rel);
        void copyText(txt).then((ok) => {
          toastShow(ok ? `已复制路径：${txt}` : "复制失败", ok ? "ok" : "error");
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rel, openLinkPicker, toastShow]);

  /* ---------- 工具栏命令 ---------- */
  const run = (cmd: { key: unknown }, payload?: unknown) => {
    if (!editorApi) return;
    callCommand(editorApi.editor, cmd, payload);
  };

  const headingSelect = (level: number | 0) => {
    if (level === 0) run(turnIntoTextCommand);
    else run(wrapInHeadingCommand, level);
  };

  const addLink = () => {
    const href = window.prompt("输入链接地址", "https://");
    if (href === null) return;
    run(toggleLinkCommand, { href: href.trim() });
  };

  const pickImageFile = async () => {
    const p = await open({
      multiple: false,
      directory: false,
      title: "选择图片",
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
    });
    if (typeof p !== "string") return;
    void saveAndInsertImage({ name: baseName(p), absPath: p });
  };

  const copyPath = async () => {
    if (!rel) return;
    const txt = toWindowsRel(rel);
    const ok = await copyText(txt);
    toastShow(ok ? `已复制路径：${txt}` : "复制失败", ok ? "ok" : "error");
  };

  /* ---------- 渲染 ---------- */
  if (!rel || !tab) {
    return (
      <div className="editor-col">
        <div className="empty-state" style={{ flex: 1 }}>
          <FileText size={40} strokeWidth={1.2} />
          <div className="es-main">还没有打开的笔记</div>
          <div style={{ fontSize: 13, maxWidth: 420, textAlign: "center", lineHeight: 1.8 }}>
            在左侧目录树双击一篇笔记，或使用「笔记」按钮新建；也可以把现成的 .md 文件直接拖进来导入。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-col">
      <div className="note-path">
        <FileText size={12} />
        <span className="np-rel" title={rel}>{rel}</span>
        <button className="icon-btn" style={{ width: 22, height: 22 }} title="复制库内完整路径到剪贴板（Ctrl+Shift+C）" onClick={() => void copyPath()}>
          <Copy size={13} />
        </button>
        {tab.saving ? (
          <span className="save-state dirty"><LoaderCircle size={11} className="spin" /> 保存中…</span>
        ) : tab.dirty ? (
          <span className="save-state dirty"><Check size={11} /> 自动保存中…</span>
        ) : (
          <span className="save-state ok"><Check size={11} /> 已保存</span>
        )}
      </div>

      <div className="toolbar">
        <select
          className="tb-btn"
          style={{ border: "1px solid var(--border)", background: "#fff", appearance: "auto", paddingRight: 4 }}
          title="段落样式"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v !== "") {
              headingSelect(v === "p" ? 0 : Number(v));
              e.target.value = "";
            }
          }}
        >
          <option value="" disabled>样式</option>
          <option value="p">正文</option>
          <option value="1">标题 1</option>
          <option value="2">标题 2</option>
          <option value="3">标题 3</option>
          <option value="4">标题 4</option>
          <option value="5">标题 5</option>
          <option value="6">标题 6</option>
        </select>

        <button className="tb-btn" title="加粗（Ctrl+B）" onClick={() => run(toggleStrongCommand)}><Bold size={15} /></button>
        <button className="tb-btn" title="斜体（Ctrl+I）" onClick={() => run(toggleEmphasisCommand)}><Italic size={15} /></button>
        <button className="tb-btn" title="删除线" onClick={() => run(toggleStrikethroughCommand)}><Strikethrough size={15} /></button>
        <button className="tb-btn" title="行内代码" onClick={() => run(toggleInlineCodeCommand)}><Code size={15} /></button>
        <button className="tb-btn" title="代码块" onClick={() => run(createCodeBlockCommand)}><SquareCode size={15} /></button>
        <span className="tb-sep" />
        <button className="tb-btn" title="引用" onClick={() => run(wrapInBlockquoteCommand)}><Quote size={15} /></button>
        <button className="tb-btn" title="无序列表" onClick={() => run(wrapInBulletListCommand)}><List size={16} /></button>
        <button className="tb-btn" title="有序列表" onClick={() => run(wrapInOrderedListCommand)}><ListOrdered size={16} /></button>
        <button className="tb-btn" title="水平分割线" onClick={() => run(insertHrCommand)}><Minus size={15} /></button>
        <button className="tb-btn" title="表格（3×3）" onClick={() => run(insertTableCommand, { row: 3, col: 3 })}><Table size={15} /></button>
        <span className="tb-sep" />
        <button className="tb-btn" title="插入链接" onClick={addLink}><Link size={15} /></button>
        <button className="tb-btn" title="插入图片（从磁盘选择并保存到库内）" onClick={() => void pickImageFile()}><ImageIcon size={15} /></button>
        <button
          className={`tb-btn ${linkPicker ? "on" : ""}`}
          title="从目录树选择笔记插入双链（快捷键 Ctrl+Shift+K，输入 [[ 也可触发）"
          onClick={() => openLinkPicker("full")}
        >
          <Braces size={15} />
        </button>
        {busyImg && <LoaderCircle size={15} className="spin" style={{ color: "var(--text-3)" }} />}
        <span className="tb-sep" />
        <button className="tb-btn" title="撤销" onClick={() => run(undoCommand)}><Undo2 size={15} /></button>
        <button className="tb-btn" title="重做" onClick={() => run(redoCommand)}><Redo2 size={15} /></button>

        <div className="mode-switch">
          <button className={mode === "wysiwyg" ? "active" : ""} onClick={() => setTabMode(rel, "wysiwyg")}>写作</button>
          <button className={mode === "source" ? "active" : ""} onClick={() => setTabMode(rel, "source")}>源码</button>
        </div>
      </div>

      {mode === "wysiwyg" ? (
        <div className="editor-scroll">
          <div className="milkdown-editor" style={{ minHeight: "60vh" }}>
            <div ref={containerRef} className="milkdown-host" onClick={onWikiClick} />
            {!ctxReady && (
              <div style={{ textAlign: "center", padding: 80, color: "var(--text-3)" }}>
                <LoaderCircle size={18} className="spin" /> 正在载入编辑器…
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="editor-scroll source">
          <textarea
            ref={textareaRef}
            className="source-area"
            value={content}
            onChange={(e) => setContent(rel, e.target.value)}
            onKeyUp={onSourceKeyUp}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                ta.setRangeText("  ", start, ta.selectionEnd, "end");
                setContent(rel, ta.value);
              }
            }}
            spellCheck={false}
          />
          <div className="mode-hint" style={{ position: "absolute", bottom: 4, left: 14 }}>
            源码模式：直接编辑 Markdown，输入 [[ 或按 Ctrl+Shift+K 插入双链；Ctrl+Shift+C 复制路径
          </div>
        </div>
      )}

      {linkPicker && tree && (
        <LinkTreePicker
          root={tree}
          onPick={insertWikiRel}
          onClose={closeLinkPicker}
          pickerOpenRef={pickerOpenRef}
        />
      )}
    </div>
  );
}

/* ================= 目录树双链选择器 ================= */

function LinkTreePicker(props: {
  root: TreeNode;
  onPick: (rel: string) => void;
  onClose: () => void;
  pickerOpenRef: { current: boolean };
}) {
  const { root, onPick, onClose, pickerOpenRef } = props;
  const [open, setOpen] = useState<Record<string, boolean>>({ [root.rel]: true });

  useEffect(() => {
    pickerOpenRef.current = true;
    return () => {
      pickerOpenRef.current = false;
    };
  }, [pickerOpenRef]);

  const toggle = (rel: string) => setOpen((s) => ({ ...s, [rel]: !s[rel] }));

  const renderNode = (node: TreeNode, depth: number) => {
    const isFolder = node.isDir;
    const isMd = !isFolder && isMarkdown(node.rel);
    const expanded = !!open[node.rel];
    return (
      <div key={node.rel}>
        <div
          className={`lp-row ${!isFolder ? "lp-file" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            if (isFolder) toggle(node.rel);
            else if (isMd) onPick(node.rel);
          }}
          title={isFolder ? node.rel : node.rel}
        >
          {isFolder ? (
            <ChevronRight size={13} className={`lp-chev ${expanded ? "open" : ""}`} />
          ) : isMd ? (
            <FileText size={13} style={{ color: "#475569", flex: "none", opacity: 0.8 }} />
          ) : (
            <span style={{ width: 13, flex: "none" }} />
          )}
          {isFolder && (expanded ? <FolderOpen size={14} style={{ color: "#7c3aed", flex: "none" }} /> : <Folder size={14} style={{ color: "#7c3aed", flex: "none" }} />)}
          <span className="lp-name">{node.name}</span>
          {!isFolder && isMd && <span className="lp-rel">{stripMdExt(node.rel)}</span>}
        </div>
        {isFolder && expanded && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal link-pick-modal">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Braces size={16} style={{ color: "var(--accent)" }} /> 插入双链引用
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-3)" }}>
            从目录树选择一篇笔记（点击展开目录 / 点击笔记插入）
          </span>
          <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}><X size={15} /></button>
        </h3>
        <div className="lp-tree">
          {root.children.map((c) => renderNode(c, 0))}
          {root.children.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>笔记库还没有内容</div>
          )}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "8px 2px 0", lineHeight: 1.6 }}>
          插入的是从根目录开始的完整路径引用（如 [[notes/react/useState]]，不带 .md），
          点击目录/文件夹名称可展开收起。
        </p>
      </div>
    </div>
  );
}
