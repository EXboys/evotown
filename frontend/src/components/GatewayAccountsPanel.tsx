import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { GatewayDrawer } from "./gateway/GatewayDrawer";
import { OrgDrawer } from "./gateway/OrgDrawer";
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
  account_type?: string;
  login_name?: string;
  role?: string;
  agent_binding_count: number;
  password_hash?: string;
  created_at: string;
  updated_at: string;
};

type WorkspaceInfo = {
  workspace_id: string;
  name: string;
  root_path: string;
  status: string;
  owner_account_id?: string;
};

type DrawerMode = null | "account-create" | "account-edit";

type AccountForm = {
  name: string;
  org_id: string;
  owner_email: string;
  notes: string;
  account_type: string;
  login_name: string;
  password: string;
  role: string;
};

const EMPTY_ACCOUNT: AccountForm = {
  name: "", org_id: "", owner_email: "", notes: "",
  account_type: "employee", login_name: "", password: "", role: "employee",
};

const ACCOUNTS_COPY = {
  zh: {
    introTitle: "员工与组织管理",
    createOrg: "新建组织",
    createAccount: "创建员工",
    stats: { orgs: "组织", accounts: "员工", agentsBound: "已绑定智能体", currentAccount: "当前员工" },
    viewOrg: "组织视图",
    viewAll: "全部员工",
    refresh: "刷新",
    emptyOrgs: "暂无组织",
    emptyAccounts: "暂无员工",
    enabled: "启用",
    disabled: "停用",
    accountsCount: (count: number) => `${count} 名员工`,
    noOrgAccounts: "该组织暂无员工",
    chooseAccount: "请选择左侧员工，或创建新员工。",
    orgPrefix: "组织",
    roleAdmin: "管理员",
    roleEmployee: "员工",
    loginNameLabel: "登录名",
    edit: "编辑",
    delete: "删除",
    boundWorkspaces: (n: number) => `${n} 个智能体`,
    editAccount: "编辑",
    resetPassword: "重置密码",
    editAccountTitle: (edit: boolean) => edit ? "编辑员工" : "新建员工",
    accountName: "姓名 *",
    loginName: "登录名 *",
    password: "密码",
    passwordHintNew: "新建时必填",
    passwordHintEdit: "留空不修改",
    role: "角色",
    roleHint: "管理员可访问企业后台，员工仅前台",
    accountOrg: "所属组织 *",
    selectOrg: "请选择组织",
    ownerEmail: "邮箱",
    notes: "备注",
    cancel: "取消",
    save: "保存",
    agentSection: "关联智能体",
    searchAgents: "搜索智能体…",
    noAgents: "暂无可用智能体",
    bindWorkspace: "添加智能体",
    unbind: "解绑",
    close: "关闭",
    bind: "绑定",
    messages: {
      adminRequired: "需要管理员权限",
      loadFailed: "加载失败",
      deleteOrgConfirm: (name: string) => `确定删除组织「${name}」？其下员工将移入默认组织。`,
      orgDeleted: (name: string) => `组织「${name}」已删除`,
      deleteFailed: "删除失败",
      orgEnabled: "组织已启用",
      orgDisabled: "组织已停用",
      updateFailed: "更新失败",
      saveFailed: "保存失败",
      accountUpdated: "员工已更新",
      accountCreated: "员工已创建",
      accountEnabled: "员工已启用",
      accountDisabled: "员工已停用",
      operationFailed: "操作失败",
      unbindConfirm: (agent: string) => `确定解除与「${agent}」的绑定？`,
      bindFailed: "绑定失败",
      unbindFailed: "解绑失败",
      passwordReset: "密码已重置",
    },
  },
  en: {
    introTitle: "Employee & Organization Management",
    createOrg: "New Org",
    createAccount: "Create Employee",
    stats: { orgs: "Orgs", accounts: "Employees", agentsBound: "Bound Agents", currentAccount: "Current" },
    viewOrg: "Org View",
    viewAll: "All Employees",
    refresh: "Refresh",
    emptyOrgs: "No organizations",
    emptyAccounts: "No employees",
    enabled: "Enabled",
    disabled: "Disabled",
    accountsCount: (count: number) => `${count} employees`,
    noOrgAccounts: "No employees in this org",
    chooseAccount: "Select an employee on the left, or create a new one.",
    orgPrefix: "Org",
    roleAdmin: "Admin",
    roleEmployee: "Employee",
    loginNameLabel: "Login name",
    edit: "Edit",
    delete: "Delete",
    boundWorkspaces: (n: number) => `${n} agents`,
    editAccount: "Edit",
    resetPassword: "Reset Password",
    editAccountTitle: (edit: boolean) => edit ? "Edit Employee" : "Create Employee",
    accountName: "Name *",
    loginName: "Login Name *",
    password: "Password",
    passwordHintNew: "Required for new accounts",
    passwordHintEdit: "Leave blank to keep unchanged",
    role: "Role",
    roleHint: "Admin can access dashboard; Employee: frontend only",
    accountOrg: "Organization *",
    selectOrg: "Select organization",
    ownerEmail: "Email",
    notes: "Notes",
    cancel: "Cancel",
    save: "Save",
    agentSection: "Agent Bindings",
    searchAgents: "Search agents…",
    noAgents: "No agents available",
    bindWorkspace: "Add Agent",
    unbind: "Unbind",
    close: "Close",
    bind: "Bind",
    messages: {
      adminRequired: "Admin permission required",
      loadFailed: "Load failed",
      deleteOrgConfirm: (name: string) => `Delete organization "${name}"?`,
      orgDeleted: (name: string) => `Deleted organization "${name}"`,
      deleteFailed: "Delete failed",
      orgEnabled: "Organization enabled",
      orgDisabled: "Organization disabled",
      updateFailed: "Update failed",
      saveFailed: "Save failed",
      accountUpdated: "Employee updated",
      accountCreated: "Employee created",
      accountEnabled: "Employee enabled",
      accountDisabled: "Employee disabled",
      operationFailed: "Operation failed",
      unbindConfirm: (agent: string) => `Unbind "${agent}"?`,
      bindFailed: "Bind failed",
      unbindFailed: "Unbind failed",
      passwordReset: "Password reset",
    },
  },
} as const;

export function GatewayAccountsPanel({ locale = "zh" }: { locale?: Locale }) {
  const copy = ACCOUNTS_COPY[locale];
  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [orgs, setOrgs] = useState<GatewayOrg[]>([]);
  const [viewMode, setViewMode] = useState<"org" | "all">("org");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
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

  // Workspace binding state
  const [boundWorkspaces, setBoundWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [agentSearch, setAgentSearch] = useState("");
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

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

  const loadBoundWorkspaces = useCallback(async (accountId: string) => {
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/workspaces`);
      if (res.ok) {
        const data = await res.json() as { workspaces?: WorkspaceInfo[] };
        setBoundWorkspaces(data.workspaces || []);
      } else {
        setBoundWorkspaces([]);
      }
    } catch {
      setBoundWorkspaces([]);
    }
  }, []);

  const loadAllWorkspaces = useCallback(async () => {
    try {
      const res = await adminFetch("/api/v1/workspaces?limit=500&include_all=true");
      if (res.ok) {
        const data = await res.json() as { workspaces?: WorkspaceInfo[] };
        setAllWorkspaces(data.workspaces || []);
      }
    } catch {
      // silent
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
      if (keepId) await loadBoundWorkspaces(keepId);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [loadBoundWorkspaces, selectedAccountId]);

  useEffect(() => { load(); loadOrgs(); loadAllWorkspaces(); }, []);

  useEffect(() => {
    if (selectedAccountId) loadBoundWorkspaces(selectedAccountId);
  }, [selectedAccountId, loadBoundWorkspaces]);

  const closeDrawer = () => {
    setDrawer(null);
    setAccountForm(EMPTY_ACCOUNT);
    setShowAgentPicker(false);
    setAgentSearch("");
  };

  const selectedAccount = accounts.find((a) => a.account_id === selectedAccountId) ?? null;
  const totalBoundAgents = accounts.reduce((sum, a) => sum + (a.agent_binding_count || 0), 0);

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

  const handleOrgSaved = () => { loadOrgs(); load(); };

  const handleDeleteOrg = async (org: GatewayOrg) => {
    if (org.org_id === ROOT_ORG_ID) return;
    if (!window.confirm(copy.messages.deleteOrgConfirm(org.name))) return;
    try {
      const { deleteGatewayOrg } = await import("../lib/gatewayOrgs");
      await deleteGatewayOrg(org.org_id);
      setMessage(copy.messages.orgDeleted(org.name));
      loadOrgs(); load();
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
      account_type: selectedAccount.account_type || "employee",
      login_name: selectedAccount.login_name || "",
      password: "",
      role: selectedAccount.role || "employee",
    });
    setDrawer("account-edit");
    setError("");
  };

  const submitAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountForm.name.trim() || !accountForm.login_name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const isEdit = drawer === "account-edit" && selectedAccountId;
      const payload: Record<string, unknown> = {
        name: accountForm.name.trim(),
        org_id: accountForm.org_id,
        owner_email: accountForm.owner_email.trim(),
        notes: accountForm.notes.trim(),
        account_type: accountForm.account_type,
        login_name: accountForm.login_name.trim(),
        role: accountForm.role,
      };
      if (accountForm.password) {
        payload.password = accountForm.password;
      }

      const res = await adminFetch(
        isEdit ? `/api/v1/accounts/${encodeURIComponent(selectedAccountId!)}` : "/api/v1/accounts",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `${copy.messages.saveFailed} (${res.status})`);
      }
      // Save agent bindings on create
      if (!isEdit) {
        const created = await res.json() as { account?: { account_id?: string } };
        const newId = created.account?.account_id;
        if (newId && selectedAgentIds.size > 0) {
          for (const wsId of selectedAgentIds) {
            await adminFetch(`/api/v1/accounts/${encodeURIComponent(newId)}/bind-workspace`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ workspace_id: wsId }),
            }).catch(() => {});
          }
        }
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

  const resetPassword = async () => {
    if (!selectedAccount) return;
    const pw = window.prompt(locale === "zh" ? "输入新密码：" : "Enter new password:");
    if (!pw) return;
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccount.account_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) throw new Error(`${copy.messages.updateFailed} (${res.status})`);
      setMessage(copy.messages.passwordReset);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.messages.operationFailed);
    } finally {
      setBusy(false);
    }
  };

  const bindWorkspace = async (workspaceId: string) => {
    if (!selectedAccountId) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccountId)}/bind-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      if (!res.ok && res.status !== 409) throw new Error(copy.messages.bindFailed);
      await loadBoundWorkspaces(selectedAccountId);
      await load();
    } catch {
      setError(copy.messages.bindFailed);
    } finally {
      setBusy(false);
    }
  };

  const unbindWorkspace = async (workspaceId: string, workspaceName: string) => {
    if (!selectedAccountId) return;
    if (!window.confirm(copy.messages.unbindConfirm(workspaceName))) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(selectedAccountId)}/bind-workspace`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      if (!res.ok) throw new Error(copy.messages.unbindFailed);
      await loadBoundWorkspaces(selectedAccountId);
      await load();
    } catch {
      setError(copy.messages.unbindFailed);
    } finally {
      setBusy(false);
    }
  };

  // Filter workspaces for picker
  const boundWsIds = new Set(boundWorkspaces.map((ws) => ws.workspace_id));
  const pickableWorkspaces = allWorkspaces.filter((ws) => !boundWsIds.has(ws.workspace_id));
  const filteredPickable = agentSearch
    ? pickableWorkspaces.filter((ws) => ws.name.toLowerCase().includes(agentSearch.toLowerCase()))
    : pickableWorkspaces;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{copy.introTitle}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={openOrgCreate}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {copy.createOrg}
          </button>
          <button type="button" onClick={openAccountCreate}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">
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
          <div className="text-xs font-medium uppercase text-slate-500">{copy.stats.agentsBound}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : totalBoundAgents}</div>
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

      <div className="grid min-h-[420px] gap-5 lg:grid-cols-[minmax(260px,320px)_1fr]">
        {/* Left sidebar */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex gap-1">
              <button type="button" onClick={() => setViewMode("org")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${viewMode === "org" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {copy.viewOrg}
              </button>
              <button type="button" onClick={() => setViewMode("all")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${viewMode === "all" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {copy.viewAll}
              </button>
            </div>
            <button type="button" onClick={() => { load(); loadOrgs(); loadAllWorkspaces(); }}
              className="text-xs font-medium text-blue-600 hover:text-blue-800">
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
                        <button type="button" onClick={() => {
                          if (selectedOrgId === org.org_id) {
                            setSelectedOrgId(null);
                          } else {
                            setSelectedOrgId(org.org_id);
                            const first = accounts.find((a) => a.org_id === org.org_id);
                            if (first) setSelectedAccountId(first.account_id);
                          }
                        }} className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 text-xs text-slate-400">{isSelected ? "▼" : "▶"}</span>
                            <span className="truncate font-medium text-slate-900">
                              {isRoot ? "📁 " : "👥 "}{org.name}
                            </span>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              org.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                            }`}>
                              {org.status === "active" ? copy.enabled : copy.disabled}
                            </span>
                          </div>
                          <div className="mt-0.5 pl-4 text-xs text-slate-500">
                            {copy.accountsCount(org.account_count)}
                          </div>
                        </button>
                        <div className="flex shrink-0 gap-0.5">
                          <button type="button" onClick={(e) => { e.stopPropagation(); openOrgEdit(org); }} className="rounded p-1 text-xs text-blue-500 hover:bg-blue-50" title={copy.edit}>✏️</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggleOrgStatus(org); }} className="rounded p-1 text-xs text-slate-400 hover:bg-slate-100" title={org.status === "active" ? copy.disabled : copy.enabled}>
                            {org.status === "active" ? "⏸" : "▶️"}
                          </button>
                          {!isRoot && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteOrg(org); }} className="rounded p-1 text-xs text-red-400 hover:bg-red-50" title={copy.delete}>🗑️</button>
                          )}
                        </div>
                      </div>
                      {isSelected && orgAccounts.length > 0 && (
                        <ul className="space-y-0.5 border-t border-slate-100 px-1 py-1">
                          {orgAccounts.map((account) => (
                            <li key={account.account_id}>
                              <button type="button" onClick={() => setSelectedAccountId(account.account_id)}
                                className={`w-full rounded-lg px-2.5 py-2 text-left transition ${
                                  selectedAccountId === account.account_id
                                    ? "bg-white ring-1 ring-blue-300"
                                    : "hover:bg-white/60"
                                }`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium text-slate-800">{account.name}</span>
                                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                    account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                                  }`}>
                                    {account.status === "active" ? copy.enabled : copy.disabled}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-xs text-slate-400">
                                  {account.login_name || account.account_id.slice(0, 12)}
                                  {account.role === "admin" ? ` · ${copy.roleAdmin}` : ` · ${copy.roleEmployee}`}
                                </div>
                                <div className="text-xs text-slate-400">
                                  {copy.boundWorkspaces(account.agent_binding_count || 0)}
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
            !accounts.length ? (
              <p className="px-2 py-8 text-center text-sm text-slate-500">{copy.emptyAccounts}</p>
            ) : (
              <ul className="max-h-[520px] space-y-1 overflow-y-auto">
                {accounts.map((account) => {
                  const orgName = orgs.find((t) => t.org_id === account.org_id)?.name || "";
                  return (
                    <li key={account.account_id}>
                      <button type="button" onClick={() => setSelectedAccountId(account.account_id)}
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                          selectedAccountId === account.account_id
                            ? "bg-blue-50 ring-1 ring-blue-200"
                            : "hover:bg-slate-50"
                        }`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-slate-900">{account.name}</span>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                          }`}>
                            {account.status === "active" ? copy.enabled : copy.disabled}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {account.login_name || account.account_id.slice(0, 12)}
                          {account.role === "admin" ? ` · ${copy.roleAdmin}` : ` · ${copy.roleEmployee}`}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {copy.boundWorkspaces(account.agent_binding_count || 0)}
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

        {/* Right detail panel */}
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
                  <p className="mt-0.5 text-sm text-slate-500">
                    {selectedAccount.login_name && (
                      <span className="mr-2 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{selectedAccount.login_name}</span>
                    )}
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      selectedAccount.role === "admin" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                    }`}>
                      {selectedAccount.role === "admin" ? copy.roleAdmin : copy.roleEmployee}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {[selectedOrg?.name && `${copy.orgPrefix} ${selectedOrg.name}`, selectedAccount.owner_email]
                      .filter(Boolean).join(" · ") || copy.messages.operationFailed}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={openAccountEdit}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {copy.editAccount}
                  </button>
                  <button type="button" disabled={busy} onClick={resetPassword}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {copy.resetPassword}
                  </button>
                  <button type="button" disabled={busy} onClick={toggleAccountStatus}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {selectedAccount.status === "active" ? copy.disabled : copy.enabled}
                  </button>
                </div>
              </div>

              {/* Agent bindings */}
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{copy.agentSection}</h3>
                  {pickableWorkspaces.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => setShowAgentPicker(!showAgentPicker)}
                      className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">
                      {showAgentPicker ? copy.close : `+ ${copy.bindWorkspace}`}
                    </button>
                  )}
                </div>

                {/* Agent picker dropdown */}
                {showAgentPicker && (
                  <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                    <input type="text" value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      placeholder={copy.searchAgents}
                      className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {filteredPickable.length === 0 ? (
                        <p className="py-2 text-center text-xs text-slate-400">{copy.noAgents}</p>
                      ) : (
                        filteredPickable.map((ws) => (
                          <button key={ws.workspace_id} type="button"
                            onClick={() => { bindWorkspace(ws.workspace_id); setShowAgentPicker(false); setAgentSearch(""); }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-[11px] font-semibold text-white">
                              {ws.name.charAt(0)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800">{ws.name}</p>
                              <p className="text-xs text-slate-400">{ws.root_path || ws.workspace_id}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Bound agents list */}
                <div className="mt-3">
                  {boundWorkspaces.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">—</p>
                  ) : (
                    <div className="space-y-2">
                      {boundWorkspaces.map((ws) => (
                        <div key={ws.workspace_id}
                          className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-xs font-semibold text-white">
                              {ws.name.charAt(0)}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-slate-800">{ws.name}</p>
                              <p className="text-xs text-slate-400">
                                {ws.root_path || ws.workspace_id}
                                {ws.status ? ` · ${ws.status}` : ""}
                              </p>
                            </div>
                          </div>
                          <button type="button" disabled={busy}
                            onClick={() => unbindWorkspace(ws.workspace_id, ws.name)}
                            className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50">
                            {copy.unbind}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Account drawer */}
      <GatewayDrawer
        open={drawer === "account-create" || drawer === "account-edit"}
        title={copy.editAccountTitle(drawer === "account-edit")}
        onClose={closeDrawer}>
        {error && (drawer === "account-create" || drawer === "account-edit") && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={submitAccount} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.accountName}</span>
            <input value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.loginName}</span>
            <input value={accountForm.login_name}
              onChange={(e) => setAccountForm({ ...accountForm, login_name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required
              autoComplete="off" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.password}</span>
            <span className="ml-1 text-xs text-slate-400">
              {drawer === "account-create" ? copy.passwordHintNew : copy.passwordHintEdit}
            </span>
            <input type="password" value={accountForm.password}
              onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              autoComplete="new-password" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.role}</span>
            <span className="ml-1 text-xs text-slate-400">{copy.roleHint}</span>
            <select value={accountForm.role}
              onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="employee">{copy.roleEmployee}</option>
              <option value="admin">{copy.roleAdmin}</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.accountOrg}</span>
            <select value={accountForm.org_id}
              onChange={(e) => setAccountForm({ ...accountForm, org_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required>
              <option value="">{copy.selectOrg}</option>
              {orgs.map((org) => (
                <option key={org.org_id} value={org.org_id}>{org.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.ownerEmail}</span>
            <input type="email" value={accountForm.owner_email}
              onChange={(e) => setAccountForm({ ...accountForm, owner_email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{copy.notes}</span>
            <textarea value={accountForm.notes} rows={2}
              onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>

          {/* Agent checkboxes (create mode only) */}
          {drawer === "account-create" && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700">{copy.agentSection}</h4>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {allWorkspaces.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-400">{copy.noAgents}</p>
                ) : (
                  allWorkspaces.map((ws) => {
                    const checked = selectedAgentIds.has(ws.workspace_id);
                    return (
                      <label key={ws.workspace_id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                        <input type="checkbox" checked={checked}
                          onChange={() => {
                            const next = new Set(selectedAgentIds);
                            if (checked) next.delete(ws.workspace_id);
                            else next.add(ws.workspace_id);
                            setSelectedAgentIds(next);
                          }}
                          className="h-4 w-4" />
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-[11px] font-semibold text-white">
                          {ws.name.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-800">{ws.name}</p>
                          <p className="text-xs text-slate-400">{ws.root_path || ws.workspace_id}</p>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeDrawer}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {copy.cancel}
            </button>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {copy.save}
            </button>
          </div>
        </form>
      </GatewayDrawer>

      {/* Org drawer */}
      <OrgDrawer open={orgDrawerOpen} mode={orgDrawerMode} org={editingOrg}
        onClose={() => setOrgDrawerOpen(false)} onSaved={handleOrgSaved} />
    </div>
  );
}
