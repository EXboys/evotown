import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import { EasyInstallWizard } from "./market/EasyInstallWizard";
import { Link } from "react-router-dom";

export type GatewayAccount = {
  account_id: string;
  name: string;
  team_id: string;
  owner_email: string;
  status: "active" | "disabled";
  notes: string;
  created_at: string;
  updated_at: string;
  active_keys: number;
  total_keys: number;
};

export type GatewayApiKey = {
  key_id: string;
  account_id: string;
  label: string;
  key_prefix: string;
  scopes: string[];
  status: "active" | "revoked";
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  monthly_token_limit?: number;
  monthly_cost_limit_usd?: number;
  burst_rpm_limit?: number;
  monthly_usage?: { total_tokens?: number; cost_usd?: number; requests?: number };
};

const SCOPE_OPTIONS = [
  { id: "gateway.chat", label: "gateway.chat（调用模型）" },
  { id: "console.read", label: "console.read（控制台只读）" },
  { id: "console.write", label: "console.write（控制台管理）" },
  { id: "gateway.read", label: "gateway.read（只读，预留）" },
] as const;

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function GatewayAccountsPanel() {
  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [keys, setKeys] = useState<GatewayApiKey[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [newAccount, setNewAccount] = useState({ name: "", team_id: "", owner_email: "", notes: "" });
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyTokenLimit, setNewKeyTokenLimit] = useState("");
  const [newKeyCostLimit, setNewKeyCostLimit] = useState("");
  const [newKeyBurstRpm, setNewKeyBurstRpm] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["gateway.chat"]);
  const [newKeyExpiresAt, setNewKeyExpiresAt] = useState("");
  const [accountDraft, setAccountDraft] = useState({ name: "", team_id: "", owner_email: "", notes: "" });
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadKeys = useCallback(async (accountId: string | null) => {
    const keyUrl = accountId
      ? `/api/v1/accounts/${encodeURIComponent(accountId)}/keys`
      : "/api/v1/keys";
    const keysRes = await adminFetch(keyUrl);
    if (keysRes.ok) {
      const keyData = (await keysRes.json()) as { keys?: GatewayApiKey[] };
      setKeys(keyData.keys || []);
    } else {
      setKeys([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const accRes = await adminFetch("/api/v1/accounts");
      if (!accRes.ok) {
        if (accRes.status === 403) throw new Error("需要登录控制台账号");
        throw new Error(`accounts ${accRes.status}`);
      }
      const accData = (await accRes.json()) as { accounts?: GatewayAccount[] };
      const accountsList = accData.accounts || [];
      setAccounts(accountsList);
      const nextId = selectedAccountId ?? accountsList[0]?.account_id ?? null;
      if (nextId !== selectedAccountId) {
        setSelectedAccountId(nextId);
      }
      await loadKeys(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [loadKeys, selectedAccountId]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      loadKeys(selectedAccountId);
    }
  }, [selectedAccountId, loadKeys]);

  useEffect(() => {
    const account = accounts.find((a) => a.account_id === selectedAccountId);
    if (account) {
      setAccountDraft({
        name: account.name,
        team_id: account.team_id,
        owner_email: account.owner_email,
        notes: account.notes,
      });
    }
  }, [selectedAccountId, accounts]);

  const createAccount = async () => {
    if (!newAccount.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAccount),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `create account ${res.status}`);
      }
      setNewAccount({ name: "", team_id: "", owner_email: "", notes: "" });
      await load();
      setMessage("账号已创建");
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleAccountStatus = async (account: GatewayAccount) => {
    setBusy(true);
    setError("");
    try {
      const next = account.status === "active" ? "disabled" : "active";
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(account.account_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`update account ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAccountDetails = async () => {
    if (!selectedAccountId) return;
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccountId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountDraft),
      });
      if (!res.ok) throw new Error(`update account ${res.status}`);
      await load();
      setMessage("账号信息已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleNewKeyScope = (scope: string) => {
    setNewKeyScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    );
  };

  const createKey = async () => {
    if (!selectedAccountId) return;
    setBusy(true);
    setError("");
    setCreatedSecret(null);
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccountId)}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newKeyLabel,
          scopes: newKeyScopes.length ? newKeyScopes : ["gateway.chat"],
          expires_at: newKeyExpiresAt || null,
          monthly_token_limit: newKeyTokenLimit ? Number(newKeyTokenLimit) : 0,
          monthly_cost_limit_usd: newKeyCostLimit ? Number(newKeyCostLimit) : 0,
          burst_rpm_limit: newKeyBurstRpm ? Number(newKeyBurstRpm) : 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `create key ${res.status}`);
      }
      const data = (await res.json()) as { secret?: string };
      setCreatedSecret(data.secret || null);
      setNewKeyLabel("");
      setNewKeyTokenLimit("");
      setNewKeyCostLimit("");
      setNewKeyBurstRpm("");
      setNewKeyScopes(["gateway.chat"]);
      setNewKeyExpiresAt("");
      await loadKeys(selectedAccountId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create key failed");
    } finally {
      setBusy(false);
    }
  };

  const updateKeySettings = async (
    key: GatewayApiKey,
    fields: {
      tokenLimit: number;
      costLimit: number;
      burstRpm: number;
      scopes: string[];
      expiresAt: string;
    }
  ) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/keys/${encodeURIComponent(key.key_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthly_token_limit: fields.tokenLimit,
          monthly_cost_limit_usd: fields.costLimit,
          burst_rpm_limit: fields.burstRpm,
          scopes: fields.scopes.length ? fields.scopes : ["gateway.chat"],
          expires_at: fields.expiresAt || null,
        }),
      });
      if (!res.ok) throw new Error(`update key ${res.status}`);
      if (selectedAccountId) await loadKeys(selectedAccountId);
      setMessage("Key 设置已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "update key failed");
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/keys/${encodeURIComponent(keyId)}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(`revoke ${res.status}`);
      if (selectedAccountId) {
        await loadKeys(selectedAccountId);
      }
      await load();
      setMessage("Key 已吊销");
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const selectedAccount = accounts.find((a) => a.account_id === selectedAccountId) ?? null;
  const accountKeys = keys.filter((k) => !selectedAccountId || k.account_id === selectedAccountId);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">控制台账号</h2>
        <p className="mt-1 text-sm text-slate-500">
          使用 <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700">/login</Link> 注册或登录。登录后 API Key 保存在当前 Tab 的 sessionStorage 中。
        </p>
      </section>

      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">创建账号</h2>
          <p className="mt-1 text-sm text-slate-500">每个账号可绑定团队并签发多个 Gateway API Key。</p>
          <div className="mt-4 space-y-3">
            <input
              value={newAccount.name}
              onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
              placeholder="账号名称 *"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={newAccount.team_id}
              onChange={(e) => setNewAccount({ ...newAccount, team_id: e.target.value })}
              placeholder="团队 ID（可选）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={newAccount.owner_email}
              onChange={(e) => setNewAccount({ ...newAccount, owner_email: e.target.value })}
              placeholder="负责人邮箱（可选）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <textarea
              value={newAccount.notes}
              onChange={(e) => setNewAccount({ ...newAccount, notes: e.target.value })}
              placeholder="备注"
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy || !newAccount.name.trim()}
              onClick={createAccount}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              创建账号
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">账号列表</h2>
              <p className="mt-1 text-sm text-slate-500">{loading ? "加载中…" : `${accounts.length} 个账号`}</p>
            </div>
            <button type="button" onClick={load} className="text-sm font-medium text-blue-600 hover:text-blue-700">
              刷新
            </button>
          </div>
          {!accounts.length ? (
            <p className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">暂无账号，请先创建。</p>
          ) : (
            <div className="mt-4 space-y-2">
              {accounts.map((account) => (
                <button
                  key={account.account_id}
                  type="button"
                  onClick={() => setSelectedAccountId(account.account_id)}
                  className={`flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition ${
                    selectedAccountId === account.account_id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-950">{account.name}</div>
                    <div className="mt-1 truncate font-mono text-xs text-slate-500">{account.account_id}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {account.team_id || "无团队"} · {account.active_keys}/{account.total_keys} keys
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {account.status === "active" ? "启用" : "停用"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedAccount && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">{selectedAccount.name} — API Keys</h2>
              <p className="mt-1 font-mono text-xs text-slate-500">{selectedAccount.account_id}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => toggleAccountStatus(selectedAccount)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {selectedAccount.status === "active" ? "停用账号" : "启用账号"}
            </button>
          </div>

          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">编辑账号信息</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                value={accountDraft.name}
                onChange={(e) => setAccountDraft({ ...accountDraft, name: e.target.value })}
                placeholder="账号名称"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={accountDraft.team_id}
                onChange={(e) => setAccountDraft({ ...accountDraft, team_id: e.target.value })}
                placeholder="团队 ID"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={accountDraft.owner_email}
                onChange={(e) => setAccountDraft({ ...accountDraft, owner_email: e.target.value })}
                placeholder="负责人邮箱"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={accountDraft.notes}
                onChange={(e) => setAccountDraft({ ...accountDraft, notes: e.target.value })}
                placeholder="备注"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={saveAccountDetails}
              className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              保存账号信息
            </button>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-slate-900">签发新 Key</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder="Key 标签（如 prod-laptop-01）"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={newKeyTokenLimit}
              onChange={(e) => setNewKeyTokenLimit(e.target.value)}
              placeholder="月 token 上限（0=不限）"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={newKeyCostLimit}
              onChange={(e) => setNewKeyCostLimit(e.target.value)}
              placeholder="月成本上限 USD（0=不限）"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={newKeyBurstRpm}
              onChange={(e) => setNewKeyBurstRpm(e.target.value)}
              placeholder="Burst RPM / 60s（0=用全局默认）"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={newKeyExpiresAt}
              onChange={(e) => setNewKeyExpiresAt(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              title="过期时间（可选）"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {SCOPE_OPTIONS.map((scope) => (
              <label key={scope.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={newKeyScopes.includes(scope.id)}
                  onChange={() => toggleNewKeyScope(scope.id)}
                />
                {scope.label}
              </label>
            ))}
          </div>
          <div className="mt-3">
            <button
              type="button"
              disabled={busy || selectedAccount.status !== "active"}
              onClick={createKey}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              签发新 Key
            </button>
          </div>

          {createdSecret && (
            <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">请立即复制保存 — 密钥仅显示一次</div>
              <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">{createdSecret}</pre>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(createdSecret)}
                className="mt-3 text-sm font-medium text-amber-900 underline"
              >
                复制 Key
              </button>
            </div>
            <EasyInstallWizard apiKeyOverride={createdSecret} layout="panel" />
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Label / Scopes</th>
                  <th className="w-48 px-4 py-3 font-semibold">Limits / usage</th>
                  <th className="w-28 px-4 py-3 font-semibold">Expires</th>
                  <th className="w-24 px-4 py-3 font-semibold">Status</th>
                  <th className="w-28 px-4 py-3 font-semibold">Last used</th>
                  <th className="w-28 px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accountKeys.length ? (
                  accountKeys.map((key) => {
                    const usedTokens = key.monthly_usage?.total_tokens ?? 0;
                    const usedCost = key.monthly_usage?.cost_usd ?? 0;
                    const tokenLimit = key.monthly_token_limit ?? 0;
                    const costLimit = key.monthly_cost_limit_usd ?? 0;
                    const burstLimit = key.burst_rpm_limit ?? 0;
                    const scopeValue = (key.scopes || ["gateway.chat"]).join(",");
                    return (
                      <tr key={key.key_id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-950">{key.label || key.key_id}</div>
                          <p className="font-mono text-xs text-slate-500">{key.key_prefix}…</p>
                          <p className="mt-1 text-xs text-slate-500">{(key.scopes || []).join(", ") || "gateway.chat"}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div>{usedTokens} / {tokenLimit || "∞"} tokens</div>
                          <div className="mt-1">${Number(usedCost).toFixed(4)} / {costLimit ? `$${costLimit}` : "∞"}</div>
                          <div className="mt-1">burst: {burstLimit || "默认"} rpm</div>
                          {key.status === "active" && (
                            <div className="mt-2 grid grid-cols-2 gap-1">
                              <input type="number" min={0} defaultValue={tokenLimit} id={`quota-tokens-${key.key_id}`} className="rounded border border-slate-200 px-1 py-0.5 text-xs" title="月 token 上限" />
                              <input type="number" min={0} step={0.01} defaultValue={costLimit} id={`quota-cost-${key.key_id}`} className="rounded border border-slate-200 px-1 py-0.5 text-xs" title="月成本上限 USD" />
                              <input type="number" min={0} defaultValue={burstLimit} id={`burst-${key.key_id}`} className="rounded border border-slate-200 px-1 py-0.5 text-xs" title="Burst RPM" />
                              <input defaultValue={scopeValue} id={`scopes-${key.key_id}`} className="rounded border border-slate-200 px-1 py-0.5 text-xs" placeholder="scopes" title="逗号分隔 scopes" />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {key.status === "active" ? (
                            <input type="datetime-local" defaultValue={key.expires_at ? key.expires_at.slice(0, 16) : ""} id={`expires-${key.key_id}`} className="w-full rounded border border-slate-200 px-1 py-0.5 text-xs" />
                          ) : (
                            formatDate(key.expires_at)
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${key.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                            {key.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{formatDate(key.last_used_at)}</td>
                        <td className="px-4 py-3 text-right">
                          {key.status === "active" && (
                            <div className="flex flex-col items-end gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  const tokenEl = document.getElementById(`quota-tokens-${key.key_id}`) as HTMLInputElement | null;
                                  const costEl = document.getElementById(`quota-cost-${key.key_id}`) as HTMLInputElement | null;
                                  const burstEl = document.getElementById(`burst-${key.key_id}`) as HTMLInputElement | null;
                                  const scopesEl = document.getElementById(`scopes-${key.key_id}`) as HTMLInputElement | null;
                                  const expiresEl = document.getElementById(`expires-${key.key_id}`) as HTMLInputElement | null;
                                  const scopes = (scopesEl?.value || "gateway.chat").split(",").map((s) => s.trim()).filter(Boolean);
                                  updateKeySettings(key, {
                                    tokenLimit: Number(tokenEl?.value || 0),
                                    costLimit: Number(costEl?.value || 0),
                                    burstRpm: Number(burstEl?.value || 0),
                                    scopes,
                                    expiresAt: expiresEl?.value || "",
                                  });
                                }}
                                className="text-xs font-medium text-blue-600 hover:text-blue-700"
                              >
                                保存设置
                              </button>
                              <button type="button" disabled={busy} onClick={() => revokeKey(key.key_id)} className="text-xs font-medium text-red-600 hover:text-red-700">
                                吊销
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      该账号暂无 Key
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
