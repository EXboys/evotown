import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { adminFetch, getAdminToken } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import type { Locale } from "../lib/i18n";

type Workspace = {
  workspace_id: string;
  owner_account_id: string;
  tenant_id?: string;
  team_id?: string;
  name: string;
  root_path: string;
  status: "active" | "archived";
  storage_quota_mb?: number;
  created_at: string;
  updated_at: string;
};

type Account = { account_id: string; name?: string; owner_email?: string };
type Viewer = { is_admin: boolean; account_id: string };

type AgentRun = {
  run_id: string;
  workspace_id: string;
  prompt: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  created_at: string;
};

const STATUS_META: Record<AgentRun["status"], { label: string; className: string; dot: string }> = {
  queued: { label: "排队中", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
  running: { label: "运行中", className: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500 animate-pulse" },
  succeeded: { label: "完成", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  cancelled: { label: "已取消", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
};

const COPY = {
  zh: {
    eyebrow: "Coding Agent",
    title: "中心托管 Claude Coding Agent",
    subtitle: "为每个账号创建私有沙盒 workspace，统一注入公共 skills 与知识库上下文。",
    refresh: "刷新",
    newWorkspace: "新建 Workspace",
    workspaceName: "Workspace 名称",
    create: "创建",
    cancel: "取消",
    open: "打开工作台",
    statWorkspaces: "Workspaces",
    statActive: "进行中的任务",
    statTotalRuns: "累计运行",
    recentActivity: "最近活动",
    noRuns: "暂无运行",
    empty: "还没有 workspace，点右上角「新建 Workspace」创建你的第一个私有沙盒。",
    dryRunHint: "未配置 EVOTOWN_CLAUDE_CODE_COMMAND 时，后端执行 dry-run 并写入 .evotown 上下文文件。",
    updated: "更新于",
    edit: "设置",
    editWorkspace: "编辑 Workspace",
    owner: "绑定账号",
    ownerHint: "把这个私有空间分配给某个账号（仅管理员）。",
    ownerReadonly: "当前绑定账号（仅管理员可重新分配）。",
    quota: "空间配额 (MB)",
    quotaHint: "0 表示不限制。仅管理员可修改。",
    save: "保存",
    saving: "保存中…",
    archive: "归档",
    restore: "恢复启用",
    archivedTag: "已归档",
    selectAccount: "选择账号…",
    showArchived: "显示已归档",
  },
  en: {
    eyebrow: "Coding Agent",
    title: "Hosted Claude Coding Agent",
    subtitle: "Private sandbox workspaces with shared public skills and knowledge context.",
    refresh: "Refresh",
    newWorkspace: "New Workspace",
    workspaceName: "Workspace name",
    create: "Create",
    cancel: "Cancel",
    open: "Open workspace",
    statWorkspaces: "Workspaces",
    statActive: "Active runs",
    statTotalRuns: "Total runs",
    recentActivity: "Recent activity",
    noRuns: "No runs yet",
    empty: "No workspace yet. Click \"New Workspace\" to create your first private sandbox.",
    dryRunHint: "Without EVOTOWN_CLAUDE_CODE_COMMAND, the backend performs a dry-run and writes .evotown context files.",
    updated: "Updated",
    edit: "Settings",
    editWorkspace: "Edit workspace",
    owner: "Bound account",
    ownerHint: "Assign this private space to an account (admin only).",
    ownerReadonly: "Currently bound account (admin only can reassign).",
    quota: "Storage quota (MB)",
    quotaHint: "0 means unlimited. Admin only.",
    save: "Save",
    saving: "Saving…",
    archive: "Archive",
    restore: "Restore",
    archivedTag: "Archived",
    selectAccount: "Select account…",
    showArchived: "Show archived",
  },
} as const;

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

export function CodingAgentPage({ locale }: { locale: Locale; initialWorkspaceId?: string }) {
  const navigate = useNavigate();
  const copy = COPY[locale];
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Personal Sandbox");
  const [workspaceOwner, setWorkspaceOwner] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [viewer, setViewer] = useState<Viewer>({ is_admin: Boolean(getAdminToken()), account_id: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [editing, setEditing] = useState<Workspace | null>(null);
  const [editName, setEditName] = useState("");
  const [editOwner, setEditOwner] = useState("");
  const [editQuota, setEditQuota] = useState("0");

  const isAdmin = viewer.is_admin || Boolean(getAdminToken());

  const runsByWorkspace = useMemo(() => {
    const map = new Map<string, AgentRun[]>();
    for (const run of runs) {
      const list = map.get(run.workspace_id) || [];
      list.push(run);
      map.set(run.workspace_id, list);
    }
    return map;
  }, [runs]);

  const stats = useMemo(() => {
    const active = runs.filter((run) => run.status === "running" || run.status === "queued").length;
    return { workspaces: workspaces.length, active, totalRuns: runs.length };
  }, [workspaces, runs]);

  const load = async () => {
    setMessage("");
    try {
      const base = "/api/v1/workspaces";
      const params = new URLSearchParams();
      if (showArchived) params.set("status_filter", "");
      // Always request include_all — backend filters by account for non-admins
      params.set("include_all", "true");
      const qs = params.toString();
      const url = `${base}?${qs}`;
      const wsData = await adminFetch(url).then((res) =>
        readJson<{ workspaces?: Workspace[]; viewer?: Viewer }>(res),
      );
      setWorkspaces(wsData.workspaces || []);
      if (wsData.viewer) setViewer(wsData.viewer);
      const runData = await adminFetch("/api/v1/agent-runs?limit=200").then((res) =>
        readJson<{ runs?: AgentRun[] }>(res),
      );
      setRuns(runData.runs || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  // 管理员加载账号列表，用于"绑定账号"下拉。
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void adminFetch("/api/v1/accounts?limit=200")
      .then((res) => readJson<{ accounts?: Account[] }>(res))
      .then((data) => {
        if (!cancelled) setAccounts(data.accounts || []);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const createWorkspace = async () => {
    if (!workspaceName.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await adminFetch("/api/v1/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: workspaceName, ...(workspaceOwner ? { owner_account_id: workspaceOwner } : {}) }),
      }).then((res) => readJson<{ workspace: Workspace }>(res));
      window.location.assign(`/coding-agent/workspaces/${encodeURIComponent(data.workspace.workspace_id)}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  };

  const openEdit = (workspace: Workspace) => {
    setEditing(workspace);
    setEditName(workspace.name);
    setEditOwner(workspace.owner_account_id);
    setEditQuota(String(workspace.storage_quota_mb ?? 0));
    setMessage("");
  };

  const patchWorkspace = async (payload: Record<string, unknown>) => {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    try {
      if (Object.keys(payload).length) {
        await adminFetch(`/api/v1/workspaces/${encodeURIComponent(editing.workspace_id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }).then((res) => readJson(res));
      }
      setEditing(null);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const saveWorkspace = () => {
    if (!editing) return;
    const payload: Record<string, unknown> = {};
    if (editName.trim() && editName.trim() !== editing.name) payload.name = editName.trim();
    if (isAdmin && editOwner.trim() && editOwner.trim() !== editing.owner_account_id) {
      payload.owner_account_id = editOwner.trim();
    }
    if (isAdmin) {
      const quota = Number(editQuota);
      if (Number.isFinite(quota) && quota >= 0 && quota !== (editing.storage_quota_mb ?? 0)) {
        payload.storage_quota_mb = quota;
      }
    }
    void patchWorkspace(payload);
  };

  const toggleArchive = () => {
    if (!editing) return;
    void patchWorkspace({ status: editing.status === "archived" ? "active" : "archived" });
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">{copy.eyebrow}</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2>
            <p className="mt-2 text-sm text-indigo-100">{copy.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/20">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                className="h-3.5 w-3.5 accent-white"
              />
              {copy.showArchived}
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/20 disabled:opacity-50"
            >
              {loading ? "…" : copy.refresh}
            </button>
            <button
              type="button"
              onClick={() => { setWorkspaceOwner(""); setCreating(true); }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
            >
              ＋ 新建助理
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: copy.statWorkspaces, value: stats.workspaces },
            { label: copy.statActive, value: stats.active },
            { label: copy.statTotalRuns, value: stats.totalRuns },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
              <div className="text-2xl font-semibold tabular-nums">{stat.value}</div>
              <div className="mt-0.5 text-xs text-indigo-100">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>
      )}

      {/* Workspace grid */}
      {loading && !workspaces.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-200" />
              <div className="mt-4 h-4 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              <div className="mt-6 h-9 w-full animate-pulse rounded-lg bg-slate-100" />
            </div>
          ))}
        </div>
      ) : workspaces.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => {
            const wsRuns = runsByWorkspace.get(workspace.workspace_id) || [];
            const lastRun = wsRuns[0];
            const archived = workspace.status === "archived";
            return (
              <a
                key={workspace.workspace_id}
                href={`/coding-agent/workspaces/${encodeURIComponent(workspace.workspace_id)}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.button === 1) return;
                  event.preventDefault();
                  navigate(`/coding-agent/workspaces/${encodeURIComponent(workspace.workspace_id)}`);
                }}
                className={`group flex flex-col rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md ${
                  archived ? "border-slate-200 opacity-70" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-base font-bold text-white">
                    {workspace.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {archived ? (
                      <Badge className="border-slate-200 bg-slate-100 text-slate-500">{copy.archivedTag}</Badge>
                    ) : (
                      <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">🔒 私有</Badge>
                    )}
                    <button
                      type="button"
                      title={copy.edit}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openEdit(workspace);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                    >
                      ⚙
                    </button>
                  </div>
                </div>
                <div className="mt-4 truncate text-base font-semibold text-slate-900">{workspace.name}</div>
                <div className="mt-1 truncate font-mono text-xs text-slate-400">{workspace.workspace_id}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span>👤</span>
                  <span className="truncate">{workspace.owner_account_id || "—"}</span>
                  {workspace.storage_quota_mb ? <span>· {workspace.storage_quota_mb} MB</span> : null}
                </div>

                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {copy.recentActivity}
                  </div>
                  {lastRun ? (
                    <div className="mt-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[lastRun.status].dot}`} />
                        <span className="text-xs font-medium text-slate-600">{STATUS_META[lastRun.status].label}</span>
                        <span className="ml-auto text-[11px] text-slate-400">
                          {formatDateTimeShort(lastRun.created_at)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">{lastRun.prompt}</div>
                    </div>
                  ) : (
                    <div className="mt-1.5 text-xs text-slate-400">{copy.noRuns}</div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    {copy.updated} {formatDateTimeShort(workspace.updated_at)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition group-hover:bg-indigo-700">
                    {copy.open} →
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl">📁</div>
          <p className="mx-auto max-w-md text-sm text-slate-500">{copy.empty}</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            ＋ 新建助理
          </button>
        </div>
      )}

      <p className="text-xs text-slate-400">{copy.dryRunHint}</p>

      {/* Create modal */}
      {creating && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={() => !busy && setCreating(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-lg font-semibold text-slate-900">新建助理</div>
            <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
            <label className="mt-5 block text-sm font-medium text-slate-700">{copy.workspaceName}</label>
            <input
              autoFocus
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createWorkspace();
              }}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {isAdmin && (
              <label className="mt-4 block text-sm font-medium text-slate-700">
                绑定账号
                {accounts.length ? (
                  <select
                    value={workspaceOwner}
                    onChange={(e) => setWorkspaceOwner(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">选择账号…</option>
                    {accounts.map((account) => (
                      <option key={account.account_id} value={account.account_id}>
                        {account.name ? `${account.name} · ${account.account_id}` : account.account_id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={workspaceOwner}
                    onChange={(e) => setWorkspaceOwner(e.target.value)}
                    placeholder="account_id"
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                )}
                <p className="mt-1 text-xs text-slate-400">把这个助理绑定给指定账号（不选则绑定自己）</p>
              </label>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={() => void createWorkspace()}
                disabled={busy || !workspaceName.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "创建中…" : copy.create}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={() => !busy && setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="text-lg font-semibold text-slate-900">{copy.editWorkspace}</div>
              <span className="font-mono text-[11px] text-slate-400">{editing.workspace_id}</span>
            </div>

            <label className="mt-5 block text-sm font-medium text-slate-700">{copy.workspaceName}</label>
            <input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />

            <label className="mt-4 block text-sm font-medium text-slate-700">{copy.owner}</label>
            {isAdmin ? (
              <>
                {accounts.length ? (
                  <select
                    value={editOwner}
                    onChange={(event) => setEditOwner(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    {!accounts.some((a) => a.account_id === editOwner) && (
                      <option value={editOwner}>{editOwner || copy.selectAccount}</option>
                    )}
                    {accounts.map((account) => (
                      <option key={account.account_id} value={account.account_id}>
                        {account.name ? `${account.name} · ${account.account_id}` : account.account_id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={editOwner}
                    onChange={(event) => setEditOwner(event.target.value)}
                    placeholder="account_id"
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                )}
                <p className="mt-1 text-xs text-slate-400">{copy.ownerHint}</p>
              </>
            ) : (
              <>
                <input
                  value={editOwner}
                  disabled
                  className="mt-2 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                />
                <p className="mt-1 text-xs text-slate-400">{copy.ownerReadonly}</p>
              </>
            )}

            <label className="mt-4 block text-sm font-medium text-slate-700">{copy.quota}</label>
            <input
              type="number"
              min={0}
              value={editQuota}
              disabled={!isAdmin}
              onChange={(event) => setEditQuota(event.target.value)}
              className={`mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${
                isAdmin ? "" : "cursor-not-allowed bg-slate-50 text-slate-500"
              }`}
            />
            <p className="mt-1 text-xs text-slate-400">{copy.quotaHint}</p>

            <div className="mt-6 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleArchive}
                disabled={busy}
                className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  editing.status === "archived"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
              >
                {editing.status === "archived" ? copy.restore : copy.archive}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {copy.cancel}
                </button>
                <button
                  type="button"
                  onClick={saveWorkspace}
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? copy.saving : copy.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
