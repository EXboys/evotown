import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AccountKeyTable } from "./accounts/AccountKeyTable";
import { GatewayDrawer } from "./gateway/GatewayDrawer";
import { EasyInstallWizard } from "./market/EasyInstallWizard";
import { adminFetch } from "../hooks/useAdminToken";

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

type DrawerMode = null | "account-create" | "account-edit" | "key-create" | "key-edit";

type AccountForm = {
  name: string;
  team_id: string;
  owner_email: string;
  notes: string;
};

type KeyForm = {
  label: string;
  scopes: string[];
  monthly_token_limit: string;
  monthly_cost_limit_usd: string;
  burst_rpm_limit: string;
  expires_at: string;
};

const EMPTY_ACCOUNT: AccountForm = { name: "", team_id: "", owner_email: "", notes: "" };

const DEFAULT_KEY: KeyForm = {
  label: "",
  scopes: ["gateway.chat", "console.read"],
  monthly_token_limit: "",
  monthly_cost_limit_usd: "",
  burst_rpm_limit: "",
  expires_at: "",
};

const SCOPE_OPTIONS = [
  { id: "gateway.chat", label: "模型网关", hint: "gateway.chat" },
  { id: "console.read", label: "控制台只读", hint: "console.read" },
  { id: "console.write", label: "控制台管理", hint: "console.write" },
] as const;

function keyToForm(key: GatewayApiKey): KeyForm {
  return {
    label: key.label || "",
    scopes: key.scopes?.length ? [...key.scopes] : ["gateway.chat"],
    monthly_token_limit: String(key.monthly_token_limit ?? 0),
    monthly_cost_limit_usd: String(key.monthly_cost_limit_usd ?? 0),
    burst_rpm_limit: String(key.burst_rpm_limit ?? 0),
    expires_at: key.expires_at ? key.expires_at.slice(0, 16) : "",
  };
}

export function GatewayAccountsPanel() {
  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [keys, setKeys] = useState<GatewayApiKey[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [drawer, setDrawer] = useState<DrawerMode>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_ACCOUNT);
  const [keyForm, setKeyForm] = useState<KeyForm>(DEFAULT_KEY);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const loadKeys = useCallback(async (accountId: string | null) => {
    if (!accountId) {
      setKeys([]);
      return;
    }
    const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/keys`);
    if (res.ok) {
      const data = (await res.json()) as { keys?: GatewayApiKey[] };
      setKeys(data.keys || []);
    } else {
      setKeys([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/accounts");
      if (!res.ok) {
        if (res.status === 403) throw new Error("需要管理员权限，请使用 X-Admin-Token 或 console.write 的 evk_ 登录");
        throw new Error(`加载失败 (${res.status})`);
      }
      const data = (await res.json()) as { accounts?: GatewayAccount[] };
      const list = data.accounts || [];
      setAccounts(list);
      const keepId = selectedAccountId && list.some((a) => a.account_id === selectedAccountId)
        ? selectedAccountId
        : list[0]?.account_id ?? null;
      setSelectedAccountId(keepId);
      await loadKeys(keepId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadKeys, selectedAccountId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      loadKeys(selectedAccountId);
    }
  }, [selectedAccountId, loadKeys]);

  const closeDrawer = () => {
    setDrawer(null);
    setEditingKeyId(null);
    setAccountForm(EMPTY_ACCOUNT);
    setKeyForm(DEFAULT_KEY);
    if (drawer !== "key-create") {
      setCreatedSecret(null);
    }
  };

  const selectedAccount = accounts.find((a) => a.account_id === selectedAccountId) ?? null;
  const totalActiveKeys = accounts.reduce((sum, a) => sum + (a.active_keys || 0), 0);

  const openAccountCreate = () => {
    setAccountForm(EMPTY_ACCOUNT);
    setDrawer("account-create");
    setError("");
  };

  const openAccountEdit = () => {
    if (!selectedAccount) return;
    setAccountForm({
      name: selectedAccount.name,
      team_id: selectedAccount.team_id,
      owner_email: selectedAccount.owner_email,
      notes: selectedAccount.notes,
    });
    setDrawer("account-edit");
    setError("");
  };

  const openKeyCreate = () => {
    setKeyForm(DEFAULT_KEY);
    setCreatedSecret(null);
    setDrawer("key-create");
    setError("");
  };

  const openKeyEdit = (key: GatewayApiKey) => {
    setEditingKeyId(key.key_id);
    setKeyForm(keyToForm(key));
    setDrawer("key-edit");
    setError("");
  };

  const toggleScope = (scope: string) => {
    setKeyForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const submitAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountForm.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const isEdit = drawer === "account-edit" && selectedAccountId;
      const res = await adminFetch(
        isEdit ? `/api/v1/accounts/${encodeURIComponent(selectedAccountId!)}` : "/api/v1/accounts",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accountForm),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `保存失败 (${res.status})`);
      }
      closeDrawer();
      setMessage(isEdit ? "账号已更新" : "账号已创建");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleAccountStatus = async () => {
    if (!selectedAccount) return;
    setBusy(true);
    setError("");
    try {
      const next = selectedAccount.status === "active" ? "disabled" : "active";
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccount.account_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`更新失败 (${res.status})`);
      setMessage(next === "active" ? "账号已启用" : "账号已停用");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const submitKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAccountId) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        label: keyForm.label,
        scopes: keyForm.scopes.length ? keyForm.scopes : ["gateway.chat"],
        expires_at: keyForm.expires_at || null,
        monthly_token_limit: keyForm.monthly_token_limit ? Number(keyForm.monthly_token_limit) : 0,
        monthly_cost_limit_usd: keyForm.monthly_cost_limit_usd ? Number(keyForm.monthly_cost_limit_usd) : 0,
        burst_rpm_limit: keyForm.burst_rpm_limit ? Number(keyForm.burst_rpm_limit) : 0,
      };

      if (drawer === "key-edit" && editingKeyId) {
        const res = await adminFetch(`/api/v1/keys/${encodeURIComponent(editingKeyId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`更新失败 (${res.status})`);
        closeDrawer();
        setMessage("Key 已更新");
        await loadKeys(selectedAccountId);
        return;
      }

      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccountId)}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `签发失败 (${res.status})`);
      }
      const data = (await res.json()) as { secret?: string };
      setCreatedSecret(data.secret || null);
      setMessage("Key 已签发");
      await loadKeys(selectedAccountId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!window.confirm("确定吊销该 Key？吊销后无法恢复。")) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/keys/${encodeURIComponent(keyId)}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(`吊销失败 (${res.status})`);
      setMessage("Key 已吊销");
      if (selectedAccountId) await loadKeys(selectedAccountId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "吊销失败");
    } finally {
      setBusy(false);
    }
  };

  const scopeCheckboxes = (
    <div className="flex flex-wrap gap-3">
      {SCOPE_OPTIONS.map((scope) => (
        <label key={scope.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={keyForm.scopes.includes(scope.id)} onChange={() => toggleScope(scope.id)} />
          <span>
            {scope.label}
            <span className="ml-1 text-xs text-slate-400">{scope.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );

  const keyLimitFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">月 Token 上限</span>
        <input
          type="number"
          min={0}
          value={keyForm.monthly_token_limit}
          onChange={(e) => setKeyForm({ ...keyForm, monthly_token_limit: e.target.value })}
          placeholder="0 = 不限"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">月成本上限 (USD)</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={keyForm.monthly_cost_limit_usd}
          onChange={(e) => setKeyForm({ ...keyForm, monthly_cost_limit_usd: e.target.value })}
          placeholder="0 = 不限"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Burst RPM</span>
        <input
          type="number"
          min={0}
          value={keyForm.burst_rpm_limit}
          onChange={(e) => setKeyForm({ ...keyForm, burst_rpm_limit: e.target.value })}
          placeholder="0 = 全局默认"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">过期时间</span>
        <input
          type="datetime-local"
          value={keyForm.expires_at}
          onChange={(e) => setKeyForm({ ...keyForm, expires_at: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            管理企业员工账号与 <code className="text-xs">evk_</code> API Key。员工自助登录见{" "}
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700">/login</Link>
            ；模型与路由见 <Link to="/gateway" className="font-medium text-blue-600 hover:text-blue-700">网关</Link>。
          </p>
        </div>
        <button
          type="button"
          onClick={openAccountCreate}
          className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          创建账号
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">账号</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : accounts.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">有效 Key</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : totalActiveKeys}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">当前账号</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-950">{selectedAccount?.name || "—"}</div>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
      )}
      {error && !drawer && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid min-h-[420px] gap-5 lg:grid-cols-[minmax(240px,300px)_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-slate-950">账号列表</span>
            <button type="button" onClick={load} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              刷新
            </button>
          </div>
          {!accounts.length ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500">暂无账号</p>
          ) : (
            <ul className="max-h-[520px] space-y-1 overflow-y-auto">
              {accounts.map((account) => (
                <li key={account.account_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId(account.account_id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                      selectedAccountId === account.account_id
                        ? "bg-blue-50 ring-1 ring-blue-200"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-900">{account.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {account.status === "active" ? "启用" : "停用"}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{account.account_id}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {account.active_keys}/{account.total_keys} keys
                      {account.team_id ? ` · ${account.team_id}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {!selectedAccount ? (
            <p className="flex h-full min-h-[360px] items-center justify-center text-sm text-slate-500">
              请选择左侧账号，或创建新账号。
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-950">{selectedAccount.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{selectedAccount.account_id}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {[selectedAccount.owner_email, selectedAccount.team_id && `团队 ${selectedAccount.team_id}`]
                      .filter(Boolean)
                      .join(" · ") || "未填写负责人 / 团队"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={openAccountEdit}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    编辑账号
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={toggleAccountStatus}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {selectedAccount.status === "active" ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || selectedAccount.status !== "active"}
                    onClick={openKeyCreate}
                    className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    签发 Key
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">API Keys</h3>
                <p className="mt-0.5 text-xs text-slate-500">员工配置使用 evk_ 前缀密钥，配合网关与 SkillHub。</p>
                <div className="mt-3">
                  <AccountKeyTable keys={keys} busy={busy} onEdit={openKeyEdit} onRevoke={revokeKey} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <GatewayDrawer
        open={drawer === "account-create" || drawer === "account-edit"}
        title={drawer === "account-edit" ? "编辑账号" : "创建账号"}
        subtitle="每个账号可绑定团队并签发多个 evk_ Key"
        onClose={closeDrawer}
      >
        {error && (drawer === "account-create" || drawer === "account-edit") && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={submitAccount} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">账号名称 *</span>
            <input
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">团队 ID</span>
            <input
              value={accountForm.team_id}
              onChange={(e) => setAccountForm({ ...accountForm, team_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="用于网关别名路由 scope"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">负责人邮箱</span>
            <input
              type="email"
              value={accountForm.owner_email}
              onChange={(e) => setAccountForm({ ...accountForm, owner_email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">备注</span>
            <textarea
              value={accountForm.notes}
              onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700">
              取消
            </button>
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white disabled:opacity-50">
              保存
            </button>
          </div>
        </form>
      </GatewayDrawer>

      <GatewayDrawer
        open={drawer === "key-create" || drawer === "key-edit"}
        title={drawer === "key-edit" ? "编辑 Key" : "签发 Key"}
        subtitle={selectedAccount ? selectedAccount.name : undefined}
        onClose={closeDrawer}
      >
        {error && (drawer === "key-create" || drawer === "key-edit") && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {createdSecret && drawer === "key-create" && (
          <div className="mb-4 space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">请立即复制 — 密钥仅显示一次</div>
            <pre className="overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">{createdSecret}</pre>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(createdSecret)}
              className="text-sm font-medium text-amber-900 underline"
            >
              复制 Key
            </button>
            <EasyInstallWizard apiKeyOverride={createdSecret} layout="panel" />
          </div>
        )}
        <form onSubmit={submitKey} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">标签</span>
            <input
              value={keyForm.label}
              onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
              placeholder="如 prod-laptop-01"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <div>
            <div className="text-sm font-medium text-slate-700">权限范围</div>
            <div className="mt-2">{scopeCheckboxes}</div>
          </div>
          {keyLimitFields}
          <div className="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700">
              {createdSecret ? "关闭" : "取消"}
            </button>
            {!createdSecret && (
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {drawer === "key-edit" ? "保存" : "签发"}
              </button>
            )}
          </div>
        </form>
      </GatewayDrawer>
    </div>
  );
}
