// DeepSeek(OpenAI 兼容) 调用与 Markdown 渲染工具。
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { AiMsg } from "./types";

export const AI_DEFAULT_BASE = "https://api.deepseek.com";
export const AI_MODEL_SUGGESTIONS = [
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
];

marked.setOptions({ gfm: true, breaks: true });

/** 由 Rust 代理调用 /chat/completions（非流式），返回助手文本。 */
export async function chatCompletion(messages: AiMsg[]): Promise<string> {
  return invoke<string>("ai_chat", { messages });
}

export const AI_SYSTEM_PROMPT = `你嵌入在 PrivNote（本地 Markdown 知识管理应用）中，是用户的写作助手。
- 用简体中文与用户交流，除非用户明确要求其它语言。
- 内容相关输出一律使用 Markdown 语法；生成整篇笔记时要结构清晰（标题、小节、列表、代码块、表格等）。
- 除非用户要求，不要在回复里套一层 \`\`\`markdown 代码围栏，直接输出 Markdown 正文。
- 用户附上「当前笔记」时，请结合笔记内容回答（续写、改写、总结、纠错、扩写等）。`;

/** 把笔记内容包装进 user 消息。 */
export function wrapNoteContext(instruction: string, noteContent: string | null): string {
  const head = instruction.trim();
  if (!noteContent || !noteContent.trim()) return head || "（没有附带内容）";
  const capped =
    noteContent.length > 40000
      ? noteContent.slice(0, 40000) + "\n\n…（笔记过长已截断）"
      : noteContent;
  const sep = head ? "\n\n" : "";
  return `${head}${sep}【当前笔记内容】\n\`\`\`markdown\n${capped}\n\`\`\``;
}

/** 生成整篇笔记的 user 指令。 */
export function generateNotePrompt(topic: string): string {
  return `请围绕下面的主题，帮我写一篇结构完整、可直接保存的 Markdown 学习笔记（包含合理的标题层级、要点、示例，篇幅适中）：
${topic}`;
}

export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

/** 把内容安全转为文件名（去掉非法字符）。 */
export function sanitizeFileName(raw: string, fallback = "AI 笔记"): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/** 从 Markdown 文本提取第一个一级标题作为默认文件名。 */
export function defaultNameFromMd(md: string, fallback = "AI 笔记"): string {
  const m = /^#\s+(.+)$/m.exec(md.trim());
  if (m && m[1].trim()) return sanitizeFileName(m[1].trim(), fallback);
  return fallback;
}
