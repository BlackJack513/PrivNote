// DeepSeek(OpenAI 兼容) 智能体：工具调用循环 + Markdown 渲染工具。
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";

export const AI_DEFAULT_BASE = "https://api.deepseek.com";
export const AI_MODEL_SUGGESTIONS = [
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
];

marked.setOptions({ gfm: true, breaks: true });

export interface ToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

/** OpenAI 风格聊天消息（可含 tool_calls / tool 回执）。 */
export interface RawMsg {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatResult {
  content: string | null;
  tool_calls: ToolCall[] | null;
}

/** 由 Rust 代理调用 /chat/completions，返回完整 assistant message。 */
export async function aiChatRaw(messages: RawMsg[], tools?: unknown): Promise<ChatResult> {
  const msg = await invoke<{
    content?: string | null;
    tool_calls?: ToolCall[] | null;
  }>("ai_chat", {
    messages,
    ...(tools ? { tools } : {}),
  });
  return { content: msg.content ?? null, tool_calls: msg.tool_calls ?? null };
}

/** 简单一问一答（“写一篇”等场景）。 */
export async function chatCompletion(messages: RawMsg[]): Promise<string> {
  const res = await aiChatRaw(messages);
  if (res.content && res.content.trim()) return res.content.trim();
  throw new Error("AI 返回内容为空，请重试");
}

export const AI_SYSTEM_PROMPT = `你嵌入在 PrivNote（本地 Markdown 知识管理应用）中，是用户的写作与研究助手。
- 用简体中文与用户交流，除非用户明确要求其它语言。
- 输出 Markdown 正文即可，除非用户要求，不要在回复外套 \`\`\`markdown 代码围栏。
- 你可以使用工具：
  · search_web / fetch_url：联网查资料（可结合用户问题先搜索再回答）。
  · current_note：看当前打开的笔记；read_note：在征得用户同意后读取其它笔记。
  · create_note：新建笔记并填充内容；update_note：修改现有笔记（会先给用户预览审批）。
- 读其它笔记、新建/修改都会先征求用户同意，被拒绝时不要重复尝试。
- 修改笔记时请用 read_note 先读取原文，再通过 update_note 返回改好的全文。`;

/* ---------------- 工具声明（JSON Schema） ---------------- */

export const AGENT_TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "在互联网上搜索关键词，返回若干网页结果（标题/链接/摘要）。适合查最新资料、教程、新闻。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词，尽量简短具体（中文英文均可）" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "抓取指定网页的正文文本。当搜索结果或用户给出具体网址时使用。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "完整 http(s) 网址" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "current_note",
      description: "获取当前正在编辑的笔记内容。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notes",
      description: "列出笔记库内全部笔记的标题与相对路径。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description: "读取某篇笔记的内容。参数 target 可以是笔记标题或相对路径；读取其它笔记前会先征求用户同意。",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "笔记标题或相对路径，如“React 笔记”或“notes/react.md”" },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_note",
      description: "新建一篇 Markdown 笔记并填充完整内容（会先让用户预览确认后才真正创建）。folder 为库内相对目录，空表示根目录。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "笔记名称（不含扩展名）" },
          folder: { type: "string", description: "存放目录（库内相对路径，默认根目录）" },
          content: { type: "string", description: "完整的 Markdown 内容" },
        },
        required: ["name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_note",
      description: "把某篇笔记整篇替换为新内容（会向用户展示改动 diff 并获得批准后才保存）。rel 为目标笔记标题或相对路径，请先 read_note 拿到原文。",
      parameters: {
        type: "object",
        properties: {
          rel: { type: "string", description: "要修改的笔记标题或相对路径" },
          content: { type: "string", description: "修改后的完整 Markdown 内容" },
          summary: { type: "string", description: "给用户看的一句话改动说明（可选）" },
        },
        required: ["rel", "content"],
      },
    },
  },
];

/** 把笔记内容包装进 user 消息（附上当前笔记）。 */
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

/** 把内容安全转为文件名。 */
export function sanitizeFileName(raw: string, fallback = "AI 笔记"): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/** 从 Markdown 提取第一个一级标题作为默认文件名。 */
export function defaultNameFromMd(md: string, fallback = "AI 笔记"): string {
  const m = /^#\s+(.+)$/m.exec(md.trim());
  if (m && m[1].trim()) return sanitizeFileName(m[1].trim(), fallback);
  return fallback;
}
