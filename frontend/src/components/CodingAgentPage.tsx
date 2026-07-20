import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { adminFetch, isAdmin } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import type { Locale } from "../lib/i18n";
import { GatewayDrawer } from "./gateway/GatewayDrawer";
import { SkillsAssignmentPanel } from "./SkillsAssignmentPanel";
import { EmployeeGatewayPanel } from "./EmployeeGatewayPanel";

type Agent = {
  agent_id: string;
  owner_account_id: string;
  tenant_id?: string;
  team_id?: string;
  name: string;
  root_path: string;
  status: "active" | "archived" | "deleted";
  storage_quota_mb?: number;
  model_policy?: string;
  category?: string;
  template_id?: string;
  template_name?: string;
  created_at: string;
  updated_at: string;
};

type Viewer = { is_admin: boolean; account_id: string };

type AgentRun = {
  run_id: string;
  agent_id: string;
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
    eyebrow: "智能体",
    title: "中心托管 Claude 智能体",
    subtitle: "为每个账号创建私有智能体空间，统一注入公共 skills 与知识库上下文。",
    refresh: "刷新",
    newAgent: "新建智能体",
    agentName: "智能体名称",
    create: "创建",
    cancel: "取消",
    open: "打开工作台",
    statAgents: "智能体",
    statActive: "进行中的任务",
    statTotalRuns: "累计运行",
    recentActivity: "最近活动",
    noRuns: "暂无运行",
    empty: "还没有智能体，点右上角「新建智能体」创建你的第一个私有智能体空间。",
    dryRunHint: "未配置 EVOTOWN_CLAUDE_CODE_COMMAND 时，后端执行 dry-run 并写入 .evotown 上下文文件。",
    updated: "更新于",
    edit: "设置",
    editAgent: "编辑智能体",
    owner: "绑定账号",
    ownerHint: "把这个智能体绑定给指定账号（仅管理员）。",
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
    gateway: "本地部署",
    gatewayTitle: "本地部署 · 网关配置",
    gatewayHint: "SkillLite 复制两行 .env；OpenClaw/Hermes 用 Gateway URL + Key。",
    modeCloud: "云端智能体",
    modeLocal: "本地部署",
    modeCloudDesc: "浏览器内直接使用，无需本机配置",
    modeLocalDesc: "OpenClaw / Hermes / SkillLite 本机接入",
  },
  en: {
    eyebrow: "Coding Agent",
    title: "Hosted Claude Coding Agent",
    subtitle: "Private sandbox agents with shared public skills and knowledge context.",
    refresh: "Refresh",
    newAgent: "New Agent",
    agentName: "Agent name",
    create: "Create",
    cancel: "Cancel",
    open: "Open agent",
    statAgents: "Agents",
    statActive: "Active runs",
    statTotalRuns: "Total runs",
    recentActivity: "Recent activity",
    noRuns: "No runs yet",
    empty: "No agent yet. Click \"New Agent\" to create your first private sandbox.",
    dryRunHint: "Without EVOTOWN_CLAUDE_CODE_COMMAND, the backend performs a dry-run and writes .evotown context files.",
    updated: "Updated",
    edit: "Settings",
    editAgent: "Edit agent",
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
    gateway: "Local deploy",
    gatewayTitle: "Local deploy · Gateway",
    gatewayHint: "SkillLite: copy two-line .env. OpenClaw/Hermes: Gateway URL + Key.",
    modeCloud: "Cloud agents",
    modeLocal: "Local deploy",
    modeCloudDesc: "Use in the browser; no local config",
    modeLocalDesc: "OpenClaw / Hermes / SkillLite on your machine",
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

export function CodingAgentPage({ locale }: { locale: Locale; initialAgentId?: string }) {
  const navigate = useNavigate();
  const copy = COPY[locale];
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [agentName, setAgentName] = useState("Personal Sandbox");
  const [createPolicy, setCreatePolicy] = useState<"all" | "routes_only">("routes_only");
  const [createTemplateId, setCreateTemplateId] = useState("");
  const [createRoleIds, setCreateRoleIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<{ role_id: string; name: string; description: string }[]>([]);
  const [templates, setTemplates] = useState<{ template_id: string; name: string; category: string; description: string; soul?: string; paradigm?: string; standards?: string; default_model?: string; default_skills?: string[] }[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<"employee" | "department" | "dedicated">("dedicated");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "deleted">("active");

  const [viewer, setViewer] = useState<Viewer>({ is_admin: isAdmin(), account_id: "" });

  const [editing, setEditing] = useState<Agent | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuota, setEditQuota] = useState("0");
  const [editPolicy, setEditPolicy] = useState<"all" | "routes_only">("all");
  const [skillsWsId, setSkillsWsId] = useState<string | null>(null);
  const [skillsWsName, setSkillsWsName] = useState("");
  const [editMembers, setEditMembers] = useState<Array<{ account_id: string; account_name?: string; login_name?: string; role: string; bound_at: string }>>([]);
  const [pageMode, setPageMode] = useState<"cloud" | "local">("cloud");
  const [viewingTemplate, setViewingTemplate] = useState<typeof templates[number] | null>(null);

  const isAdminLocal = viewer.is_admin || isAdmin();

  const _tpl = editing?.template_id ? templates.find((t) => t.template_id === editing.template_id) : null;

  const runsByAgent = useMemo(() => {
    const map = new Map<string, AgentRun[]>();
    for (const run of runs) {
      const list = map.get(run.agent_id) || [];
      list.push(run);
      map.set(run.agent_id, list);
    }
    return map;
  }, [runs]);

  const stats = useMemo(() => {
    const active = runs.filter((run) => run.status === "running" || run.status === "queued").length;
    return { agents: agents.length, active, totalRuns: runs.length };
  }, [agents, runs]);

  const openCreate = () => {
    setCreating(true);
    setAgentName("");
    setCreateTemplateId("");
    setCreateRoleIds([]);
    // Fetch roles for binding
    adminFetch("/api/v1/mcp-roles")
      .then(r => r.json())
      .then(d => setRoles((d.roles || []) as { role_id: string; name: string; description: string }[]))
      .catch(() => {});
  };

  const load = async () => {
    setMessage("");
    try {
      const params = new URLSearchParams();
      params.set("include_all", "true");
      params.set("status_filter", statusFilter);
      if (tab) params.set("category", tab);
      const url = `/api/v1/agents?${params.toString()}`;
      const wsData = await adminFetch(url).then((res) =>
        readJson<{ agents?: Agent[]; viewer?: Viewer }>(res),
      );
      const list = (wsData.agents || []);
      // Filter by search on client side (name or agent_id)
      const filtered = search.trim()
        ? list.filter(w =>
            w.name.toLowerCase().includes(search.toLowerCase()) ||
            w.agent_id.toLowerCase().includes(search.toLowerCase()))
        : list;
      setAgents(filtered);
      if (wsData.viewer) setViewer(wsData.viewer);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [tab, search, statusFilter]);

  // Load templates
  useEffect(() => {
    adminFetch("/api/v1/agent-templates").then(r => r.json()).then(d => setTemplates((d.templates || []) as typeof templates)).catch(() => {});
  }, []);

  const createAgent = async () => {
    setBusy(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = { name: agentName, model_policy: createPolicy, category: tab };
      if (createTemplateId) body.template_id = createTemplateId;
      if (createRoleIds.length) body.role_ids = createRoleIds;
      const data = await adminFetch("/api/v1/agents", {
        method: "POST",
        body: JSON.stringify(body),
      }).then((res) => readJson<{ agent: Agent }>(res));
      setMessage(`✅ 已创建「${data.agent.name}」`); setAgentName(""); setCreateTemplateId(""); setCreating(false);
      void load();
      setBusy(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  };

  const openEdit = (agent: Agent) => {
    setEditing(agent);
    setEditName(agent.name);
    setEditQuota(String(agent.storage_quota_mb ?? 0));
    setEditPolicy((agent.model_policy as "all" | "routes_only") || "all");
    setEditMembers([]);
    setMessage("");
    adminFetch(`/api/v1/agents/${encodeURIComponent(agent.agent_id)}/accounts`)
      .then(r => r.json())
      .then(d => setEditMembers((d as { accounts?: Array<{ account_id: string; role: string; bound_at: string }> }).accounts ?? []))
      .catch(() => {});
  };

  const patchAgent = async (payload: Record<string, unknown>) => {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    try {
      if (Object.keys(payload).length) {
        await adminFetch(`/api/v1/agents/${encodeURIComponent(editing.agent_id)}`, {
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

  const saveAgent = () => {
    if (!editing) return;
    const payload: Record<string, unknown> = {};
    if (editName.trim() && editName.trim() !== editing.name) payload.name = editName.trim();
    if (isAdminLocal) {
      const quota = Number(editQuota);
      if (Number.isFinite(quota) && quota >= 0 && quota !== (editing.storage_quota_mb ?? 0)) {
        payload.storage_quota_mb = quota;
      }
    }
    const currentPolicy = (editing.model_policy as string) || "all";
    if (editPolicy !== currentPolicy) {
      payload.model_policy = editPolicy;
    }
    void patchAgent(payload);
  };

  const toggleArchive = () => {
    if (!editing) return;
    void patchAgent({ status: editing.status === "archived" ? "active" : "archived" });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {(["cloud", "local"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setPageMode(mode)}
            className={`rounded-lg px-4 py-2.5 text-left transition sm:min-w-[9rem] ${
              pageMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="block text-sm font-semibold">{mode === "cloud" ? copy.modeCloud : copy.modeLocal}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {mode === "cloud" ? copy.modeCloudDesc : copy.modeLocalDesc}
            </span>
          </button>
        ))}
      </div>

      {pageMode === "local" ? (
        <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white p-5 shadow-sm md:p-6">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">{copy.gateway}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{copy.gatewayTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">{copy.gatewayHint}</p>
          </div>
          <EmployeeGatewayPanel />
        </section>
      ) : (
      <section>
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">{copy.eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{copy.modeCloud}</h2>
          <p className="mt-1 text-sm text-slate-600">{copy.modeCloudDesc}</p>
        </div>
      {/* Tab + Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["dedicated", "department", "employee"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {{ employee: "员工", department: "部门", dedicated: "专属" }[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "active" | "archived" | "deleted")}
          >
            <option value="active">活动</option>
            <option value="archived">归档</option>
            <option value="deleted">已删除</option>
          </select>
          <input
            className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="搜索名称或 ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            ＋ 新建智能体
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>
      )}

      {/* Agent grid */}
      {loading && !agents.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-200" />
              <div className="mt-4 h-4 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : agents.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const archived = agent.status === "archived";
            const deleted = agent.status === "deleted";
            const policy = (agent.model_policy as string) || "all";
            return (
              <a
                key={agent.agent_id}
                href={deleted ? undefined : `/agent/agents/${encodeURIComponent(agent.agent_id)}`}
                onClick={(event) => {
                  if (deleted) { event.preventDefault(); return; }
                  if (event.metaKey || event.ctrlKey || event.button === 1) return;
                  event.preventDefault();
                  navigate(`/agent/agents/${encodeURIComponent(agent.agent_id)}`);
                }}
                className={`group flex flex-col rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md ${
                  archived ? "border-slate-200 opacity-60" : deleted ? "border-red-200 opacity-75" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-base font-bold text-white">
                    {agent.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      policy === "routes_only"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}>
                      {policy === "routes_only" ? "路由模式" : "全部模型"}
                    </span>
                    <button
                      type="button"
                      title="已绑定技能"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSkillsWsId(agent.agent_id);
                        setSkillsWsName(agent.name);
                      }}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
                    >🧩 技能</button>
                    <button
                      type="button"
                      title="设置"
                      onClick={(event) => { event.preventDefault(); event.stopPropagation(); openEdit(agent); }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                    >⚙</button>
                  </div>
                </div>
                <div className="mt-4 truncate text-base font-semibold text-slate-900">{agent.name}</div>
                {agent.template_name && <div className="mt-1 text-[11px] text-indigo-600">📋 {agent.template_name}</div>}
                <div className="mt-1 truncate font-mono text-xs text-slate-400">{agent.agent_id}</div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${deleted ? "bg-red-500" : archived ? "bg-slate-400" : "bg-emerald-500"}`} />
                  <span className={deleted ? "text-red-600" : archived ? "text-slate-400" : "text-slate-500"}>
                    {deleted ? "已删除" : archived ? "归档" : "活动"}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[11px] text-slate-400">
                    {formatDateTimeShort(agent.updated_at)}
                  </span>
                  {deleted ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-400">
                      已删除
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition group-hover:bg-indigo-700">
                      打开工作台 →
                    </span>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl">📁</div>
          <p className="mx-auto max-w-md text-sm text-slate-500">该分类下暂无智能体</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            ＋ 新建智能体
          </button>
        </div>
      )}

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
            <div className="text-lg font-semibold text-slate-900">新建智能体</div>
            <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
            <label className="mt-5 block text-sm font-medium text-slate-700">{copy.agentName}</label>
            <input
              autoFocus
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createAgent();
              }}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {isAdminLocal && tab !== "employee" && (
              <>
                <label className="mt-4 block text-sm font-medium text-slate-700">身份模板</label>
                <select
                  value={createTemplateId}
                  onChange={(e) => setCreateTemplateId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                >
                  <option value="">不使用模板（自定义）</option>
                  {templates.filter(tpl =>
                    tab === "department" ? tpl.category === "department" : tpl.category === "personal"
                  ).map(tpl => (
                    <option key={tpl.template_id} value={tpl.template_id}>
                      {tpl.name} {tpl.category === "personal" ? "(系统预设)" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">选择模板后自动初始化智能体身份信息，创建后不可更改</p>
              </>)}
            {isAdminLocal && roles.length > 0 && (
              <>
                <label className="mt-4 block text-sm font-medium text-slate-700">绑定角色</label>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {roles.map(role => (
                    <label
                      key={role.role_id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                        createRoleIds.includes(role.role_id)
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={createRoleIds.includes(role.role_id)}
                        onChange={() => {
                          setCreateRoleIds(prev =>
                            prev.includes(role.role_id)
                              ? prev.filter(id => id !== role.role_id)
                              : [...prev, role.role_id]
                          );
                        }}
                        className="accent-indigo-600"
                      />
                      <span className="flex-1">{role.name}</span>
                      {role.description && (
                        <span className="text-xs text-slate-400">{role.description}</span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-400">选择后立即为智能体分配对应角色权限</p>
              </>)}
            {isAdminLocal && (
              <>
                <label className="mt-4 block text-sm font-medium text-slate-700">模型策略</label>
                <div className="mt-2 flex gap-3">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="createPolicy"
                      value="routes_only"
                      checked={createPolicy === "routes_only"}
                      onChange={() => setCreatePolicy("routes_only")}
                      className="accent-indigo-600"
                    />
                    <span>仅路由别名</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="createPolicy"
                      value="all"
                      checked={createPolicy === "all"}
                      onChange={() => setCreatePolicy("all")}
                      className="accent-indigo-600"
                    />
                    <span>全部模型</span>
                  </label>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  「仅路由别名」模式下用户只能选择网关路由别名；「全部模型」允许直接选择上游模型
                </p>
              </>
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
                onClick={() => void createAgent()}
                disabled={busy || !agentName.trim()}
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
              <div className="text-lg font-semibold text-slate-900">{copy.editAgent}</div>
              <span className="font-mono text-[11px] text-slate-400">{editing.agent_id}</span>
            </div>

            <label className="mt-5 block text-sm font-medium text-slate-700">{copy.agentName}</label>
            <input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />

            {_tpl && (
              <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
                <span className="text-xs text-slate-500">身份模板：</span>
                <button
                  type="button"
                  onClick={() => setViewingTemplate(_tpl)}
                  className="ml-1 text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer"
                >
                  📋 {_tpl.name}
                </button>
                {_tpl.description && (
                  <p className="mt-0.5 text-xs text-slate-400 truncate">{_tpl.description}</p>
                )}
              </div>
            )}

            <div className="mt-4">
              <label className="text-sm font-medium text-slate-700">
                已绑定员工 ({editMembers.length})
              </label>
              {editMembers.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">暂无绑定，在账号管理中关联</p>
              ) : (
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {editMembers.map((m) => (
                    <div key={m.account_id} className="flex items-center rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="text-slate-700">{m.account_name || m.account_id}</span>
                      {m.login_name && <span className="ml-2 text-slate-400">{m.login_name}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-700">{copy.quota}</label>
            <input
              type="number"
              min={0}
              value={editQuota}
              disabled={!isAdminLocal}
              onChange={(event) => setEditQuota(event.target.value)}
              className={`mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${
                isAdminLocal ? "" : "cursor-not-allowed bg-slate-50 text-slate-500"
              }`}
            />
            <p className="mt-1 text-xs text-slate-400">{copy.quotaHint}</p>

            {isAdminLocal && (
              <>
                <label className="mt-4 block text-sm font-medium text-slate-700">模型策略</label>
                <div className="mt-2 flex gap-3">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="editPolicy"
                      value="routes_only"
                      checked={editPolicy === "routes_only"}
                      onChange={() => setEditPolicy("routes_only")}
                      className="accent-indigo-600"
                    />
                    <span>仅路由别名</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="editPolicy"
                      value="all"
                      checked={editPolicy === "all"}
                      onChange={() => setEditPolicy("all")}
                      className="accent-indigo-600"
                    />
                    <span>全部模型</span>
                  </label>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  切换模式后，用户在智能体工作台中的模型选择器将只显示对应范围内的模型
                </p>
              </>
            )}

            <div className="mt-6 flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {editing.status !== "deleted" && (
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
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (editing.status === "deleted") {
                      void patchAgent({ status: "active" });
                    } else {
                      if (confirm(`确定删除智能体「${editing.name}」？删除后可在"已删除"筛选中找回。`)) {
                        void patchAgent({ status: "deleted" });
                      }
                    }
                  }}
                  disabled={busy}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    editing.status === "deleted"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                  }`}
                >
                  {editing.status === "deleted" ? "恢复" : "删除"}
                </button>
              </div>
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
                  onClick={saveAgent}
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

      </section>
      )}

      {/* Template detail modal */}
      {viewingTemplate && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 pt-12 backdrop-blur-sm" onClick={() => setViewingTemplate(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-base font-semibold text-slate-900">{viewingTemplate.name}</div>
                <div className="text-xs text-slate-400">{viewingTemplate.category === "personal" ? "系统预设" : "部门模板"}</div>
              </div>
              <button onClick={() => setViewingTemplate(null)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">关闭</button>
            </div>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5 text-sm">
              {viewingTemplate.description && <p className="text-slate-500">{viewingTemplate.description}</p>}
              {viewingTemplate.soul && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Soul</div><p className="whitespace-pre-wrap text-slate-700">{viewingTemplate.soul}</p></div>}
              {viewingTemplate.paradigm && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Paradigm</div><p className="whitespace-pre-wrap text-slate-700">{viewingTemplate.paradigm}</p></div>}
              {viewingTemplate.standards && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Standards</div><p className="whitespace-pre-wrap text-slate-700">{viewingTemplate.standards}</p></div>}
              {viewingTemplate.default_model && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">默认模型</div><p className="text-slate-700">{viewingTemplate.default_model}</p></div>}
              {viewingTemplate.default_skills && viewingTemplate.default_skills.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">默认技能</div><div className="flex flex-wrap gap-1.5">{viewingTemplate.default_skills.map((s: string) => <span key={s} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{s}</span>)}</div></div>}
            </div>
            <div className="flex border-t border-slate-100 px-6 py-4">
              <button onClick={() => setViewingTemplate(null)} className="w-full rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Skills drawer */}
      {skillsWsId && (
        <GatewayDrawer
          open={true}
          title={`已绑定技能 · ${skillsWsName}`}
          onClose={() => { setSkillsWsId(null); setSkillsWsName(""); }}>
          <SkillsAssignmentPanel
            agentId={skillsWsId}
            agentName={skillsWsName}
          />
        </GatewayDrawer>
      )}
    </div>
  );
}
