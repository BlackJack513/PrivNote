// Milkdown code_block 自定义视图：语言为 mermaid 时在代码块下方实时渲染图。
import type { MilkdownPlugin } from "@milkdown/ctx";
import { $prose } from "@milkdown/utils";
import type { Node as PMNode } from "@milkdown/prose/model";
import { Plugin } from "@milkdown/prose/state";

let mermaidPromise: Promise<{ render: (id: string, code: string) => Promise<{ svg: string }> }> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mm = (mod as { default?: unknown }).default ?? mod;
      const api = mm as {
        initialize: (cfg: unknown) => void;
        render: (id: string, code: string) => Promise<{ svg: string }>;
      };
      api.initialize({ startOnLoad: false, securityLevel: "strict" });
      return { render: api.render.bind(api) };
    });
  }
  return mermaidPromise;
}

let renderChain: Promise<void> = Promise.resolve();
let seq = 0;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 串行渲染，避免 mermaid 并发冲突。 */
function queueMermaidRender(preview: HTMLElement, code: string) {
  seq += 1;
  const id = `pn-mermaid-${seq}`;
  renderChain = renderChain.then(async () => {
    try {
      const api = await loadMermaid();
      const { svg } = await api.render(id, code);
      preview.innerHTML = svg;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      preview.innerHTML = `<div class="pn-mermaid-error">Mermaid 解析失败：${escapeHtml(msg)}</div>`;
    }
  });
  return renderChain;
}

class MermaidCodeBlockView {
  dom: HTMLDivElement;
  contentDOM: HTMLElement;
  private preview: HTMLDivElement;
  private lang = "";
  private lastText = "";
  private timer: number | undefined;
  private destroyed = false;

  constructor(node: PMNode) {
    this.dom = document.createElement("div");
    this.dom.className = "pn-codeblock";

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    this.contentDOM = code;
    pre.appendChild(code);
    this.dom.appendChild(pre);

    this.preview = document.createElement("div");
    this.preview.className = "pn-mermaid-preview";
    this.dom.appendChild(this.preview);

    this.applyNode(node, true);
  }

  private applyNode(node: PMNode, immediate: boolean) {
    const attrs = node.attrs as { language?: string };
    const lang = (attrs.language ?? "").trim();
    const text = node.textContent ?? "";

    if (lang !== this.lang) {
      this.lang = lang;
      this.contentDOM.classList.remove(`language-${this.lang}`);
      this.contentDOM.classList.remove("language-mermaid");
      this.contentDOM.className = "";
      if (lang) this.contentDOM.classList.add(`language-${lang}`);
      this.dom.classList.toggle("pn-has-preview", lang === "mermaid");
      if (lang !== "mermaid") {
        this.preview.innerHTML = "";
      }
    }
    if (this.lang !== "mermaid") return;

    if (immediate) {
      if (text.trim() && text !== this.lastText) {
        this.lastText = text;
        void queueMermaidRender(this.preview, text);
      }
      return;
    }

    if (text.trim() && text !== this.lastText) {
      this.lastText = text;
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        if (this.destroyed) return;
        void queueMermaidRender(this.preview, text);
      }, 450);
    }
  }

  update(node: PMNode): boolean {
    this.applyNode(node, false);
    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  ignoreMutation(m: unknown): boolean {
    // 预览区/SVG 的任何变化都不算文档编辑
    const target =
      m && typeof m === "object"
        ? (m as { target?: Node | null }).target
        : null;
    if (target && (target === this.preview || this.preview.contains(target))) return true;
    return false;
  }

  stopEvent(e: Event): boolean {
    // 点击/操作预览区时不进入 PM 编辑
    const t = e.target as Node | null;
    return !!t && (t === this.preview || this.preview.contains(t));
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.preview.innerHTML = "";
  }
}

export function mermaidBlockPlugin(): MilkdownPlugin {
  return $prose(
    () =>
      new Plugin({
        props: {
          nodeViews: {
            code_block: (node: PMNode) => new MermaidCodeBlockView(node),
          },
        },
      }),
  );
}
