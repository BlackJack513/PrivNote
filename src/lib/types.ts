// 与 Rust 侧 serde(rename_all="camelCase") 对应的数据类型。

export interface TreeNode {
  name: string;
  rel: string;
  isDir: boolean;
  children: TreeNode[];
}

export interface LineHit {
  num: number;
  text: string;
}

export interface SearchHit {
  rel: string;
  name: string;
  lines: LineHit[];
}

export interface Backlink {
  rel: string;
  name: string;
  lines: LineHit[];
}

export interface NoteRef {
  rel: string;
  title: string;
}

export interface AppConfig {
  lastVault?: string | null;
}

export interface AiSettingsView {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
}

export interface AiMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export type EditorMode = "wysiwyg" | "source";

export interface TabState {
  rel: string;
  name: string;
  mode: EditorMode;
  content: string; // 当前编辑缓冲区（markdown 文本）
  savedContent: string; // 已落盘时的内容快照
  dirty: boolean;
  saving: boolean;
}

export interface WikiLinkOut {
  key: string;
  display: string;
  count: number;
  exists: boolean;
  rel?: string;
}

export interface ModalState {
  kind:
    | "newNote"
    | "newFolder"
    | "rename"
    | "confirmDelete"
    | "wikiCreate"
    | "switchVault"
    | "aiSettings";
  folder?: string; // 新建/导入目标文件夹（vault 相对路径）
  rel?: string; // rename / delete 目标
  prefill?: string; // 新建笔记预填名称
  target?: string; // wikiCreate: [[目标]]
}
