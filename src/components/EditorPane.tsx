import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Braces,
  Check,
  Code,
  FileText,
  Heading3,
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
import { baseName, dirOf } from "../lib/paths";
import { useStore } from "../store";
import {
  callCommand,
  createWysiwyg,
  type EditorHandle,
  focusEditor,
  insertImage,
  insertText,
} from "../lib/editor/milkdown";

export default function EditorPane() {
  const vaultPath = useStore((s) => s.vaultPath);
  const tabs = useStore((s) => s.tabs);
  const activeRel = useStore((s) => s.activeRel);
  const setContent = useStore((s) => s.setContent);
  const setTabMode = useStore((s) => s.setTabMode);
  const jumpToWiki = useStore((s) => s.jumpToWiki);
  const toastShow = useStore((s) => s.toastShow);
  const notes = useStore((s) => s.notes);

  const tab = tabs.find((t) => t.rel === activeRel);
  const [editorApi, setEditorApi] = useState<EditorHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [busyImg, setBusyImg] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiQ, setWikiQ] = useState("");
  const [ctxReady, setCtxReady] = useState(false);

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

  /* 双击/点击 双链 装饰文本跳转 */
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

  /* ---------- 工具栏命令 ---------- */
  const run = (cmd: { key: unknown }, payload?: unknown) => {
    if (!editorApi) return;
    callCommand(editorApi.editor, cmd, payload);
    focusEditor(editorApi.editor);
  };

  const headingSelect = (level: number | 0) => {
    if (!editorApi) return;
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

  const insertWiki = (title: string) => {
    setWikiOpen(false);
    setWikiQ("");
    const text = `[[${title}]]`;
    if (editorApi) insertText(editorApi.editor, text);
    else {
      const ta = textareaRef.current;
      if (ta) {
        const next = ta.value.slice(0, ta.selectionStart) + text + ta.value.slice(ta.selectionEnd);
        setContent(rel!, next);
        requestAnimationFrame(() => ta.focus());
      }
    }
  };

  const newNoteFromWiki = async (title: string) => {
    const folder = rel ? dirOf(rel) : "";
    setWikiOpen(false);
    setWikiQ("");
    const created = await useStore.getState().createNoteAction(folder, title);
    if (created) {
      // 把链接补进原文
      const t = useStore.getState().tabs.find((x) => x.rel === rel);
      if (t) setContent(rel!, `${t.content}\n\n[[${title}]]\n`);
    }
  };

  const pickable = notes.filter((n) => n.title.toLowerCase().includes(wikiQ.trim().toLowerCase()));
  const exactPick = pickable.find((n) => n.title.toLowerCase() === wikiQ.trim().toLowerCase());
  const canCreate = wikiQ.trim().length > 0 && !exactPick;

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
          className={`tb-btn ${wikiOpen ? "on" : ""}`}
          title="插入双链 [[笔记]]"
          onClick={() => setWikiOpen((v) => !v)}
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

        {wikiOpen && (
          <WikiPicker
            q={wikiQ}
            setQ={setWikiQ}
            items={pickable}
            canCreate={canCreate}
            onPick={insertWiki}
            onCreate={() => void newNoteFromWiki(wikiQ.trim())}
            onClose={() => setWikiOpen(false)}
          />
        )}
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
            源码模式：直接编辑 Markdown，切换回「写作」即时预览
          </div>
        </div>
      )}
    </div>
  );
}

function WikiPicker(props: {
  q: string;
  setQ: (v: string) => void;
  items: { rel: string; title: string }[];
  canCreate: boolean;
  onPick: (title: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { q, setQ, items, canCreate, onPick, onCreate, onClose } = props;
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="ctx-menu"
        style={{ position: "absolute", top: 42, left: 6, width: 300, zIndex: 60 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px 6px" }}>
          <input
            autoFocus
            value={q}
            placeholder="输入/筛选笔记标题"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (items[0]) onPick(items[0].title);
                else if (canCreate) onCreate();
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            style={{ flex: 1, height: 28, border: "1px solid var(--border-strong)", borderRadius: 6, padding: "0 8px", fontSize: 13, outline: "none" }}
            spellCheck={false}
          />
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="wiki-pick-list" style={{ border: "none", maxHeight: 260 }}>
          {items.slice(0, 12).map((n) => (
            <div key={n.rel} className="wiki-pick-item" onClick={() => onPick(n.title)}>
              <Heading3 size={12} style={{ color: "var(--text-3)" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{n.title}</div>
                <div className="wp-rel">{n.rel}</div>
              </span>
            </div>
          ))}
          {items.length === 0 && !canCreate && (
            <div style={{ padding: "10px 8px", color: "var(--text-3)", fontSize: 12 }}>没有匹配的笔记</div>
          )}
          {canCreate && (
            <div className="wiki-pick-item" onClick={onCreate} style={{ color: "var(--accent)" }}>
              <FileText size={13} /> 新建笔记「{q.trim()}」并插入链接
            </div>
          )}
        </div>
      </div>
    </>
  );
}
