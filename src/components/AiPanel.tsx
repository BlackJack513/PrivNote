import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus2, LoaderCircle, Settings, Sparkles, Trash2, X } from "lucide-react";
import { api, errMsg } from "../lib/api";
import {
  AI_SYSTEM_PROMPT,
  chatCompletion,
  defaultNameFromMd,
  generateNotePrompt,
  renderMarkdown,
  sanitizeFileName,
  wrapNoteContext,
} from "../lib/ai";
import { dirOf } from "../lib/paths";
import type { AiMsg } from "../lib/types";
import { useStore } from "../store";

interface Msg {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

type Tab = "chat" | "gen";

export default function AiPanel() {
  const toastShow = useStore((s) => s.toastShow);
  const setModal = useStore((s) => s.setModal);
  const setShowAi = useStore((s) => s.setShowAi);
  const tabs = useStore((s) => s.tabs);
  const activeRel = useStore((s) => s.activeRel);

  const activeTab = tabs.find((t) => t.rel === activeRel);

  const [settings, setSettings] = useState({ baseUrl: "", model: "", keySet: false });
  const [view, setView] = useState<Tab>("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [genResult, setGenResult] = useState<string | null>(null);

  const [saveName, setSaveName] = useState("");
  const [saveShowFor, setSaveShowFor] = useState<string | null>(null); // 记录要保存的内容
  const [saving, setSaving] = useState(false);

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
  }, [msgs, sending, view, genResult]);

  const ensureKey = useCallback(async (): Promise<boolean> => {
    const s = await refreshSettings();
    if (!s || !s.keySet) {
      toastShow("请先在设置中填写 AI API Key", "info");
      setModal({ kind: "aiSettings" });
      return false;
    }
    return true;
  }, [refreshSettings, setModal, toastShow]);

  const openSettings = useCallback(() => {
    setModal({ kind: "aiSettings" });
  }, [setModal]);

  const append = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      const ok = useStore.getState().appendToActive(content);
      if (ok) toastShow(`已追加到「${activeRel}」`, "ok");
      else toastShow("当前没有打开可追加的笔记", "info");
    },
    [activeRel, toastShow],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!(await ensureKey())) return;
    setErr(null);
    const noteContent = attach ? (activeTab?.content ?? null) : null;
    const userMsg = wrapNoteContext(text, noteContent);
    const history: AiMsg[] = [
      { role: "system", content: AI_SYSTEM_PROMPT },
      ...msgs
        .filter((m) => !m.error)
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMsg },
    ];
    setMsgs((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setSending(true);
    try {
      const reply = await chatCompletion(history);
      setMsgs((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSending(false);
    }
  }, [input, sending, ensureKey, attach, activeTab, msgs]);

  const generate = useCallback(async () => {
    const text = topic.trim();
    if (!text || sending) return;
    if (!(await ensureKey())) return;
    setErr(null);
    setSending(true);
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
      setSending(false);
    }
  }, [topic, sending, ensureKey]);

  const modelChip = settings.model || "deepseek-chat";

  const keyReady = settings.keySet;

  /* ---------- 渲染 ---------- */
  return (
    <aside className="ai-col">
      <div className="ai-head">
        <Sparkles size={15} style={{ color: "var(--accent)" }} />
        <span className="ai-title">AI 助手</span>
        <span
          className={`ai-key-dot ${keyReady ? "ok" : ""}`}
          title={keyReady ? "已配置 API Key" : "尚未配置 API Key"}
        />
        <span className="ai-model" title={modelChip}>{modelChip}</span>
        <button className="icon-btn" title="AI 设置" onClick={openSettings}>
          <Settings size={15} />
        </button>
        <button className="icon-btn" title="收起 AI 面板" onClick={() => setShowAi(false)}>
          <X size={15} />
        </button>
      </div>

      <div className="ai-tabs">
        <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
          对话
        </button>
        <button className={view === "gen" ? "active" : ""} onClick={() => setView("gen")}>
          写一篇
        </button>
      </div>

      {view === "chat" ? (
        <>
          <div className="ai-body" ref={bodyRef}>
            {msgs.length === 0 && (
              <div className="ai-empty">
                <Sparkles size={26} strokeWidth={1.4} />
                <div>让 AI 帮你写/改笔记</div>
                <p>
                  勾选「附上当前笔记」，AI 会结合打开的笔记内容回答；
                  回答可以一键追加到当前笔记，或另存为新笔记。
                </p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                {m.role === "assistant" ? (
                  <div className="ai-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                ) : (
                  <div className="ai-user-text">{m.content}</div>
                )}
                {m.role === "assistant" && !m.error && (
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
                )}
              </div>
            ))}
            {sending && (
              <div className="ai-msg assistant">
                <div className="ai-waiting">
                  <LoaderCircle size={14} className="spin" /> 思考中…
                </div>
              </div>
            )}
            {err && (
              <div className="ai-err">
                请求失败：{err}
                <button className="m-btn" style={{ marginTop: 6 }} onClick={() => setErr(null)}>
                  知道了
                </button>
              </div>
            )}
          </div>

          <div className="ai-input-area">
            <label className="ai-check">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              附上当前笔记
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="例如：帮我总结这篇笔记 / 用更通俗的话重写这段 / 补充一个实践案例…"
              rows={3}
            />
            <button className="ai-send" disabled={sending || !input.trim()} onClick={() => void send()}>
              {sending ? <LoaderCircle size={14} className="spin" /> : null}
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
                disabled={sending || !topic.trim()}
                onClick={() => void generate()}
              >
                {sending ? <LoaderCircle size={14} className="spin" /> : null}
                生成整篇笔记
              </button>
              {err && (
                <div className="ai-err" style={{ marginTop: 10 }}>
                  请求失败：{err}
                </div>
              )}
            </>
          ) : (
            <div className="ai-gen-result">
              <div className="ai-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(genResult) }} />
              {err && <div className="ai-err">请求失败：{err}</div>}
            </div>
          )}

          {err && genResult && (
            <button className="m-btn" style={{ margin: "6px 0 0 auto" }} onClick={() => setErr(null)}>
              关闭错误提示
            </button>
          )}
        </div>
      )}

      {/* 存为新笔记 内联表单 */}
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
              const rel = await useStore
                .getState()
                .createNoteAction(folder, name, saveShowFor);
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

      {msgs.length > 0 && (
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
    </aside>
  );
}
