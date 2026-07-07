import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";

type AgentOption = {
  agent_id: string;
  name: string;
};

type ShareResult = {
  dest_prefix: string;
  copied: Array<{ from: string; to: string; bytes: number }>;
  serve_urls: string[];
};

type Props = {
  sourceAgentId: string;
  selectedPaths: string[];
  onClose: () => void;
  onSuccess?: () => void;
};

export function AgentShareDialog({ sourceAgentId, selectedPaths, onClose, onSuccess }: Props) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [destPrefix, setDestPrefix] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ShareResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAgents(true);
    adminFetch("/api/v1/agents?status_filter=active&limit=100")
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载 Agent 列表失败 (${res.status})`);
        return res.json() as Promise<{ agents?: AgentOption[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const options = (data.agents || []).filter((a) => a.agent_id !== sourceAgentId);
        setAgents(options);
        if (options.length === 1) setTargetAgentId(options[0].agent_id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingAgents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceAgentId]);

  const submit = async () => {
    if (!targetAgentId) {
      setError("请选择目标 Agent");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/agents/${encodeURIComponent(sourceAgentId)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: selectedPaths,
          target_agent_id: targetAgentId,
          dest_prefix: destPrefix,
          overwrite,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : `分享失败 (${res.status})`);
      }
      setResult(data as ShareResult);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "分享失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">分享到其他 Agent</h2>
          <p className="mt-1 text-xs text-slate-500">已选 {selectedPaths.length} 个文件，将复制到目标 Agent 工作区。</p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-700">已成功复制 {result.copied.length} 个文件。</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                {result.copied.map((item) => (
                  <li key={item.to} className="truncate font-mono">{item.from} → {item.to}</li>
                ))}
              </ul>
              {result.serve_urls.length > 0 ? (
                <div className="space-y-2">
                  {result.serve_urls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      打开预览 → {url.split("/serve/")[1] || url}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">目标 Agent</label>
                {loadingAgents ? (
                  <p className="text-xs text-slate-400">加载中…</p>
                ) : agents.length === 0 ? (
                  <p className="text-xs text-amber-600">没有其他可写入的 Agent。</p>
                ) : (
                  <select
                    value={targetAgentId}
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="">请选择…</option>
                    {agents.map((a) => (
                      <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">目标子目录（可选）</label>
                <input
                  type="text"
                  value={destPrefix}
                  onChange={(e) => setDestPrefix(e.target.value)}
                  placeholder="默认 shared/{源AgentId}/"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                覆盖已存在的同名文件
              </label>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">待分享</p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {selectedPaths.map((p) => (
                    <li key={p} className="truncate font-mono">{p}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {result ? "关闭" : "取消"}
          </button>
          {!result ? (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || loadingAgents || !targetAgentId || agents.length === 0}
              className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {submitting ? "分享中…" : "确认分享"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
