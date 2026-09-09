// Milkdown code_block 自定义视图：语言为 mermaid 时在代码块下方实时渲染图，并提供全屏查看（缩放/平移）。
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

/** 串行渲染到容器；成功返回 true，失败在容器里显示错误并返回 false。 */
function queueRenderInto(container: HTMLElement, code: string): Promise<boolean> {
  seq += 1;
  const id = `pn-mermaid-${seq}`;
  const p = renderChain.then(async () => {
    try {
      const api = await loadMermaid();
      const { svg } = await api.render(id, code);
      container.innerHTML = svg;
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      container.innerHTML = `<div class="pn-mermaid-error">Mermaid 解析失败：${escapeHtml(msg)}</div>`;
      return false;
    }
  });
  renderChain = p.then(() => undefined);
  return p;
}

/* ================= 全屏查看器（DOM 实现，滚轮缩放 + 拖拽平移） ================= */

class FullscreenViewer {
  private mask: HTMLDivElement | null = null;
  private stage: HTMLDivElement | null = null;
  private wrap: HTMLDivElement | null = null;
  private tx = 0;
  private ty = 0;
  private k = 1;
  private baseW = 0;
  private baseH = 0;
  private svgEl: SVGSVGElement | null = null;
  private raf = 0;
  private drag: { x: number; y: number; tx: number; ty: number } | null = null;
  private onKey: (e: KeyboardEvent) => void;
  private onWheel: (e: WheelEvent) => void;
  private onDown: (e: PointerEvent) => void;
  private onMove: (e: PointerEvent) => void;
  private onUp: (e: PointerEvent) => void;

  constructor(code: string) {
    const mask = document.createElement("div");
    mask.className = "pn-fs-mask";
    mask.innerHTML = `
      <div class="pn-fs-top">
        <span class="pn-fs-title">Mermaid 全屏</span>
        <div class="pn-fs-ctrl">
          <button data-act="out" title="缩小">−</button>
          <button data-act="reset" title="适应窗口">适应</button>
          <button data-act="in" title="放大">+</button>
          <button data-act="close" title="退出全屏 (Esc)">✕</button>
        </div>
      </div>
      <div class="pn-fs-stage"></div>
      <div class="pn-fs-tip">滚轮缩放 · 按住鼠标拖拽平移 · Esc 退出</div>`;
    document.body.appendChild(mask);

    const stage = mask.querySelector(".pn-fs-stage") as HTMLDivElement;
    const wrap = document.createElement("div");
    wrap.className = "pn-fs-wrap";
    const holder = document.createElement("div");
    holder.className = "pn-fs-holder";
    holder.innerHTML = `<div class="pn-mermaid-error">正在渲染…</div>`;
    wrap.appendChild(holder);
    stage.appendChild(wrap);

    mask.querySelectorAll(".pn-fs-ctrl button").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onAction((b as HTMLButtonElement).dataset.act ?? "");
      });
    });
    mask.addEventListener("pointerdown", (e) => {
      if (e.target === mask) this.close();
    });

    this.mask = mask;
    this.stage = stage;
    this.wrap = wrap;

    this.onKey = (e) => {
      if (e.key === "Escape") this.close();
      else if (e.key === "+" || e.key === "=") this.zoomAtCenter(1.3);
      else if (e.key === "-") this.zoomAtCenter(1 / 1.3);
      else if (e.key.toLowerCase() === "r") this.fit();
    };
    this.onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      this.zoomAt(e.clientX, e.clientY, factor);
    };
    this.onDown = (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      stage.setPointerCapture(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.drag) return;
      this.apply(
        this.drag.tx + (e.clientX - this.drag.x),
        this.drag.ty + (e.clientY - this.drag.y),
        this.k,
      );
    };
    this.onUp = () => {
      this.drag = null;
    };

    window.addEventListener("keydown", this.onKey);
    stage.addEventListener("wheel", this.onWheel, { passive: false });
    stage.addEventListener("pointerdown", this.onDown);
    stage.addEventListener("pointermove", this.onMove);
    stage.addEventListener("pointerup", this.onUp);
    stage.addEventListener("pointercancel", this.onUp);

    void queueRenderInto(holder, code).then(() => {
      this.svgEl = holder.querySelector("svg");
      this.measureBase();
      this.fit();
    });
  }

  /** 读取 SVG 自然像素尺寸作为缩放基准。 */
  private measureBase() {
    const svg = this.svgEl;
    if (!svg) return;
    svg.style.maxWidth = "none";
    svg.style.width = "";
    svg.style.height = "";
    if (this.wrap) this.wrap.style.transform = "";
    let nw = svg.getBoundingClientRect().width;
    let nh = svg.getBoundingClientRect().height;
    if (!(nw > 20 && nh > 20)) {
      const vb = svg.viewBox.baseVal;
      if (vb && vb.width > 0 && vb.height > 0) {
        nw = vb.width;
        nh = vb.height;
      } else {
        nw = 900;
        nh = 600;
      }
    }
    this.baseW = nw;
    this.baseH = nh;
  }

  /** 平移用 CSS translate；缩放改为重设 SVG 像素尺寸（矢量重绘，文字保持清晰）。 */
  private apply(tx: number, ty: number, k: number) {
    this.tx = tx;
    this.ty = ty;
    this.k = k;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.wrap) {
        this.wrap.style.transform = `translate(${tx}px, ${ty}px)`;
      }
      if (this.svgEl && this.baseW > 0) {
        this.svgEl.style.width = `${this.baseW * k}px`;
        this.svgEl.style.height = `${this.baseH * k}px`;
      }
    });
  }

  private onAction(act: string) {
    if (act === "in") this.zoomAtCenter(1.3);
    else if (act === "out") this.zoomAtCenter(1 / 1.3);
    else if (act === "reset") this.fit();
    else if (act === "close") this.close();
  }

  private zoomAtCenter(factor: number) {
    if (!this.stage) return;
    const r = this.stage.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  private zoomAt(cx: number, cy: number, factor: number) {
    if (!this.stage) return;
    const r = this.stage.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    const nk = Math.min(12, Math.max(0.05, this.k * factor));
    const wx = (px - this.tx) / this.k;
    const wy = (py - this.ty) / this.k;
    this.apply(px - wx * nk, py - wy * nk, nk);
  }

  /** 把图按真实尺寸重排并适配到窗口中央。 */
  private fit() {
    if (!this.stage || this.baseW <= 0) return;
    const r = this.stage.getBoundingClientRect();
    const vw = r.width;
    const vh = r.height;
    const k = Math.min((vw - 100) / this.baseW, (vh - 110) / this.baseH, 1.6);
    this.apply((vw - this.baseW * k) / 2, (vh - this.baseH * k) / 2, Math.max(k, 0.05));
  }

  close() {
    window.removeEventListener("keydown", this.onKey);
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.stage) {
      this.stage.removeEventListener("wheel", this.onWheel);
      this.stage.removeEventListener("pointerdown", this.onDown);
      this.stage.removeEventListener("pointermove", this.onMove);
      this.stage.removeEventListener("pointerup", this.onUp);
      this.stage.removeEventListener("pointercancel", this.onUp);
    }
    this.mask?.remove();
    this.mask = null;
  }
}

/* ================= 代码块视图 ================= */

class MermaidCodeBlockView {
  dom: HTMLDivElement;
  contentDOM: HTMLElement;
  private preview: HTMLDivElement;
  private lang = "";
  private lastText = "";
  private timer: number | undefined;
  private destroyed = false;
  private viewer: FullscreenViewer | null = null;

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
      this.contentDOM.className = lang ? `language-${lang}` : "";
      this.dom.classList.toggle("pn-has-preview", lang === "mermaid");
      if (lang !== "mermaid") {
        this.preview.innerHTML = "";
        this.preview.style.display = "";
      }
    }
    if (this.lang !== "mermaid") return;
    if (!text.trim()) {
      this.preview.innerHTML = "";
      return;
    }
    if (text === this.lastText) return;

    this.lastText = text;
    if (immediate) {
      void this.renderNow(text);
    } else {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        if (this.destroyed) return;
        void this.renderNow(text);
      }, 450);
    }
  }

  private async renderNow(text: string) {
    const ok = await queueRenderInto(this.preview, text);
    if (ok && !this.destroyed) this.ensureFullscreenBtn();
  }

  private ensureFullscreenBtn() {
    if (this.preview.querySelector(".pn-fs-btn")) return;
    const btn = document.createElement("button");
    btn.className = "pn-fs-btn";
    btn.textContent = "全屏";
    btn.title = "全屏查看（滚轮缩放 / 拖拽平移 / Esc 退出）";
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.viewer?.close();
      this.viewer = new FullscreenViewer(this.lastText);
    });
    this.preview.appendChild(btn);
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
    const target =
      m && typeof m === "object"
        ? (m as { target?: Node | null }).target
        : null;
    if (target && (target === this.preview || this.preview.contains(target))) return true;
    return false;
  }

  stopEvent(e: Event): boolean {
    const t = e.target as Node | null;
    return !!t && (t === this.preview || this.preview.contains(t));
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.preview.innerHTML = "";
    this.viewer?.close();
    this.viewer = null;
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
