// PoliciesPanel - enterprise policy center
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

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

const POLICIES_COPY = {
  zh: {
    intro: "Connector / Runtime 通过",
    introTail: "拉取策略；违规通过 ingest 上报。",
    updated: "最近更新",
    refresh: "刷新",
    loading: "加载策略…",
    enabled: "已启用",
    disabled: "已禁用",
    enable: "启用",
    disable: "禁用",
    collapse: "收起规则",
    edit: "编辑规则",
    saveJson: "保存 JSON 规则",
    messages: {
      loadFailed: "加载失败",
      updateFailed: "更新失败",
      saveFailed: "保存失败",
      invalidJson: "JSON 格式无效",
      toggled: (enabled: boolean, name: string) => `已${enabled ? "禁用" : "启用"} ${name}`,
      saved: (name: string) => `已保存 ${name} 规则`,
    },
  },
  en: {
    intro: "Connectors / runtimes pull policies through",
    introTail: "and report violations through ingest.",
    updated: "Last updated",
    refresh: "Refresh",
    loading: "Loading policies...",
    enabled: "Enabled",
    disabled: "Disabled",
    enable: "Enable",
    disable: "Disable",
    collapse: "Collapse Rules",
    edit: "Edit Rules",
    saveJson: "Save JSON Rules",
    messages: {
      loadFailed: "Load failed",
      updateFailed: "Update failed",
      saveFailed: "Save failed",
      invalidJson: "Invalid JSON",
      toggled: (enabled: boolean, name: string) => `${enabled ? "Disabled" : "Enabled"} ${name}`,
      saved: (name: string) => `Saved rules for ${name}`,
    },
  },
} as const;

export function PoliciesPanel({ locale = "zh" }: { locale?: Locale }) {
  const copy = POLICIES_COPY[locale];
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
      .catch((err) => setError(err instanceof Error ? err.message : copy.messages.loadFailed))
      .finally(() => setLoading(false));
  }, [copy.messages.loadFailed]);

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
      if (!res.ok) throw new Error(`${copy.messages.updateFailed} (${res.status})`);
      setMessage(copy.messages.toggled(policy.enabled, policy.name));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.updateFailed);
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
      if (!res.ok) throw new Error(`${copy.messages.saveFailed} (${res.status})`);
      setMessage(copy.messages.saved(policy.name));
      setExpanded(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.invalidJson);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            {copy.intro} <code className="rounded bg-slate-100 px-1">GET /api/v1/policies</code> {copy.introTail}
          </p>
          {updatedAt && <p className="mt-1 text-xs text-slate-400">{copy.updated} {updatedAt}</p>}
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {copy.refresh}
        </button>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-500">{copy.loading}</p>
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
                <Badge on={policy.enabled}>{policy.enabled ? copy.enabled : copy.disabled}</Badge>
              </div>
              <p className="mt-3 text-sm text-slate-600">{policy.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => toggleEnabled(policy)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                  {policy.enabled ? copy.disable : copy.enable}
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
                  {expanded === policy.policy_id ? copy.collapse : copy.edit}
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
                    {copy.saveJson}
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
