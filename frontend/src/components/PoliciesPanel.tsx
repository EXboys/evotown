// PoliciesPanel - enterprise policy center
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";

type PolicyRecord = {
  policy_id: string;
  category: string;
  name: string;
  description?: string;
  enabled: boolean;
  rules: Record<string, unknown>;
  updated_at?: string;
};

function Badge({ children, on }: { children: string; on: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"}`}>
      {children}
    </span>
  );
}

export function PoliciesPanel() {
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/api/v1/policies")
      .then((r) => r.json() as Promise<{ policies?: PolicyRecord[]; updated_at?: string }>)
      .then((data) => {
        setPolicies(Array.isArray(data.policies) ? data.policies : []);
        setUpdatedAt(data.updated_at || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (policy: PolicyRecord) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/policies/${encodeURIComponent(policy.policy_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...policy, enabled: !policy.enabled }),
      });
      if (!res.ok) throw new Error(`更新失败 (${res.status})`);
      setMessage(`已${policy.enabled ? "禁用" : "启用"} ${policy.name}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const saveRules = async (policy: PolicyRecord) => {
    const raw = draftRules[policy.policy_id];
    if (raw == null) return;
    setBusy(true);
    setError("");
    try {
      const rules = JSON.parse(raw) as Record<string, unknown>;
      const res = await adminFetch(`/api/v1/policies/${encodeURIComponent(policy.policy_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...policy, rules }),
      });
      if (!res.ok) throw new Error(`保存失败 (${res.status})`);
      setMessage(`已保存 ${policy.name} 规则`);
      setExpanded(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "JSON 格式无效");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            Connector / Runtime 通过 <code className="rounded bg-slate-100 px-1">GET /api/v1/policies</code> 拉取策略；违规通过 ingest 上报。
          </p>
          {updatedAt && <p className="mt-1 text-xs text-slate-400">最近更新 {updatedAt}</p>}
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          刷新
        </button>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-500">加载策略…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {policies.map((policy) => (
            <article key={policy.policy_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-violet-600">{policy.category}</div>
                  <h3 className="mt-1 font-semibold text-slate-950">{policy.name}</h3>
                  <p className="mt-1 font-mono text-xs text-slate-400">{policy.policy_id}</p>
                </div>
                <Badge on={policy.enabled}>{policy.enabled ? "已启用" : "已禁用"}</Badge>
              </div>
              <p className="mt-3 text-sm text-slate-600">{policy.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => toggleEnabled(policy)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                  {policy.enabled ? "禁用" : "启用"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = expanded === policy.policy_id ? null : policy.policy_id;
                    setExpanded(next);
                    if (next) {
                      setDraftRules((prev) => ({
                        ...prev,
                        [policy.policy_id]: JSON.stringify(policy.rules, null, 2),
                      }));
                    }
                  }}
                  className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {expanded === policy.policy_id ? "收起规则" : "编辑规则"}
                </button>
              </div>
              {expanded === policy.policy_id && (
                <div className="mt-4 space-y-2">
                  <textarea
                    className="h-48 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800"
                    value={draftRules[policy.policy_id] || ""}
                    onChange={(e) => setDraftRules({ ...draftRules, [policy.policy_id]: e.target.value })}
                  />
                  <button type="button" disabled={busy} onClick={() => saveRules(policy)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                    保存 JSON 规则
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
