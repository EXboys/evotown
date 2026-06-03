import { FormEvent, useCallback, useEffect, useState } from "react";

import { adminFetch, getConsoleApiKey, getAdminToken } from "../../hooks/useAdminToken";
import type { GatewayModelRoute } from "../GatewayModelRoutesPanel";

type ChatResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  requestId: string;
  finalModel: string;
  attempts: string;
  content: string;
  raw: string;
  error: string;
};

function gatewayBearer(): string {
  return getConsoleApiKey() || getAdminToken();
}

async function gatewayChatFetch(body: Record<string, unknown>): Promise<{ res: Response; latencyMs: number }> {
  const bearer = gatewayBearer();
  if (!bearer) {
    throw new Error("请先在「登录」页配置 evk_ API Key，或设置 Admin Token（本地需 EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY=1）");
  }
  const started = performance.now();
  const res = await fetch("/api/gateway/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { res, latencyMs: Math.round(performance.now() - started) };
}

function extractContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return "";
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = msg?.content;
  return typeof content === "string" ? content : "";
}

export function GatewayPlaygroundPanel() {
  const [aliases, setAliases] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [message, setMessage] = useState("用一句话介绍你自己。");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ChatResult | null>(null);
  const [auditAttempts, setAuditAttempts] = useState<unknown>(null);

  const loadAliases = useCallback(async () => {
    const res = await adminFetch("/api/gateway/v1/model-routes");
    if (!res.ok) return;
    const data = await res.json() as { routes?: GatewayModelRoute[] };
    const names = (data.routes || [])
      .filter((r) => r.enabled !== false)
      .map((r) => r.alias)
      .filter(Boolean);
    setAliases(names);
    if (!model && names.length) setModel(names[0]);
  }, [model]);

  useEffect(() => {
    loadAliases().catch(() => undefined);
  }, [loadAliases]);

  const loadAuditForRequest = async (requestId: string) => {
    if (!requestId) return;
    const res = await adminFetch("/api/gateway/v1/requests?limit=20");
    if (!res.ok) return;
    const data = await res.json() as { requests?: Array<{ request_id?: string; response_excerpt?: unknown }> };
    const row = (data.requests || []).find((r) => r.request_id === requestId);
    const excerpt = row?.response_excerpt;
    if (excerpt && typeof excerpt === "object" && excerpt !== null) {
      const attempts = (excerpt as { evotown_attempts?: unknown }).evotown_attempts;
      if (attempts) setAuditAttempts(attempts);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    setAuditAttempts(null);
    try {
      const { res, latencyMs } = await gatewayChatFetch({
        model: model.trim(),
        messages: [{ role: "user", content: message.trim() }],
        stream: false,
      });
      const requestId = res.headers.get("X-Evotown-Request-Id") || "";
      const finalModel = res.headers.get("X-Evotown-Final-Model") || "";
      const attempts = res.headers.get("X-Evotown-Upstream-Attempts") || "";
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
      const content = extractContent(parsed);
      const errMsg =
        !res.ok && parsed && typeof parsed === "object" && "detail" in parsed
          ? String((parsed as { detail: unknown }).detail)
          : !res.ok
            ? text.slice(0, 500)
            : "";

      setResult({
        ok: res.ok,
        status: res.status,
        latencyMs,
        requestId,
        finalModel,
        attempts,
        content,
        raw: JSON.stringify(parsed, null, 2),
        error: errMsg,
      });

      if (requestId) {
        await loadAuditForRequest(requestId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setBusy(false);
    }
  };

  const hasBearer = Boolean(gatewayBearer());

  return (
    <div className="space-y-4">
      {!hasBearer && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          需要带 <code className="text-xs">gateway.chat</code> 权限的 evk_ Key（推荐在「账号」页签发），或使用本地 Admin Token +{" "}
          <code className="text-xs">EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY=1</code>。
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Model（别名或具体模型名）</span>
          <div className="mt-1 flex gap-2">
            <input
              list="gateway-alias-list"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              placeholder="enterprise-chat"
              required
            />
            <datalist id="gateway-alias-list">
              {aliases.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">消息</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy || !hasBearer}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "请求中…" : "发送试调请求"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm">
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span>
              HTTP <strong className={result.ok ? "text-emerald-700" : "text-red-700"}>{result.status}</strong>
            </span>
            <span>耗时 {result.latencyMs}ms</span>
            {result.finalModel && (
              <span>
                最终模型 <code className="font-mono text-slate-900">{result.finalModel}</code>
              </span>
            )}
            {result.attempts && <span>上游尝试 {result.attempts} 次</span>}
            {result.requestId && (
              <span className="font-mono text-slate-500">{result.requestId}</span>
            )}
          </div>
          {result.error && <p className="text-red-700">{result.error}</p>}
          {result.content && (
            <div>
              <div className="mb-1 font-medium text-slate-700">回复</div>
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-slate-800">
                {result.content}
              </pre>
            </div>
          )}
          {auditAttempts != null && (
            <div>
              <div className="mb-1 font-medium text-slate-700">重试 / 降级轨迹（审计）</div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700">
                {JSON.stringify(auditAttempts, null, 2)}
              </pre>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-500">原始 JSON</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-600">
              {result.raw}
            </pre>
          </details>
        </div>
      )}

      <p className="text-xs text-slate-500">
        试调走真实 <code>/api/gateway/v1/chat/completions</code>。测降级时：别名主模型填不存在的名，降级链填可用上游模型，再发送。
        发送后到「用量审计」页可看到最新记录。
      </p>
    </div>
  );
}
