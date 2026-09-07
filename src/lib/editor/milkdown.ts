import type { MilkdownPlugin, Ctx } from "@milkdown/ctx";
import {
  editorViewCtx,
  commandsCtx,
  Editor,
  rootCtx,
  defaultValueCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { clipboard } from "@milkdown/plugin-clipboard";
import { cursor } from "@milkdown/plugin-cursor";
import { trailing } from "@milkdown/plugin-trailing";
import { mermaidBlockPlugin } from "./mermaidBlock";
import { $prose } from "@milkdown/utils";
import { nord } from "@milkdown/theme-nord";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { Node as PMNode } from "@milkdown/prose/model";
import { displaySrc, resolveNoteRef } from "../paths";
import "@milkdown/theme-nord/style.css";

export interface CreateWysiwygOptions {
  root: HTMLElement;
  markdown: string;
  vaultPath: string;
  noteRel: string;
  onMarkdown: (md: string) => void;
}

export interface EditorHandle {
  editor: Editor;
  destroy: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* 图片 NodeView：把笔记内相对路径解析成 privnote:// 可显示 URL          */
/* ------------------------------------------------------------------ */

class AssetImageView {
  dom: HTMLImageElement;
  private noteRel: string;

  constructor(node: PMNode, noteRel: string) {
    this.noteRel = noteRel;
    this.dom = document.createElement("img");
    this.dom.className = "pn-image";
    this.applyAttrs(node);
  }

  private applyAttrs(node: PMNode) {
    const raw = (node.attrs.src as string) || "";
    const alt = (node.attrs.alt as string) || "";
    if (this.dom.getAttribute("alt") !== alt) this.dom.setAttribute("alt", alt);
    const target = displaySrc(resolveNoteRef(this.noteRel, raw), raw);
    if (target && this.dom.getAttribute("src") !== target) {
      this.dom.setAttribute("src", target);
    }
  }

  update(node: PMNode): boolean {
    this.applyAttrs(node);
    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
  ignoreMutation(): boolean {
    return true;
  }
  stopEvent(): boolean {
    return true;
  }
}

function imageNodeViewPlugin(noteRel: string): MilkdownPlugin {
  return $prose(
    () =>
      new Plugin({
        props: {
          nodeViews: {
            image: (node: PMNode) => new AssetImageView(node, noteRel),
          },
        },
      }),
  );
}

/* ------------------------------------------------------------------ */
/* 双链文本装饰：把 [[...]] 高亮（不改动文档结构，纯展示）                */
/* ------------------------------------------------------------------ */

function wikiDecoPlugin(): MilkdownPlugin {
  const key = new PluginKey("pn-wiki-deco");
  return $prose(
    () =>
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const re = /\[\[([^\[\]\n]+?)\]\]/g;
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              const text = node.text ?? "";
              re.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = re.exec(text))) {
                const from = pos + m.index;
                const to = from + m[0].length;
                const title = m[1].split("|")[0].split("#")[0].trim();
                if (!title) continue;
                decos.push(
                  Decoration.inline(from, to, {
                    class: "pn-wiki",
                    "data-wiki": title,
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
  );
}

/* ------------------------------------------------------------------ */
/* 创建编辑器                                                           */
/* ------------------------------------------------------------------ */

export async function createWysiwyg(opts: CreateWysiwygOptions): Promise<EditorHandle> {
  const { root, markdown, noteRel, onMarkdown } = opts;

  const editor = Editor.make()
    .config((ctx: Ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.get(listenerCtx).markdownUpdated((_ctx, md, prev) => {
        if (md !== prev) onMarkdown(md);
      });
    })
    .config(nord)
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(cursor)
    .use(trailing)
    .use(imageNodeViewPlugin(noteRel))
    .use(wikiDecoPlugin())
    .use(mermaidBlockPlugin());

  await editor.create();
  return {
    editor,
    destroy: async () => {
      await editor.destroy();
    },
  };
}

/* ------------------------------------------------------------------ */
/* 工具栏动作                                                          */
/* ------------------------------------------------------------------ */

export function callCommand(
  editor: Editor,
  cmd: { key: unknown },
  payload?: unknown,
) {
  editor.action((ctx: Ctx) => {
    ctx.get(commandsCtx).call(cmd.key as never, payload as never);
  });
}

export function focusEditor(editor: Editor) {
  editor.action((ctx: Ctx) => {
    ctx.get(editorViewCtx)?.focus();
  });
}

/** 取光标前 n 个字符的纯文本（用于 [[ 自动触发检测）。 */
export function selectionTextSuffix(editor: Editor, n: number): string {
  let suffix = "";
  editor.action((ctx: Ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return;
    const from = view.state.selection.from;
    suffix = view.state.doc.textBetween(Math.max(0, from - n), from, "\n", " ");
  });
  return suffix;
}

/** 在光标处插入纯文本。 */
export function insertText(editor: Editor, text: string) {
  editor.action((ctx: Ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return;
    const tr = view.state.tr.insertText(text);
    view.dispatch(tr);
    view.focus();
  });
}

/** 在光标处插入图片节点。 */
export function insertImage(editor: Editor, src: string, alt = "") {
  editor.action((ctx: Ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return;
    // 直接以相对路径作为 src（NodeView 负责显示解析）
    const node = view.state.schema.nodes.image.create({ src, alt });
    const tr = view.state.tr.replaceSelectionWith(node);
    view.dispatch(tr);
    view.focus();
  });
}
