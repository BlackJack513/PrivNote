import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { AI_DEFAULT_BASE, AI_MODEL_SUGGESTIONS } from "../lib/ai";
import { useStore } from "../store";

export default function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const toastShow = useStore((s) => s.toastShow);
  const [baseUrl, setBaseUrl] = useState(AI_DEFAULT_BASE);
  const [model, setModel] = useState("deepseek-chat");
  const [keySet, setKeySet] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .aiGetSettings()
      .then((s) => {
        setBaseUrl(s.baseUrl);
        setModel(s.model);
        setKeySet(s.apiKeySet);
      })
      .catch((e) => toastShow(`读取 AI 设置失败：${errMsg(e)}`, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      // 用户输入了新 key → 传值；点了“清除”→ 传空；未动 → 不传保持
      const keyArg = apiKey.trim().length > 0 ? apiKey.trim() : cleared ? "" : undefined;
      await api.aiSetSettings(baseUrl, model, keyArg as string | null | undefined);
      toastShow("AI 设置已保存", "ok");
      onClose();
    } catch (e) {
      toastShow(`保存失败：${errMsg(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 480 }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={17} style={{ color: "var(--accent)" }} />
          AI 助手设置
          <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
            <X size={15} />
          </button>
        </h3>
        <div className="m-field">
          <label>API Key{keySet ? "（已保存，留空则保持不变）" : "（尚未配置）"}</label>
          <input
            type="password"
            autoComplete="off"
            placeholder={keySet ? "••••••••（输入新 Key 以替换）" : "sk-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            spellCheck={false}
          />
          {keySet && (
            <button
              className="m-btn"
              style={{ marginTop: 6, height: 26, fontSize: 12 }}
              onClick={() => {
                setCleared(true);
                setApiKey("");
                setKeySet(false);
              }}
            >
              清除已保存的 Key
            </button>
          )}
        </div>
        <div className="m-field">
          <label>Base URL（OpenAI 兼容端点）</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={AI_DEFAULT_BASE}
            spellCheck={false}
          />
        </div>
        <div className="m-field">
          <label>模型名</label>
          <input
            list="ai-model-suggestions"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
            spellCheck={false}
          />
          <datalist id="ai-model-suggestions">
            {AI_MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <p className="m-msg" style={{ fontSize: 12, color: "var(--text-3)" }}>
          Key 仅保存在本机应用配置中，请求由 PrivNote 直接发送到你填写的地址（默认 DeepSeek 官方）。
          想用 deepseek-v4-flash 等模型，把“模型名”改成对应名称即可。
        </p>
        <div className="m-actions">
          <button className="m-btn" onClick={onClose}>取消</button>
          <button className="m-btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
