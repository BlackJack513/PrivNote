import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FilePlus2,
  LoaderCircle,
  Save,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api, errMsg } from "../lib/api";
import {
  AGENT_TOOLS,
  AI_SYSTEM_PROMPT,
  aiChatRaw,
  chatCompletion,
  defaultNameFromMd,
  generateNotePrompt,
  renderMarkdown,
  sanitizeFileName,
  type RawMsg,
  type ToolCall,
  wrapNoteContext,
} from "../lib/ai";
import { computeDiffRows } from "../lib/diffUtil";
import { dirOf } from "../lib/paths";
import { useStore } from "../store";

interface Msg {
  role: "user" | "assistant" | "step";
  content: string;
  error?: boolean;
}

type Tab = "chat" | "gen";

interface ReadAsk {
  rel: string;
  title: string;
}
interface CreateDraft {
  name: string;
  folder: string;
  content: string;
}
interface UpdateDraft {
  rel: string;
  title: string;
  original: string;
  proposed: string;
  summary?: string;
}

export default function AiPanel() {
  const toastShow = useStore((s) => s.toastShow);
  const setModal = useStore((s) => s.setModal);
  const setShowAi = useStore((s) => s.setShowAi);
  const tabs = useStore((s) => s.tabs);
  const activeRel = useStore((s) => s.activeRel);
  const vaultPath = useStore((s) => s.vaultPath);

  const activeTab = tabs.find((t) => t.rel === activeRel);

  const [settings, setSettings] = useState({ baseUrl: "", model: "", keySet: false });
  const [view, setView] = useState<Tab>("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [genResult, setGenResult] = useState<string | null>(null);

  const [saveName, setSaveName] = useState("");
  const [saveShowFor, setSaveShowFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- 智能体相关状态 ----
  const [allowReadAll, setAllowReadAll] = useState(false);
  const readOnceRef = useRef<Set<string>>(new Set());
  const [readAsk, setReadAsk] = useState<ReadAsk | null>(null);
  const readAskResolve = useRef<((ok: boolean) => void) | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const createResolve = useRef<((d: CreateDraft | null) => void) | null>(null);
  const [updateDraft, setUpdateDraft] = useState<UpdateDraft | null>(null);
  const updateResolve = useRef<
    ((d: { action: "approve" | "cancel" | "savedAs"; final?: string; rel?: string; folder?: string }) => void) | null
  >(null);

  const bodyRef = useRef<HTMLDivElement>(null);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api.aiGetSettings();
      const mapped = { baseUrl: s.baseUrl, model: s.model, keySet: s.apiKeySet };
      setSettings(mapped);
      return mapped;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [msgs, busy, view, genResult, readAsk]);

  const ensureKey = useCallback(async (): Promise<boolean> => {
    const s = await refreshSettings();
    if (!s || !s.keySet) {
      toastShow("请先在设置中填写 AI API Key", "info");
      setModal({ kind: "aiSettings" });
      return false;
    }
    return true;
  }, [refreshSettings, setModal, toastShow]);

  const openSettings = useCallback(() => setModal({ kind: "aiSettings" }), [setModal]);

  const push = useCallback((m: Msg) => {
    setMsgs((prev) => [...prev, m]);
  }, []);

  /* ---------- 工具执行（含授权与审批） ---------- */

  const resolveTarget = useCallback(async (target: string): Promise<{ rel: string; title: string } | null> => {
    if (!vaultPath) return null;
    const t = target.trim();
    const notes = await api.listNotes(vaultPath).catch(() => []);
    const direct = notes.find((n) => n.rel === t || n.rel.toLowerCase() === t.toLowerCase());
    if (direct) return { rel: direct.rel, title: direct.title };
    const byTitle = notes.filter((n) => n.title.toLowerCase() === t.toLowerCase());
    if (byTitle.length === 1) return { rel: byTitle[0].rel, title: byTitle[0].title };
    if (byTitle.length > 1) {
      const list = byTitle.map((n) => `「${n.title}」(${n.rel})`).join("、");
      throw new Error(`标题「${t}」对应多篇笔记：${list}，请用更具体的相对路径指定`);
    }
    return null;
  }, [vaultPath]);

  const askRead = useCallback((q: ReadAsk) => {
    return new Promise<boolean>((resolve) => {
      readAskResolve.current = resolve;
      setReadAsk(q);
    });
  }, []);

  const readNoteContent = useCallback(
    async (rel: string): Promise<string> => {
      const openTab = tabs.find((x) => x.rel === rel);
      if (openTab) return openTab.content;
      if (!vaultPath) throw new Error("尚未打开笔记库");
      return api.readNote(vaultPath, rel);
    },
    [tabs, vaultPath],
  );

  const execTool = useCallback(
    async (call: ToolCall): Promise<string> => {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        return "参数解析失败";
      }

      switch (name) {
        case "search_web": {
          const q = String(args.query ?? "").trim();
          if (!q) return "缺少搜索关键词";
          push({ role: "step", content: `🔎 正在联网搜索：${q}` });
          try {
            const res = await api.webSearch(q);
            if (!res.length) return "没有搜到结果，可换关键词或让用户提供网址后用 fetch_url";
            push({ role: "step", content: `🔎 搜索完成，共 ${res.length} 条结果` });
            return res
              .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
              .join("\n\n");
          } catch (e) {
            return `搜索失败：${errMsg(e)}`;
          }
        }
        case "fetch_url": {
          const url = String(args.url ?? "").trim();
          if (!url) return "缺少网址";
          push({ role: "step", content: `🌐 正在抓取网页：${url}` });
          try {
            const res = await api.webFetch(url);
            push({ role: "step", content: `🌐 已抓取：${res.title || url}` });
            return `标题：${res.title || url}\n\n${res.text}`;
          } catch (e) {
            return `抓取失败：${errMsg(e)}`;
          }
        }
        case "list_notes": {
          if (!vaultPath) return "尚未打开笔记库";
          const notes = await api.listNotes(vaultPath);
          if (!notes.length) return "笔记库还没有笔记";
          return notes.map((n) => `- ${n.title}（${n.rel}）`).join("\n");
        }
        case "current_note": {
          if (!activeRel || !activeTab) return "当前没有打开的笔记";
          push({ role: "step", content: `📄 读取当前笔记：${activeRel}` });
          return `【当前笔记 ${activeRel}】\n${activeTab.content.slice(0, 40000)}`;
        }
        case "read_note": {
          const target = String(args.target ?? "").trim();
          if (!target) return "缺少笔记名称";
          let found: { rel: string; title: string } | null = null;
          try {
            found = await resolveTarget(target);
          } catch (e) {
            return String(e);
          }
          if (!found) return `笔记库中找不到「${target}」（可先用 list_notes 查看有哪些笔记）`;
          const autoOk =
            found.rel === activeRel ||
            allowReadAll ||
            readOnceRef.current.has(found.rel);
          if (!autoOk) {
            const ok = await askRead({ rel: found.rel, title: found.title });
            if (!ok) {
              push({ role: "step", content: `🚫 用户拒绝了读取「${found.title}」` });
              return `用户拒绝了本次读取，请勿再尝试读取该笔记`;
            }
            readOnceRef.current.add(found.rel);
          }
          push({ role: "step", content: `📖 已读取笔记：${found.title}${autoOk ? "" : "（已获许可）"}` });
          const content = await readNoteContent(found.rel);
          return `【笔记：${found.rel}】\n${content.slice(0, 40000)}`;
        }
        case "create_note": {
          const name = sanitizeFileName(String(args.name ?? ""), "新笔记");
          const folder = String(args.folder ?? "").trim().replace(/^\/+|\/+$/g, "");
          const content = String(args.content ?? "").trim();
          if (!content) return "内容为空，无法创建";
          const decision = await new Promise<CreateDraft | null>((resolve) => {
            createResolve.current = resolve;
            setCreateDraft({ name, folder, content });
          });
          if (!decision) {
            push({ role: "step", content: "🚫 用户取消了新建笔记" });
            return "用户取消了新建笔记";
          }
          push({ role: "step", content: `✍️ 正在创建笔记：${decision.name}` });
          const rel = await useStore
            .getState()
            .createNoteAction(decision.folder, decision.name, decision.content);
          if (!rel) return "创建失败（可能同名文件已存在，换一个名字重试）";
          push({ role: "step", content: `✅ 已创建并打开：${rel}` });
          return `笔记已创建：${rel}`;
        }
        case "update_note": {
          const relArg = String(args.rel ?? "").trim();
          const proposed = String(args.content ?? "");
          if (!relArg || !proposed.trim()) return "缺少目标笔记或新内容";
          let found: { rel: string; title: string } | null = null;
          try {
            found = await resolveTarget(relArg);
          } catch (e) {
            return String(e);
          }
          if (!found) return `找不到笔记「${relArg}」`;
          const original = await readNoteContent(found.rel);
          const summary = args.summary ? String(args.summary) : undefined;
          const decision = await new Promise<{
            action: "approve" | "cancel" | "savedAs";
            final?: string;
            rel?: string;
            folder?: string;
          }>((resolve) => {
            updateResolve.current = resolve;
            setUpdateDraft({ rel: found!.rel, title: found!.title, original, proposed, summary });
          });
          if (decision.action === "cancel") {
            push({ role: "step", content: "🚫 用户放弃了修改" });
            return "用户放弃了对这篇笔记的修改";
          }
          if (decision.action === "savedAs" && decision.rel) {
            push({ role: "step", content: `✍️ 另存为新笔记：${decision.rel}` });
            return `已另存为新笔记：${decision.rel}`;
          }
          const finalContent = decision.final ?? proposed;
          const openTab = tabs.find((x) => x.rel === found!.rel);
          if (openTab) {
            useStore.getState().setContent(found!.rel, finalContent);
          } else if (vaultPath) {
            await api.writeNote(vaultPath, found!.rel, finalContent);
          }
          push({ role: "step", content: `✅ 已保存修改：${found!.title}` });
          return `已按用户批准的内容保存：${found!.rel}`;
        }
        default:
          return `未知工具：${name}`;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultPath, activeRel, activeTab, allowReadAll, resolveTarget, readNoteContent, askRead, push, tabs],
  );

  const runAgent = useCallback(
    async (userText: string) => {
      setErr(null);
      const noteContent = attach ? activeTab?.content ?? null : null;
      const userMsg = wrapNoteContext(userText, noteContent);
      push({ role: "user", content: userMsg });

      const history: RawMsg[] = [
        { role: "system", content: AI_SYSTEM_PROMPT },
        ...msgs
          .filter((m) => m.role !== "step" && !m.error)
          .slice(-16)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: userMsg },
      ];
      setInput("");

      let convo: RawMsg[] = history;
      for (let i = 0; i < 14; i++) {
        const res = await aiChatRaw(convo, AGENT_TOOLS);
        if (!res.tool_calls || res.tool_calls.length === 0) {
          if (res.content) push({ role: "assistant", content: res.content });
          return;
        }
        if (res.content) {
          push({ role: "assistant", content: res.content });
          convo = [...convo, { role: "assistant", content: res.content, tool_calls: res.tool_calls }];
        } else {
          convo = [...convo, { role: "assistant", content: null, tool_calls: res.tool_calls }];
        }
        for (const tc of res.tool_calls) {
          const out = await execTool(tc);
          convo = [...convo, { role: "tool", tool_call_id: tc.id, content: out }];
        }
      }
      push({ role: "assistant", content: "步骤过多已自动停止，你可以让我继续下一步。" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attach, activeTab, msgs, execTool, push],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!(await ensureKey())) return;
    setBusy(true);
    try {
      await runAgent(text);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
      setReadAsk(null);
    }
  }, [input, busy, ensureKey, runAgent]);

  const generate = useCallback(async () => {
    const text = topic.trim();
    if (!text || busy) return;
    if (!(await ensureKey())) return;
    setErr(null);
    setBusy(true);
    try {
      const reply = await chatCompletion([
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: generateNotePrompt(text) },
      ]);
      setGenResult(reply);
      setSaveShowFor(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [topic, busy, ensureKey]);

  const append = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      const ok = useStore.getState().appendToActive(content);
      if (ok) toastShow(`已追加到当前笔记`, "ok");
      else toastShow("当前没有打开可追加的笔记", "info");
    },
    [toastShow],
  );

  const keyReady = settings.keySet;
  const modelChip = settings.model || "deepseek-chat";

  /* ---------- 渲染 ---------- */
  return (
    <aside className="ai-col">
      <div className="ai-head">
        <Sparkles size={15} style={{ color: "var(--accent)" }} />
        <span className="ai-title">AI 助手</span>
        <span className={`ai-key-dot ${keyReady ? "ok" : ""}`} title={keyReady ? "已配置 API Key" : "尚未配置 API Key"} />
        <span className="ai-model" title={modelChip}>{modelChip}</span>
        <button className="icon-btn" title="AI 设置" onClick={openSettings}>
          <Settings size={15} />
        </button>
        <button className="icon-btn" title="收起 AI 面板" onClick={() => setShowAi(false)}>
          <X size={15} />
        </button>
      </div>

      <div className="ai-tabs">
        <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>对话</button>
        <button className={view === "gen" ? "active" : ""} onClick={() => setView("gen")}>写一篇</button>
      </div>

      {view === "chat" ? (
        <>
          <div className="ai-body" ref={bodyRef}>
            {msgs.length === 0 && (
              <div className="ai-empty">
                <Sparkles size={26} strokeWidth={1.4} />
                <div>能上网、能读笔记、能帮你写与改</div>
                <p>
                  例：“帮我把 Rust 笔记里关于 async 的部分整理成表格”
                  <br />
                  例：“联网查一下 DeepSeek 最新 API 价格，写一篇笔记”
                  <br />
                  新建/修改笔记都会先给你预览，修改会展示改动内容，批准后才保存。
                </p>
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ai-msg user">
                  <div className="ai-user-text">{m.content}</div>
                </div>
              ) : m.role === "step" ? (
                <div key={i} className="ai-step">{m.content}</div>
              ) : (
                <div key={i} className="ai-msg assistant">
                  {m.error ? (
                    <div className="ai-err">{m.content}</div>
                  ) : (
                    <>
                      <div className="ai-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                      <div className="ai-msg-actions">
                        <button className="action-btn" onClick={() => append(m.content)}>
                          <FilePlus2 size={12} /> 追加到当前笔记
                        </button>
                        <button
                          className="action-btn"
                          onClick={() => {
                            setSaveName(defaultNameFromMd(m.content));
                            setSaveShowFor(saveShowFor === m.content ? null : m.content);
                          }}
                        >
                          存为新笔记
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className="ai-msg assistant">
                <div className="ai-waiting">
                  <LoaderCircle size={14} className="spin" /> AI 思考 / 执行中…
                </div>
              </div>
            )}
            {readAsk && (
              <div className="ask-card">
                <div className="ask-title">AI 想读取你的笔记</div>
                <div className="ask-body">
                  <b>{readAsk.title}</b>
                  <span className="ask-rel">{readAsk.rel}</span>
                </div>
                <div className="ask-actions">
                  <button className="m-btn primary" onClick={() => { readAskResolve.current?.(true); setReadAsk(null); }}>允许</button>
                  <button className="m-btn danger" onClick={() => { readAskResolve.current?.(false); setReadAsk(null); }}>拒绝</button>
                  {!allowReadAll && (
                    <button
                      className="m-btn"
                      onClick={() => {
                        setAllowReadAll(true);
                        readAskResolve.current?.(true);
                        setReadAsk(null);
                      }}
                    >
                      本会话都允许
                    </button>
                  )}
                </div>
              </div>
            )}
            {err && (
              <div className="ai-err">
                {err}
                <button className="m-btn" style={{ marginTop: 6 }} onClick={() => setErr(null)}>知道了</button>
              </div>
            )}
          </div>

          <div className="ai-input-area">
            <div className="ai-checks">
              <label className="ai-check">
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                附上当前笔记
              </label>
              <label className="ai-check" title="开启后本会话内 AI 读取其它笔记不再逐个询问（写改仍会审批）">
                <input type="checkbox" checked={allowReadAll} onChange={(e) => setAllowReadAll(e.target.checked)} />
                本会话允许 AI 读取笔记
              </label>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="提问 / 让 AI 查资料、读笔记、写新笔记、改现有笔记…"
              rows={3}
              disabled={busy}
            />
            <button className="ai-send" disabled={busy || !input.trim()} onClick={() => void send()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : null}
              发送
            </button>
          </div>
        </>
      ) : (
        <div className="ai-gen-body">
          {!genResult ? (
            <>
              <div className="ai-empty" style={{ paddingTop: 8 }}>
                <FilePlus2 size={26} strokeWidth={1.4} />
                <div>用主题生成一篇 Markdown 笔记</div>
                <p>给一个主题/大纲/要求，AI 会写一篇可直接保存的笔记。</p>
              </div>
              <textarea
                className="ai-gen-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={"例如：\n学习笔记：Rust 所有权与借用\n要求包含图解思路、常见坑、练习题"}
                rows={8}
              />
              <button
                className="ai-send"
                style={{ width: "100%", marginTop: 8 }}
                disabled={busy || !topic.trim()}
                onClick={() => void generate()}
              >
                {busy ? <LoaderCircle size={14} className="spin" /> : null}
                生成整篇笔记
              </button>
              {err && <div className="ai-err" style={{ marginTop: 10 }}>请求失败：{err}</div>}
            </>
          ) : (
            <div className="ai-gen-result">
              <div className="ai-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(genResult) }} />
              {err && <div className="ai-err">请求失败：{err}</div>}
            </div>
          )}
        </div>
      )}

      {/* 存为新笔记（gen/回复通用） */}
      {saveShowFor !== null && (
        <div className="ai-save-form">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="新笔记名称"
            spellCheck={false}
          />
          <button
            className="m-btn primary"
            disabled={saving || !saveName.trim()}
            onClick={async () => {
              setSaving(true);
              const folder = activeRel ? dirOf(activeRel) : "";
              const name = sanitizeFileName(saveName, "AI 笔记");
              const rel = await useStore.getState().createNoteAction(folder, name, saveShowFor);
              setSaving(false);
              if (rel) {
                toastShow(`已保存新笔记：${name}`, "ok");
                setSaveShowFor(null);
              }
            }}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button className="m-btn" onClick={() => setSaveShowFor(null)}>取消</button>
        </div>
      )}

      {msgs.length > 0 && !busy && (
        <button
          className="ai-clear"
          onClick={() => {
            setMsgs([]);
            setErr(null);
          }}
        >
          <Trash2 size={12} /> 清空对话
        </button>
      )}

      {/* 新建笔记预览审批 */}
      {createDraft && (
        <CreateApproveModal
          draft={createDraft}
          onCancel={() => { createResolve.current?.(null); setCreateDraft(null); }}
          onSave={(d) => { createResolve.current?.(d); setCreateDraft(null); }}
        />
      )}
      {/* 修改笔记 diff 审批 */}
      {updateDraft && (
        <UpdateApproveModal
          draft={updateDraft}
          onCancel={() => { updateResolve.current?.({ action: "cancel" }); setUpdateDraft(null); }}
          onApprove={(final) => { updateResolve.current?.({ action: "approve", final }); setUpdateDraft(null); }}
          onSaveAs={(final, name) => {
            const folder = dirOf(updateDraft.rel);
            void useStore
              .getState()
              .createNoteAction(folder, name, final)
              .then((rel) => {
                updateResolve.current?.({ action: "savedAs", rel: rel ?? undefined });
                setUpdateDraft(null);
              });
          }}
        />
      )}
    </aside>
  );
}

/* ================= 新建笔记预览审批 ================= */

function CreateApproveModal(props: {
  draft: CreateDraft;
  onCancel: () => void;
  onSave: (d: CreateDraft) => void;
}) {
  const { draft, onCancel, onSave } = props;
  const [name, setName] = useState(draft.name);
  const [folder, setFolder] = useState(draft.folder);
  const [content, setContent] = useState(draft.content);
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal approve-modal">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FilePlus2 size={17} style={{ color: "var(--accent)" }} /> AI 新建笔记预览
          <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onCancel}><X size={15} /></button>
        </h3>
        <div className="m-field">
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </div>
        <div className="m-field">
          <label>位置（库内相对目录，留空为根目录）</label>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="如 notes / 学习" spellCheck={false} />
        </div>
        <div className="m-field">
          <label>内容（可编辑后保存）</label>
          <textarea
            className="approve-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            spellCheck={false}
          />
        </div>
        <div className="m-actions">
          <button className="m-btn" onClick={onCancel}>取消</button>
          <button
            className="m-btn primary"
            disabled={!name.trim() || !content.trim()}
            onClick={() => onSave({ name: sanitizeFileName(name, "新笔记"), folder: folder.trim().replace(/^\/+|\/+$/g, ""), content })}
          >
            <Save size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> 保存并打开
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= 修改笔记 Diff 审批 ================= */

function UpdateApproveModal(props: {
  draft: UpdateDraft;
  onCancel: () => void;
  onApprove: (final: string) => void;
  onSaveAs: (final: string, name: string) => void;
}) {
  const { draft, onCancel, onApprove, onSaveAs } = props;
  const [finalText, setFinalText] = useState(draft.proposed);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState(`${draft.title}（AI 修改）`);

  const diff = useMemo(() => computeDiffRows(draft.original, finalText), [draft.original, finalText]);
  const changed = diff.added > 0 || diff.removed > 0;

  return (
    <div className="modal-mask">
      <div className="modal approve-modal" style={{ width: 860 }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={17} style={{ color: "var(--accent)" }} /> AI 修改审批：{draft.title}
          <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onCancel}><X size={15} /></button>
        </h3>
        {draft.summary && <p className="m-msg" style={{ marginBottom: 8 }}>AI 说明：{draft.summary}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span className="rb-count" style={{ color: "var(--text-3)" }}>
            新增 {diff.added} 行 · 删除 {diff.removed} 行 {changed ? "" : "· 内容无变化"}
          </span>
        </div>

        {changed && (
          <div className="diff-wrap">
            <div className="diff-head">
              <span className="diff-del">− 删除</span>
              <span className="diff-add">+ 新增</span>
            </div>
            <div className="diff-list">
              {diff.rows.map((r, i) => (
                <div key={i} className={`df-line ${r.type === "same" ? "df-same" : r.type === "del" ? "df-del" : "df-add"}`}>
                  <span className="df-mark">{r.type === "del" ? "−" : r.type === "add" ? "+" : ""}</span>
                  {r.text}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
            最终内容（可在这里手动微调后再批准）：
          </div>
          <textarea
            className="approve-textarea"
            style={{ height: 190 }}
            value={finalText}
            onChange={(e) => setFinalText(e.target.value)}
            spellCheck={false}
          />
        </div>

        {saveAsOpen ? (
          <div className="ai-save-form" style={{ border: "none", padding: "12px 0 0" }}>
            <input value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} spellCheck={false} />
            <button className="m-btn" onClick={() => setSaveAsOpen(false)}>返回</button>
            <button
              className="m-btn primary"
              disabled={!saveAsName.trim()}
              onClick={() => onSaveAs(finalText, sanitizeFileName(saveAsName, draft.title))}
            >
              确认另存
            </button>
          </div>
        ) : (
          <div className="m-actions" style={{ marginTop: 12 }}>
            <button className="m-btn" onClick={onCancel}>放弃修改</button>
            <button className="m-btn" onClick={() => setSaveAsOpen(true)}>另存为新笔记…</button>
            <button className="m-btn primary" disabled={!changed} onClick={() => onApprove(finalText)}>
              <Check size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> 批准并保存
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
