import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettingsView,
  AppConfig,
  Backlink,
  NoteRef,
  SearchHit,
  TreeNode,
} from "./types";

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  setLastVault: (vault: string) => invoke<void>("set_last_vault", { vault }),

  aiGetSettings: () => invoke<AiSettingsView>("ai_get_settings"),
  aiSetSettings: (
    baseUrl: string,
    model: string,
    apiKey?: string | null, // null => 清除; undefined => 保持
  ) =>
    invoke<void>("ai_set_settings", {
      baseUrl,
      model,
      ...(apiKey === undefined ? {} : { apiKey }),
    }),

  openVault: (vault: string) => invoke<TreeNode>("open_vault", { vault }),
  listTree: (vault: string) => invoke<TreeNode>("list_tree", { vault }),

  createNote: (vault: string, parent: string, name: string, content: string) =>
    invoke<string>("create_note", { vault, parent, name, content }),
  createFolder: (vault: string, parent: string, name: string) =>
    invoke<string>("create_folder", { vault, parent, name }),
  renameEntry: (vault: string, rel: string, newName: string) =>
    invoke<string>("rename_entry", { vault, rel, newName }),
  deleteEntries: (vault: string, rels: string[]) =>
    invoke<void>("delete_entries", { vault, rels }),

  readNote: (vault: string, rel: string) =>
    invoke<string>("read_note", { vault, rel }),
  writeNote: (vault: string, rel: string, content: string) =>
    invoke<void>("write_note", { vault, rel, content }),

  importFiles: (vault: string, parent: string, paths: string[]) =>
    invoke<string[]>("import_files", { vault, parent, paths }),
  saveImage: (vault: string, noteRel: string, fileName: string, data: string) =>
    invoke<string>("save_image", { vault, noteRel, fileName, data }),
  importImageFile: (vault: string, noteRel: string, absPath: string) =>
    invoke<string>("import_image_file", { vault, noteRel, absPath }),

  search: (vault: string, query: string) =>
    invoke<SearchHit[]>("search", { vault, query }),
  backlinks: (vault: string, noteRel: string) =>
    invoke<Backlink[]>("backlinks", { vault, noteRel }),
  listNotes: (vault: string) => invoke<NoteRef[]>("list_notes", { vault }),

  reveal: (vault: string, rel: string) =>
    invoke<void>("reveal_in_explorer", { vault, rel }),

  webFetch: (url: string) =>
    invoke<{ title: string; text: string; url: string }>("web_fetch", { url }),
  webSearch: (query: string) =>
    invoke<{ title: string; url: string; snippet: string }[]>("web_search", { query }),
};
