import { create } from "zustand";
import { api, errMsg } from "./lib/api";
import { baseName, dirOf } from "./lib/paths";
import { summarizeLinksOut } from "./lib/wiki";
import type {
  AppConfig,
  Backlink,
  EditorMode,
  ModalState,
  NoteRef,
  SearchHit,
  TabState,
  TreeNode,
  WikiLinkOut,
} from "./lib/types";

interface Toast {
  id: number;
  msg: string;
  kind: "info" | "ok" | "error";
}

interface StoreState {
  phase: "loading" | "welcome" | "ready";
  vaultPath: string | null;
  vaultName: string;
  tree: TreeNode | null;
  notes: NoteRef[];
  notesReady: boolean;

  tabs: TabState[];
  activeRel: string | null;
  expanded: Record<string, boolean>;

  modal: ModalState | null;
  toast: Toast | null;

  searchQuery: string;
  searching: boolean;
  searchResults: SearchHit[] | null;

  backlinks: Backlink[];
  linksOut: WikiLinkOut[];

  showRight: boolean;
  setShowRight: (v: boolean) => void;

  showAi: boolean;
  setShowAi: (v: boolean) => void;

  // actions
  init: () => Promise<void>;
  openVault: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  refreshNotes: () => Promise<void>;

  toggleExpand: (rel: string) => void;

  openNote: (rel: string, mode?: EditorMode) => Promise<void>;
  closeTab: (rel: string) => Promise<void>;
  activateTab: (rel: string) => void;
  setTabMode: (rel: string, mode: EditorMode) => void;
  setContent: (rel: string, content: string) => void;
  appendToActive: (md: string) => boolean;
  flushAll: () => Promise<void>;
  flushRel: (rel: string) => Promise<void>;

  runSearch: (q: string) => Promise<void>;
  clearSearch: () => void;
  refreshRelations: () => Promise<void>;

  jumpToWiki: (title: string) => void;
  createNoteAction: (folder: string, name: string, content?: string) => Promise<string | null>;
  createFolderAction: (folder: string, name: string) => Promise<string | null>;
  renameAction: (rel: string, newName: string) => Promise<boolean>;
  deleteAction: (rels: string[]) => Promise<boolean>;
  importAction: (parent: string, absPaths: string[]) => Promise<string[]>;

  setModal: (m: ModalState | null) => void;
  toastShow: (msg: string, kind?: Toast["kind"]) => void;
}

let toastSeq = 0;
let toastTimer: number | undefined;
const saveTimers = new Map<string, number>();
const relVersions = new Map<string, number>();

function initialContentFor(name: string): string {
  const title = name.replace(/\.(md|markdown)$/i, "");
  return `# ${title}\n\n`;
}

export const useStore = create<StoreState>()((set, get) => {
  const tabIndex = (rel: string) => get().tabs.findIndex((t) => t.rel === rel);

  const scheduleSave = (rel: string) => {
    const prev = saveTimers.get(rel);
    if (prev) window.clearTimeout(prev);
    const v = (relVersions.get(rel) ?? 0) + 1;
    relVersions.set(rel, v);
    const timer = window.setTimeout(() => {
      void get().flushRel(rel);
    }, 600);
    saveTimers.set(rel, timer);
  };

  const refreshRelations = async () => {
    const { vaultPath, tabs, activeRel, notes } = get();
    if (!vaultPath || !activeRel) {
      set({ backlinks: [], linksOut: [] });
      return;
    }
    const tab = tabs.find((t) => t.rel === activeRel);
    if (!tab) return;
    const existing = new Set(notes.map((n) => n.title.toLowerCase()));
    const linksOut = summarizeLinksOut(tab.content, existing);
    set({ linksOut });
    try {
      const backlinks = await api.backlinks(vaultPath, activeRel);
      set({ backlinks });
    } catch (e) {
      set({ backlinks: [] });
      console.warn(errMsg(e));
    }
  };

  const refreshNotes = async () => {
    const { vaultPath } = get();
    if (!vaultPath) return;
    try {
      const notes = await api.listNotes(vaultPath);
      set({ notes, notesReady: true });
    } catch (e) {
      console.warn(errMsg(e));
    }
  };

  return {
    phase: "loading",
    vaultPath: null,
    vaultName: "",
    tree: null,
    notes: [],
    notesReady: false,
    tabs: [],
    activeRel: null,
    expanded: {},
    modal: null,
    toast: null,
    searchQuery: "",
    searching: false,
    searchResults: null,
    backlinks: [],
    linksOut: [],
    showRight: true,
    setShowRight: (v) => set({ showRight: v }),

    showAi: false,
    setShowAi: (v) => set({ showAi: v }),

    init: async () => {
      try {
        const cfg: AppConfig = await api.getConfig();
        if (cfg.lastVault) {
          try {
            await get().openVault(cfg.lastVault);
            return;
          } catch (e) {
            console.warn("上次笔记库打不开：", errMsg(e));
          }
        }
      } catch (e) {
        console.warn(errMsg(e));
      }
      set({ phase: "welcome" });
    },

    openVault: async (path) => {
      set({ phase: "loading" });
      try {
        const tree = await api.openVault(path);
        const vaultName = tree.name || path.split(/[\\/]/).filter(Boolean).pop() || "笔记库";
        set({
          phase: "ready",
          vaultPath: path,
          vaultName,
          tree,
          tabs: [],
          activeRel: null,
          expanded: {},
          searchResults: null,
          searchQuery: "",
          backlinks: [],
          linksOut: [],
          modal: null,
        });
        void api.setLastVault(path).catch((e) => console.warn(errMsg(e)));
        await refreshNotes();
      } catch (e) {
        set({ phase: "welcome" });
        get().toastShow(`打开笔记库失败：${errMsg(e)}`, "error");
      }
    },

    refreshTree: async () => {
      const { vaultPath } = get();
      if (!vaultPath) return;
      try {
        const tree = await api.listTree(vaultPath);
        set({ tree });
      } catch (e) {
        get().toastShow(`刷新失败：${errMsg(e)}`, "error");
      }
    },

    refreshNotes,

    toggleExpand: (rel) => {
      set((s) => ({ expanded: { ...s.expanded, [rel]: !s.expanded[rel] } }));
    },

    openNote: async (rel, mode = "wysiwyg") => {
      const { vaultPath, tabs } = get();
      if (!vaultPath) return;
      const exist = tabs.find((t) => t.rel === rel);
      if (exist) {
        if (mode && exist.mode !== mode) get().setTabMode(rel, mode);
        set({ activeRel: rel });
        void refreshRelations();
        return;
      }
      try {
        const content = await api.readNote(vaultPath, rel);
        const tab: TabState = {
          rel,
          name: baseName(rel),
          mode,
          content,
          savedContent: content,
          dirty: false,
          saving: false,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeRel: rel }));
        void refreshRelations();
      } catch (e) {
        get().toastShow(`打开笔记失败：${errMsg(e)}`, "error");
      }
    },

    closeTab: async (rel) => {
      await get().flushRel(rel);
      set((s) => {
        const i = s.tabs.findIndex((t) => t.rel === rel);
        if (i < 0) return {};
        const tabs = s.tabs.filter((t) => t.rel !== rel);
        let activeRel = s.activeRel;
        if (activeRel === rel) {
          const next = tabs[Math.min(i, tabs.length - 1)];
          activeRel = next ? next.rel : null;
        }
        return { tabs, activeRel };
      });
      void refreshRelations();
    },

    activateTab: (rel) => {
      set({ activeRel: rel });
      void refreshRelations();
    },

    setTabMode: (rel, mode) => {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.rel === rel ? { ...t, mode } : t)),
      }));
    },

    setContent: (rel, content) => {
      const i = tabIndex(rel);
      if (i < 0) return;
      const t = get().tabs[i];
      if (t.content === content) return;
      set((s) => ({
        tabs: s.tabs.map((tab, idx) =>
          idx === i ? { ...tab, content, dirty: content !== tab.savedContent } : tab,
        ),
      }));
      scheduleSave(rel);
    },

    appendToActive: (md) => {
      const { tabs, activeRel } = get();
      const i = tabs.findIndex((t) => t.rel === activeRel);
      if (i < 0 || !md.trim()) return false;
      const cur = tabs[i].content;
      const sep = cur.endsWith("\n") ? "\n" : "\n\n";
      const next = cur.trimEnd() + sep + md.trim() + "\n";
      set((s) => ({
        tabs: s.tabs.map((tab, idx) =>
          idx === i ? { ...tab, content: next, dirty: next !== tab.savedContent } : tab,
        ),
      }));
      scheduleSave(activeRel!);
      return true;
    },

    flushRel: async (rel) => {
      const i = tabIndex(rel);
      if (i < 0) return;
      const timer = saveTimers.get(rel);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.delete(rel);
      }
      const t = get().tabs[i];
      if (!t.dirty || t.content === t.savedContent) return;
      const vaultPath = get().vaultPath;
      if (!vaultPath) return;
      const written = t.content;
      set((s) => ({
        tabs: s.tabs.map((tab, idx) =>
          idx === i ? { ...tab, saving: true } : tab,
        ),
      }));
      try {
        await api.writeNote(vaultPath, rel, written);
        set((s) => ({
          tabs: s.tabs.map((tab, idx) => {
            if (idx !== i) return tab;
            const stillChanged = tab.content !== written;
            return {
              ...tab,
              savedContent: stillChanged ? tab.savedContent : written,
              dirty: stillChanged,
              saving: false,
            };
          }),
        }));
        void refreshRelations();
      } catch (e) {
        set((s) => ({
          tabs: s.tabs.map((tab, idx) =>
            idx === i ? { ...tab, saving: false } : tab,
          ),
        }));
        get().toastShow(`自动保存失败：${errMsg(e)}`, "error");
      }
    },

    flushAll: async () => {
      const rels = get()
        .tabs.filter((t) => t.dirty)
        .map((t) => t.rel);
      await Promise.all(rels.map((r) => get().flushRel(r)));
    },

    runSearch: async (q) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return;
      const query = q.trim();
      const changed = get().searchQuery !== q;
      set({ searchQuery: q });
      if (!query) {
        set({ searchResults: null, searching: false });
        return;
      }
      set({ searching: true, ...(changed ? { searchResults: null } : {}) });
      try {
        const hits = await api.search(vaultPath, query);
        set({ searchResults: hits, searching: false });
      } catch (e) {
        set({ searching: false });
        get().toastShow(`搜索失败：${errMsg(e)}`, "error");
      }
    },

    clearSearch: () => {
      set({ searchQuery: "", searchResults: null, searching: false });
    },

    refreshRelations,

    jumpToWiki: (title) => {
      const t = title.trim();
      if (!t) return;
      const notes = get().notes;
      const found = notes.find((n) => n.title.toLowerCase() === t.toLowerCase());
      if (found) {
        void get().openNote(found.rel);
      } else {
        const activeRel = get().activeRel;
        set({
          modal: {
            kind: "wikiCreate",
            target: t,
            folder: activeRel ? dirOf(activeRel) : "",
          },
        });
      }
    },

    createNoteAction: async (folder, name, content) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return null;
      try {
        const rel = await api.createNote(
          vaultPath,
          folder,
          name,
          content ?? initialContentFor(name),
        );
        await get().refreshTree();
        await refreshNotes();
        await get().openNote(rel);
        return rel;
      } catch (e) {
        get().toastShow(`新建失败：${errMsg(e)}`, "error");
        return null;
      }
    },

    createFolderAction: async (folder, name) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return null;
      try {
        const rel = await api.createFolder(vaultPath, folder, name);
        await get().refreshTree();
        return rel;
      } catch (e) {
        get().toastShow(`新建文件夹失败：${errMsg(e)}`, "error");
        return null;
      }
    },

    renameAction: async (rel, newName) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return false;
      try {
        const newRel = await api.renameEntry(vaultPath, rel, newName);
        // 同步已打开的标签页
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.rel === rel) return { ...t, rel: newRel, name: baseName(newRel) };
            if (rel && t.rel.startsWith(rel + "/")) {
              const sub = t.rel.slice(rel.length);
              const nr = newRel + sub;
              return { ...t, rel: nr, name: baseName(nr) };
            }
            return t;
          }),
          activeRel:
            s.activeRel === rel || s.activeRel?.startsWith(rel + "/")
              ? newRel + (s.activeRel!.slice(rel.length) || "")
              : s.activeRel,
        }));
        await get().refreshTree();
        await refreshNotes();
        return true;
      } catch (e) {
        get().toastShow(`重命名失败：${errMsg(e)}`, "error");
        return false;
      }
    },

    deleteAction: async (rels) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return false;
      try {
        await api.deleteEntries(vaultPath, rels);
        // 关闭相关标签
        set((s) => {
          const doomed = new Set<string>();
          for (const r of rels) {
            doomed.add(r);
            for (const t of s.tabs) {
              if (t.rel.startsWith(r + "/")) doomed.add(t.rel);
            }
          }
          const tabs = s.tabs.filter((t) => !doomed.has(t.rel));
          let activeRel = s.activeRel;
          if (activeRel && doomed.has(activeRel)) {
            activeRel = tabs.length ? tabs[tabs.length - 1].rel : null;
          }
          return { tabs, activeRel };
        });
        await get().refreshTree();
        await refreshNotes();
        return true;
      } catch (e) {
        get().toastShow(`删除失败：${errMsg(e)}`, "error");
        return false;
      }
    },

    importAction: async (parent, absPaths) => {
      const vaultPath = get().vaultPath;
      if (!vaultPath) return [];
      try {
        const rels = await api.importFiles(vaultPath, parent, absPaths);
        await get().refreshTree();
        await refreshNotes();
        if (rels.length) {
          get().toastShow(`已导入 ${rels.length} 篇笔记`, "ok");
          await get().openNote(rels[0]);
        }
        return rels;
      } catch (e) {
        get().toastShow(`导入失败：${errMsg(e)}`, "error");
        return [];
      }
    },

    setModal: (m) => set({ modal: m }),

    toastShow: (msg, kind = "info") => {
      toastSeq += 1;
      const id = toastSeq;
      if (toastTimer) window.clearTimeout(toastTimer);
      set({ toast: { id, msg, kind } });
      toastTimer = window.setTimeout(() => {
        set((s) => (s.toast?.id === id ? { toast: null } : {}));
      }, 3600);
    },
  };
});
