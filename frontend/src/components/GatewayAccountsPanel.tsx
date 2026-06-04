import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AccountKeyTable } from "./accounts/AccountKeyTable";
import { GatewayDrawer } from "./gateway/GatewayDrawer";
import { OrgDrawer } from "./gateway/OrgDrawer";
import { EasyInstallWizard } from "./market/EasyInstallWizard";
import { adminFetch } from "../hooks/useAdminToken";
import {
  fetchGatewayOrgs,
  type GatewayOrg,
} from "../lib/gatewayOrgs";
import type { Locale } from "../lib/i18n";

export type GatewayAccount = {
  account_id: string;
  name: string;
  org_id: string;
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
  org_id: string;
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

const EMPTY_ACCOUNT: AccountForm = { name: "", org_id: "", owner_email: "", notes: "" };

const DEFAULT_KEY: KeyForm = {
  label: "",
  scopes: ["gateway.chat", "console.read"],
  monthly_token_limit: "",
  monthly_cost_limit_usd: "",
  burst_rpm_limit: "",
  expires_at: "",
};

const SCOPE_OPTIONS = [
  { id: "gateway.chat", label: { zh: "模型网关", en: "Model Gateway" }, hint: "gateway.chat" },
  { id: "console.read", label: { zh: "控制台只读", en: "Console Read" }, hint: "console.read" },
  { id: "console.write", label: { zh: "控制台管理", en: "Console Admin" }, hint: "console.write" },
] as const;

const ACCOUNTS_COPY = {
  zh: {
    introBefore: "管理企业组织、员工账号与",
    introAfterLogin: "。员工自助登录见",
    introAfterGateway: "；模型与路由见",
    gateway: "网关",
    createOrg: "新建组织",
    createAccount: "创建账号",
    stats: { orgs: "组织", accounts: "账号", activeKeys: "有效 Key", currentAccount: "当前账号" },
    viewOrg: "组织视图",
    viewAll: "全部账号",
    refresh: "刷新",
    emptyOrgs: "暂无组织",
    emptyAccounts: "暂无账号",
    enabled: "启用",
    disabled: "停用",
    accountsCount: (count: number) => `${count} 个账号`,
    noOrgAccounts: "该组织暂无账号",
    chooseAccount: "请选择左侧账号，或创建新账号。",
    orgPrefix: "组织",
    missingOwnerOrg: "未填写负责人 / 组织",
    editAccount: "编辑账号",
    issueKey: "签发 Key",
    keyNote: "员工配置使用 evk_ 前缀密钥，配合网关与 SkillHub。",
    accountDrawerTitle: (edit: boolean) => edit ? "编辑账号" : "创建账号",
    accountDrawerSubtitle: "每个账号可绑定组织并签发多个 evk_ Key",
    accountName: "账号名称 *",
    accountOrg: "所属组织 *",
    selectOrg: "请选择组织",
    ownerEmail: "负责人邮箱",
    notes: "备注",
    cancel: "取消",
    save: "保存",
    keyDrawerTitle: (edit: boolean) => edit ? "编辑 Key" : "签发 Key",
    copyNow: "请立即复制 — 密钥仅显示一次",
    copyKey: "复制 Key",
    label: "标签",
    labelPlaceholder: "如 prod-laptop-01",
    scopes: "权限范围",
    monthlyTokenLimit: "月 Token 上限",
    monthlyCostLimit: "月成本上限 (USD)",
    noLimit: "0 = 不限",
    globalDefault: "0 = 全局默认",
    expiresAt: "过期时间",
    close: "关闭",
    issue: "签发",
    edit: "编辑",
    delete: "删除",
    messages: {
      adminRequired: "需要管理员权限，请使用 X-Admin-Token 或 console.write 的 evk_ 登录",
      loadFailed: "加载失败",
      deleteOrgConfirm: (name: string) => `确定删除组织「${name}」？其下账号将移入默认组织。`,
      orgDeleted: (name: string) => `组织「${name}」已删除`,
      deleteFailed: "删除失败",
      orgEnabled: "组织已启用",
      orgDisabled: "组织已停用",
      updateFailed: "更新失败",
      saveFailed: "保存失败",
      accountUpdated: "账号已更新",
      accountCreated: "账号已创建",
      accountEnabled: "账号已启用",
      accountDisabled: "账号已停用",
      keyUpdated: "Key 已更新",
      keyIssueFailed: "签发失败",
      keyIssued: "Key 已签发",
      operationFailed: "操作失败",
      revokeConfirm: "确定吊销该 Key？吊销后无法恢复。",
      revokeFailed: "吊销失败",
      revoked: "Key 已吊销",
    },
  },
  en: {
    introBefore: "Manage enterprise organizations, employee accounts, and",
    introAfterLogin: ". Employee self-service login:",
    introAfterGateway: "; models and routing:",
    gateway: "Gateway",
    createOrg: "New Org",
    createAccount: "Create Account",
    stats: { orgs: "Orgs", accounts: "Accounts", activeKeys: "Active Keys", currentAccount: "Current Account" },
    viewOrg: "Org View",
    viewAll: "All Accounts",
    refresh: "Refresh",
    emptyOrgs: "No organizations",
    emptyAccounts: "No accounts",
    enabled: "Enabled",
    disabled: "Disabled",
    accountsCount: (count: number) => `${count} accounts`,
    noOrgAccounts: "No accounts in this org",
    chooseAccount: "Select an account on the left, or create a new one.",
    orgPrefix: "Org",
    missingOwnerOrg: "No owner / org set",
    editAccount: "Edit Account",
    issueKey: "Issue Key",
    keyNote: "Employee config uses evk_ keys with the gateway and SkillHub.",
    accountDrawerTitle: (edit: boolean) => edit ? "Edit Account" : "Create Account",
    accountDrawerSubtitle: "Each account can bind to an org and issue multiple evk_ keys",
    accountName: "Account Name *",
    accountOrg: "Organization *",
    selectOrg: "Select organization",
    ownerEmail: "Owner Email",
    notes: "Notes",
    cancel: "Cancel",
    save: "Save",
    keyDrawerTitle: (edit: boolean) => edit ? "Edit Key" : "Issue Key",
    copyNow: "Copy now — the secret is shown only once",
    copyKey: "Copy Key",
    label: "Label",
    labelPlaceholder: "e.g. prod-laptop-01",
    scopes: "Scopes",
    monthlyTokenLimit: "Monthly Token Limit",
    monthlyCostLimit: "Monthly Cost Limit (USD)",
    noLimit: "0 = unlimited",
    globalDefault: "0 = global default",
    expiresAt: "Expires At",
    close: "Close",
    issue: "Issue",
    edit: "Edit",
    delete: "Delete",
    messages: {
      adminRequired: "Admin permission required. Use X-Admin-Token or an evk_ key with console.write.",
      loadFailed: "Load failed",
      deleteOrgConfirm: (name: string) => `Delete organization "${name}"? Its accounts will move to the default org.`,
      orgDeleted: (name: string) => `Deleted organization "${name}"`,
      deleteFailed: "Delete failed",
      orgEnabled: "Organization enabled",
      orgDisabled: "Organization disabled",
      updateFailed: "Update failed",
      saveFailed: "Save failed",
      accountUpdated: "Account updated",
      accountCreated: "Account created",
      accountEnabled: "Account enabled",
      accountDisabled: "Account disabled",
      keyUpdated: "Key updated",
      keyIssueFailed: "Issue failed",
      keyIssued: "Key issued",
      operationFailed: "Operation failed",
      revokeConfirm: "Revoke this key? This cannot be undone.",
      revokeFailed: "Revoke failed",
      revoked: "Key revoked",
    },
  },
} as const;

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

export function GatewayAccountsPanel({ locale = "zh" }: { locale?: Locale }) {
  const copy = ACCOUNTS_COPY[locale];
  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [orgs, setOrgs] = useState<GatewayOrg[]>([]);
  const [viewMode, setViewMode] = useState<"org" | "all">("org");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [keys, setKeys] = useState<GatewayApiKey[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [drawer, setDrawer] = useState<DrawerMode>(null);
  const [orgDrawerOpen, setOrgDrawerOpen] = useState(false);
  const [orgDrawerMode, setOrgDrawerMode] = useState<"create" | "edit">("create");
  const [editingOrg, setEditingOrg] = useState<GatewayOrg | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_ACCOUNT);
  const [keyForm, setKeyForm] = useState<KeyForm>(DEFAULT_KEY);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const ROOT_ORG_ID = "org_root";

  const loadOrgs = useCallback(async () => {
    try {
      const list = await fetchGatewayOrgs();
      setOrgs(list);
      if (!selectedOrgId && list.length > 0) {
        setSelectedOrgId(list[0].org_id);
      }
    } catch (err) {
      console.error("Failed to load orgs:", err);
    }
  }, [selectedOrgId]);

  const filteredAccounts = useMemo(() => {
    if (viewMode === "all" || !selectedOrgId) return accounts;
    return accounts.filter((a) => a.org_id === selectedOrgId);
  }, [accounts, viewMode, selectedOrgId]);

  const selectedOrg = orgs.find((t) => t.org_id === selectedOrgId) ?? null;

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
        if (res.status === 403) throw new Error(copy.messages.adminRequired);
        throw new Error(`${copy.messages.loadFailed} (${res.status})`);
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
      setError(err instanceof Error ? err.message : copy.messages.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [loadKeys, selectedAccountId]);

  useEffect(() => {
    load();
    loadOrgs();
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
    setAccountForm({ ...EMPTY_ACCOUNT, org_id: selectedOrgId || "" });
    setDrawer("account-create");
    setError("");
  };

  const openOrgCreate = () => {
    setOrgDrawerMode("create");
    setEditingOrg(null);
    setOrgDrawerOpen(true);
  };

  const openOrgEdit = (org: GatewayOrg) => {
    setOrgDrawerMode("edit");
    setEditingOrg(org);
    setOrgDrawerOpen(true);
  };

  const handleOrgSaved = () => {
    loadOrgs();
    load();
  };

  const handleDeleteOrg = async (org: GatewayOrg) => {
    if (org.org_id === ROOT_ORG_ID) return;
    if (!window.confirm(copy.messages.deleteOrgConfirm(org.name))) return;
    try {
      const { deleteGatewayOrg } = await import("../lib/gatewayOrgs");
      await deleteGatewayOrg(org.org_id);
      setMessage(copy.messages.orgDeleted(org.name));
      loadOrgs();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.deleteFailed);
    }
  };

  const toggleOrgStatus = async (org: GatewayOrg) => {
    const next = org.status === "active" ? "disabled" : "active";
    try {
      const { updateGatewayOrg } = await import("../lib/gatewayOrgs");
      await updateGatewayOrg(org.org_id, { status: next });
      setMessage(next === "active" ? copy.messages.orgEnabled : copy.messages.orgDisabled);
      loadOrgs();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.updateFailed);
    }
  };

  const openAccountEdit = () => {
    if (!selectedAccount) return;
    setAccountForm({
      name: selectedAccount.name,
      org_id: selectedAccount.org_id,
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
        throw new Error((body as { detail?: string }).detail || `${copy.messages.saveFailed} (${res.status})`);
      }
      closeDrawer();
      setMessage(isEdit ? copy.messages.accountUpdated : copy.messages.accountCreated);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.saveFailed);
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
      if (!res.ok) throw new Error(`${copy.messages.updateFailed} (${res.status})`);
      setMessage(next === "active" ? copy.messages.accountEnabled : copy.messages.accountDisabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.updateFailed);
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
        if (!res.ok) throw new Error(`${copy.messages.updateFailed} (${res.status})`);
        closeDrawer();
        setMessage(copy.messages.keyUpdated);
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
        throw new Error((body as { detail?: string }).detail || `${copy.messages.keyIssueFailed} (${res.status})`);
      }
      const data = (await res.json()) as { secret?: string };
      setCreatedSecret(data.secret || null);
      setMessage(copy.messages.keyIssued);
      await loadKeys(selectedAccountId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.operationFailed);
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!window.confirm(copy.messages.revokeConfirm)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/keys/${encodeURIComponent(keyId)}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(`${copy.messages.revokeFailed} (${res.status})`);
      setMessage(copy.messages.revoked);
      if (selectedAccountId) await loadKeys(selectedAccountId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.revokeFailed);
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
            {scope.label[locale]}
            <span className="ml-1 text-xs text-slate-400">{scope.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );

  const keyLimitFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">{copy.monthlyTokenLimit}</span>
        <input
          type="number"
          min={0}
          value={keyForm.monthly_token_limit}
          onChange={(e) => setKeyForm({ ...keyForm, monthly_token_limit: e.target.value })}
          placeholder={copy.noLimit}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">{copy.monthlyCostLimit}</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={keyForm.monthly_cost_limit_usd}
          onChange={(e) => setKeyForm({ ...keyForm, monthly_cost_limit_usd: e.target.value })}
          placeholder={copy.noLimit}
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
          placeholder={copy.globalDefault}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">{copy.expiresAt}</span>
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
            {copy.introBefore} <code className="text-xs">evk_</code> API Key{copy.introAfterLogin}{" "}
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700">/login</Link>
            {copy.introAfterGateway} <Link to="/gateway" className="font-medium text-blue-600 hover:text-blue-700">{copy.gateway}</Link>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={openOrgCreate}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {copy.createOrg}
          </button>
          <button
            type="button"
            onClick={openAccountCreate}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {copy.createAccount}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">{copy.stats.orgs}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : orgs.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">{copy.stats.accounts}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : accounts.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">{copy.stats.activeKeys}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : totalActiveKeys}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-500">{copy.stats.currentAccount}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-950">{selectedAccount?.name || "—"}</div>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
      )}
      {error && !drawer && !orgDrawerOpen && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid min-h-[420px] gap-5 lg:grid-cols-[minmax(240px,300px)_1fr]">
        {/* Left sidebar: org view or flat account list */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setViewMode("org")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "org" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {copy.viewOrg}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("all")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "all" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {copy.viewAll}
              </button>
            </div>
            <button type="button" onClick={() => { load(); loadOrgs(); }} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              {copy.refresh}
            </button>
          </div>

          {viewMode === "org" ? (
            <div className="max-h-[520px] space-y-2 overflow-y-auto">
              {!orgs.length ? (
                <p className="px-2 py-8 text-center text-sm text-slate-500">{copy.emptyOrgs}</p>
              ) : (
                orgs.map((org) => {
                  const orgAccounts = accounts.filter((a) => a.org_id === org.org_id);
                  const isSelected = selectedOrgId === org.org_id;
                  const isRoot = org.org_id === ROOT_ORG_ID;
                  return (
                    <div key={org.org_id} className={`rounded-xl transition ${isSelected ? "bg-blue-50 ring-1 ring-blue-200" : ""}`}>
                      <div className="flex items-center gap-1 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedOrgId === org.org_id) {
                              setSelectedOrgId(null);
                            } else {
                              setSelectedOrgId(org.org_id);
                              const first = accounts.find((a) => a.org_id === org.org_id);
                              if (first) setSelectedAccountId(first.account_id);
                            }
                          }}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 text-xs text-slate-400">{isSelected ? "▼" : "▶"}</span>
                            <span className="truncate font-medium text-slate-900">
                              {isRoot ? "📁 " : "👥 "}{org.name}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                org.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {org.status === "active" ? copy.enabled : copy.disabled}
                            </span>
                          </div>
                          <div className="mt-0.5 pl-4 text-xs text-slate-500">
                            {copy.accountsCount(org.account_count)} · {org.active_keys}/{org.total_keys} keys
                          </div>
                        </button>
                        <div className="flex shrink-0 gap-0.5">
                          <button type="button" onClick={(e) => { e.stopPropagation(); openOrgEdit(org); }} className="rounded p-1 text-xs text-blue-500 hover:bg-blue-50 hover:text-blue-700" title={copy.edit}>✏️</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggleOrgStatus(org); }} className="rounded p-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600" title={org.status === "active" ? copy.disabled : copy.enabled}>
                            {org.status === "active" ? "⏸" : "▶️"}
                          </button>
                          {!isRoot && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteOrg(org); }} className="rounded p-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600" title={copy.delete}>🗑️</button>
                          )}
                        </div>
                      </div>
                      {/* Show accounts under selected org */}
                      {isSelected && orgAccounts.length > 0 && (
                        <ul className="space-y-0.5 border-t border-slate-100 px-1 py-1">
                          {orgAccounts.map((account) => (
                            <li key={account.account_id}>
                              <button
                                type="button"
                                onClick={() => setSelectedAccountId(account.account_id)}
                                className={`w-full rounded-lg px-2.5 py-2 text-left transition ${
                                  selectedAccountId === account.account_id
                                    ? "bg-white ring-1 ring-blue-300"
                                    : "hover:bg-white/60"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium text-slate-800">{account.name}</span>
                                  <span
                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                      account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                                    }`}
                                  >
                                    {account.status === "active" ? copy.enabled : copy.disabled}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-xs text-slate-400">
                                  {account.active_keys}/{account.total_keys} keys
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {isSelected && orgAccounts.length === 0 && (
                        <p className="border-t border-slate-100 px-3 py-3 text-center text-xs text-slate-400">
                          {copy.noOrgAccounts}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* Flat account list */
            !accounts.length ? (
              <p className="px-2 py-8 text-center text-sm text-slate-500">{copy.emptyAccounts}</p>
            ) : (
              <ul className="max-h-[520px] space-y-1 overflow-y-auto">
                {accounts.map((account) => {
                  const orgName = orgs.find((t) => t.org_id === account.org_id)?.name || account.org_id;
                  return (
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
                            {account.status === "active" ? copy.enabled : copy.disabled}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{account.account_id}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {account.active_keys}/{account.total_keys} keys
                          {orgName ? ` · ${orgName}` : ""}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {!selectedAccount ? (
            <p className="flex h-full min-h-[360px] items-center justify-center text-sm text-slate-500">
              {copy.chooseAccount}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-950">{selectedAccount.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{selectedAccount.account_id}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {[
                      selectedAccount.owner_email,
                      selectedOrg && `${copy.orgPrefix} ${selectedOrg.name}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || copy.missingOwnerOrg}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={openAccountEdit}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {copy.editAccount}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={toggleAccountStatus}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {selectedAccount.status === "active" ? copy.disabled : copy.enabled}
                  </button>
                  <button
                    type="button"
                    disabled={busy || selectedAccount.status !== "active"}
                    onClick={openKeyCreate}
                    className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {copy.issueKey}
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">API Keys</h3>
                <p className="mt-0.5 text-xs text-slate-500">{copy.keyNote}</p>
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
        title={copy.accountDrawerTitle(drawer === "account-edit")}
        subtitle={copy.accountDrawerSubtitle}
        onClose={closeDrawer}
      >
        {error && (drawer === "account-create" || drawer === "account-edit") && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={submitAccount} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.accountName}</span>
            <input
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.accountOrg}</span>
            <select
              value={accountForm.org_id}
              onChange={(e) => setAccountForm({ ...accountForm, org_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
            >
              <option value="">{copy.selectOrg}</option>
              {orgs.map((org) => (
                <option key={org.org_id} value={org.org_id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.ownerEmail}</span>
            <input
              type="email"
              value={accountForm.owner_email}
              onChange={(e) => setAccountForm({ ...accountForm, owner_email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.notes}</span>
            <textarea
              value={accountForm.notes}
              onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700">
              {copy.cancel}
            </button>
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {copy.save}
            </button>
          </div>
        </form>
      </GatewayDrawer>

      <GatewayDrawer
        open={drawer === "key-create" || drawer === "key-edit"}
        title={copy.keyDrawerTitle(drawer === "key-edit")}
        subtitle={selectedAccount ? selectedAccount.name : undefined}
        onClose={closeDrawer}
      >
        {error && (drawer === "key-create" || drawer === "key-edit") && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {createdSecret && drawer === "key-create" && (
          <div className="mb-4 space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">{copy.copyNow}</div>
            <pre className="overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">{createdSecret}</pre>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(createdSecret)}
              className="text-sm font-medium text-amber-900 underline"
            >
              {copy.copyKey}
            </button>
            <EasyInstallWizard apiKeyOverride={createdSecret} layout="panel" />
          </div>
        )}
        <form onSubmit={submitKey} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.label}</span>
            <input
              value={keyForm.label}
              onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
              placeholder={copy.labelPlaceholder}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <div>
            <div className="text-sm font-medium text-slate-700">{copy.scopes}</div>
            <div className="mt-2">{scopeCheckboxes}</div>
          </div>
          {keyLimitFields}
          <div className="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700">
              {createdSecret ? copy.close : copy.cancel}
            </button>
            {!createdSecret && (
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {drawer === "key-edit" ? copy.save : copy.issue}
              </button>
            )}
          </div>
        </form>
      </GatewayDrawer>

      <OrgDrawer
        open={orgDrawerOpen}
        mode={orgDrawerMode}
        org={editingOrg}
        onClose={() => { setOrgDrawerOpen(false); setEditingOrg(null); }}
        onSaved={handleOrgSaved}
      />
    </div>
  );
}
