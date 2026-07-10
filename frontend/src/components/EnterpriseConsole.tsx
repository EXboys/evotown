import { useEffect, useMemo, useState, type ReactNode } from "react";

type DashboardActivityTab = "gateway" | "runs";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { GatewayAccountsPanel } from "./GatewayAccountsPanel";
import { GATEWAY_COPY, GatewayConsole, RecentRequestsTable } from "./GatewayConsole";
import { SkillsConsole } from "./SkillsConsole";
import { PoliciesPanel } from "./PoliciesPanel";
import { AssetsPanel } from "./AssetsPanel";
import { CodingAgentPage } from "./CodingAgentPage";
import { KnowledgePanel } from "./KnowledgePanel";
import { DatabasePanel } from "./DatabasePanel";
import { McpPanel } from "./McpPanel";
import { RolePanel } from "./RolePanel";
import { AgentTemplatePanel } from "./AgentTemplatePanel";
import { DispatchPanel } from "./DispatchPanel";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { DimensionPanel } from "./DimensionPanel";
import SystemConfigPage from "./SystemConfigPage";
import { TaskPoolPanel } from "./TaskPoolPanel";
import { DisplayTimezoneSelect } from "./DisplayTimezoneSelect";
import { LanguageToggle } from "./LanguageToggle";
import { adminFetch, clearConsoleSession, isConsoleAuthenticated, isStaffEmployee } from "../hooks/useAdminToken";
import { STAFF_EMPLOYEE_HOME } from "../lib/staffRoutes";
import { useSystemConfig } from "../hooks/useSystemConfig";
import { formatDateTimeShort } from "../lib/datetime";
import { useLocale, type Locale } from "../lib/i18n";

type ConsoleTab = "dashboard" | "gateway" | "accounts" | "engines" | "dispatch" | "coding" | "runs" | "skills" | "assets" | "policies" | "knowledge" | "databases" | "mcp" | "roles" | "templates" | "dimensions" | "settings" | "costs" | "risk" | "audit" | "taskpool";

type EngineRecord = {
  engine_id: string;
  engine_type: "openclaw" | "hermes" | "skilllite" | "custom" | "hosted_coding";
  engine_version: string;
  display_name?: string;
  owner_team?: string;
  deployment_kind?: "laptop" | "server" | "ci" | "container";
  capabilities?: Record<string, unknown>;
  registered_at?: string;
  updated_at?: string;
  online?: boolean;
  last_seen_at?: string;
  connector_version?: string;
};

type ExternalRun = {
  run_id: string;
  engine_id: string;
  engine_type?: "openclaw" | "hermes" | "skilllite" | "custom" | "hosted_coding";
  engine_version: string;
  tenant_id?: string;
  team_id?: string;
  agent_id?: string;
  task_id?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  exit_code: number;
  started_at?: string;
  finished_at: string;
  log_excerpt?: string;
  artifact_manifest?: Array<{ path: string; sha256: string; bytes: number }>;
  artifact_bundle_url?: string;
  signals?: Record<string, unknown>;
  accepted_at?: string;
};

type RunEvent = {
  id: number;
  run_id: string;
  engine_id: string;
  event_type: string;
  ts: string;
  seq: number;
  payload?: Record<string, unknown>;
};

type PolicyViolation = {
  violation_id: number;
  run_id: string;
  engine_id: string;
  policy_id: string;
  severity: "low" | "medium" | "high" | "critical";
  action: "allowed" | "warned" | "blocked" | "needs_review";
  resource_type: string;
  resource?: string;
  message?: string;
  ts: string;
  status: string;
  context?: Record<string, unknown>;
};

type CostSummary = {
  total_runs: number;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  by_engine: Array<{
    engine_id: string;
    runs: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  by_team?: Array<{
    team_id: string;
    runs: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  }>;
};

type GatewaySummary = {
  total?: {
    total_requests?: number;
    total_cost_usd?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    avg_latency_ms?: number;
  };
  by_model?: Array<{ model: string; requests: number; cost_usd: number; total_tokens: number }>;
  by_agent?: Array<{ agent_id: string; requests: number; cost_usd: number; total_tokens: number }>;
  by_account?: Array<{ account_id: string; requests: number; cost_usd: number; total_tokens: number }>;
};

type GatewayConversation = {
  conversation_id: string;
  last_seen_at: string;
  requests: number;
  cost_usd: number;
  total_tokens: number;
  agent_id?: string;
  account_id?: string;
  account_name?: string;
  user_message?: string;
  team_id?: string;
  engine_id?: string;
  model?: string;
  model_alias?: string;
};

type GatewayKeyInfo = {
  key_label: string;
  scope: string;
};

type GatewayRequest = {
  request_id: string;
  conversation_id?: string;
  agent_id?: string;
  model?: string;
  model_alias?: string;
  status_code?: number;
  cost_usd?: number;
  total_tokens?: number;
  latency_ms?: number;
  risk_status?: string;
  created_at?: string;
  error?: string;
};

type ConsoleData = {
  engines: EngineRecord[];
  runs: ExternalRun[];
  violations: PolicyViolation[];
  cost: CostSummary | null;
  gateway: GatewaySummary | null;
  conversations: GatewayConversation[];
  gatewayKeys: GatewayKeyInfo[];
  gatewayRequests: GatewayRequest[];
};

const TAB_ROUTE: Record<ConsoleTab, string> = {
  dashboard: "/dashboard",
  gateway: "/gateway",
  accounts: "/accounts",
  engines: "/engines",
  dispatch: "/dispatch",
  coding: "/agent",
  runs: "/runs",
  assets: "/assets",
  skills: "/skills",
  policies: "/policies",
  knowledge: "/console/knowledge",
  databases: "/console/databases",
  mcp: "/console/mcp",
  roles: "/console/roles",
  templates: "/console/templates",
  dimensions: "/console/dimensions",
  settings: "/console/settings",
  costs: "/costs",
  risk: "/risk",
  audit: "/console/audit",
  taskpool: "/console/taskpool",
};

const NAV_ITEMS: ConsoleTab[] = [
  "dashboard",
  "gateway",
  "accounts",
  "engines",
  "dispatch",
  "coding",
  "runs",
  "assets",
  "skills",
  "policies",
  "knowledge",
  "databases",
  "mcp",
  "roles",
  "costs",
  "risk",
  "audit",
  "taskpool",
];

type MenuGroup = {
  id: string;
  labelZh: string;
  labelEn: string;
  items: ConsoleTab[];
  link?: string;  // 直接点击跳转的一级菜单
};

const MENU_GROUPS: MenuGroup[] = [
  { id: "home", labelZh: "首页", labelEn: "Home", items: ["dashboard"], link: "/dashboard" },
  { id: "agent", labelZh: "智能体中心", labelEn: "Agent Center", items: ["coding", "runs", "engines", "roles", "templates", "taskpool"] },
  { id: "capability", labelZh: "能力中心", labelEn: "Capabilities", items: ["skills", "knowledge", "mcp", "databases", "dispatch"] },
  { id: "model", labelZh: "模型管理", labelEn: "Models", items: ["gateway", "policies", "costs", "risk", "assets"] },
  { id: "admin", labelZh: "系统管理", labelEn: "System", items: ["accounts", "audit", "dimensions", "settings"] },
];

// Flat set of tabs that belong to expandable groups (non-link groups)
const GROUPED_TABS = new Set(MENU_GROUPS.filter(g => !g.link).flatMap(g => g.items));

const CONSOLE_COPY = {
  zh: {
    nav: {
      dashboard: { label: "总览", desc: "Overview" },
      gateway: { label: "网关", desc: "Gateway" },
      accounts: { label: "账号", desc: "Accounts" },
      engines: { label: "引擎", desc: "Engines" },
      dispatch: { label: "派活", desc: "Dispatch" },
      coding: { label: "Agent", desc: "Claude" },
      runs: { label: "运行", desc: "Runs" },
      assets: { label: "资产", desc: "Assets" },
      skills: { label: "技能", desc: "Skills" },
      policies: { label: "策略", desc: "Policies" },
      knowledge: { label: "知识库", desc: "Knowledge" },
      databases: { label: "数据库", desc: "Databases" },
      mcp: { label: "MCP", desc: "MCP Services" },
      roles: { label: "角色", desc: "Agent Roles" },
      templates: { label: "模板", desc: "Templates" },
      dimensions: { label: "权限维度", desc: "Dimensions" },
      settings: { label: "系统配置", desc: "Settings" },
      costs: { label: "成本", desc: "Costs" },
      risk: { label: "风控", desc: "Risk" },
      audit: { label: "追溯", desc: "Audit" },
      taskpool: { label: "任务池", desc: "Task Pool" },
    },
    shell: {
      eyebrow: "Management Console",
      title: "企业管理后台",
      subtitle: "外部引擎接入、运行记录、成本和风控事件统一观测。",
      signedIn: "已登录",
      home: "首页",
      arena: "协作地图",
      logout: "退出登录",
      refreshing: "刷新中...",
      refresh: "刷新数据",
      backHome: "返回首页",
      loadFailed: "加载失败",
    },
    dashboard: {
      stats: {
        engines: "已接入引擎",
        gatewayRequests: "网关请求",
        gatewayNote: "chat/completions 调用",
        externalRuns: "外部运行",
        successRate: "成功率",
        totalCost: "累计成本",
        gatewayCost: "网关",
        engineCost: "引擎",
        pendingRisk: "待处理风险",
      },
      enginesTitle: "引擎概览",
      enginesSubtitle: "当前已注册的外部运行时",
      recentTitle: "最近动态",
      gatewaySubtitle: "企业网关 chat/completions",
      runsSubtitle: "外部引擎运行与 tool_call 事件",
      viewAll: "查看全部",
      requestCalls: "请求调用",
      externalRuns: "外部运行",
      riskTitle: "风控事件",
      riskSubtitle: "最新策略命中和阻断动作",
      handle: "处理",
      noEngines: "暂无引擎接入。",
    },
  },
  en: {
    nav: {
      dashboard: { label: "Overview", desc: "Dashboard" },
      gateway: { label: "Gateway", desc: "Models" },
      accounts: { label: "Accounts", desc: "Keys" },
      engines: { label: "Engines", desc: "Runtimes" },
      dispatch: { label: "Dispatch", desc: "Tasks" },
      coding: { label: "Agent", desc: "Claude" },
      runs: { label: "Runs", desc: "History" },
      assets: { label: "Assets", desc: "Promote" },
      skills: { label: "Skills", desc: "Review" },
      policies: { label: "Policies", desc: "Rules" },
      knowledge: { label: "Knowledge", desc: "Sources" },
      databases: { label: "Databases", desc: "MCP access" },
      mcp: { label: "MCP", desc: "Services" },
      roles: { label: "Roles", desc: "Agent Roles" },
      templates: { label: "Templates", desc: "Agent Templates" },
      dimensions: { label: "Dimensions", desc: "Permission" },
      settings: { label: "Settings", desc: "System Config" },
      costs: { label: "Costs", desc: "Usage" },
      risk: { label: "Risk", desc: "Events" },
      audit: { label: "Audit", desc: "Activity" },
      taskpool: { label: "Task Pool", desc: "Tasks" },
    },
    shell: {
      eyebrow: "Management Console",
      title: "Enterprise Admin Console",
      subtitle: "Unified observability for engine ingest, run history, cost, and risk events.",
      signedIn: "Signed in",
      home: "Home",
      arena: "Collaboration Map",
      logout: "Log out",
      refreshing: "Refreshing...",
      refresh: "Refresh data",
      backHome: "Back home",
      loadFailed: "Load failed",
    },
    dashboard: {
      stats: {
        engines: "Connected Engines",
        gatewayRequests: "Gateway Requests",
        gatewayNote: "chat/completions calls",
        externalRuns: "External Runs",
        successRate: "Success rate",
        totalCost: "Total Cost",
        gatewayCost: "Gateway",
        engineCost: "Engine",
        pendingRisk: "Open Risks",
      },
      enginesTitle: "Engine Overview",
      enginesSubtitle: "Currently registered external runtimes",
      recentTitle: "Recent Activity",
      gatewaySubtitle: "Enterprise gateway chat/completions",
      runsSubtitle: "External engine runs and tool_call events",
      viewAll: "View all",
      requestCalls: "Requests",
      externalRuns: "External Runs",
      riskTitle: "Risk Events",
      riskSubtitle: "Latest policy hits and blocking actions",
      handle: "Review",
      noEngines: "No engines connected yet.",
    },
  },
} as const;

type DashboardCopy = (typeof CONSOLE_COPY)[keyof typeof CONSOLE_COPY]["dashboard"];

const ENGINE_META: Record<EngineRecord["engine_type"], { label: string; className: string }> = {
  openclaw: { label: "OpenClaw", className: "border-sky-200 bg-sky-50 text-sky-700" },
  hermes: { label: "Hermes", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  skilllite: { label: "SkillLite", className: "border-amber-200 bg-amber-50 text-amber-700" },
  hosted_coding: { label: "Coding Agent", className: "border-violet-200 bg-violet-50 text-violet-700" },
  custom: { label: "Custom", className: "border-slate-200 bg-slate-50 text-slate-700" },
};

const RUN_META: Record<ExternalRun["status"], { label: string; className: string; dot: string }> = {
  running: { label: "运行中", className: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  succeeded: { label: "成功", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  cancelled: { label: "已取消", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
};

const RISK_META: Record<PolicyViolation["severity"], { label: string; className: string }> = {
  low: { label: "低", className: "border-slate-200 bg-slate-50 text-slate-600" },
  medium: { label: "中", className: "border-amber-200 bg-amber-50 text-amber-700" },
  high: { label: "高", className: "border-orange-200 bg-orange-50 text-orange-700" },
  critical: { label: "严重", className: "border-red-200 bg-red-50 text-red-700" },
};

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function enabledCapabilities(capabilities?: Record<string, unknown>) {
  if (!capabilities) return [];
  return Object.entries(capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .slice(0, 6);
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{note}</div>
    </Card>
  );
}

export function EnterpriseConsole({
  initialTab = "dashboard",
  initialAgentId = "",
}: {
  initialTab?: ConsoleTab;
  initialAgentId?: string;
}) {
  const navigate = useNavigate();
  const { locale, setLocale } = useLocale();
  const sysConfig = useSystemConfig();
  const copy = CONSOLE_COPY[locale];
  const brand = sysConfig.brand_name || "Evotown";
  const siteTitle = sysConfig.site_name || copy.shell.title;
  const [tab, setTab] = useState<ConsoleTab>(initialTab);
  const [data, setData] = useState<ConsoleData>({
    engines: [],
    runs: [],
    violations: [],
    cost: null,
    gateway: null,
    conversations: [],
    gatewayKeys: [],
    gatewayRequests: [],
  });
  const [selectedRun, setSelectedRun] = useState<ExternalRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Auto-expand the group containing the active tab
  useEffect(() => {
    const activeGroup = MENU_GROUPS.find(g => !g.link && g.items.includes(tab));
    if (activeGroup) {
      setExpandedGroups(prev => {
        if (prev.has(activeGroup.id)) return prev;
        const next = new Set(prev);
        next.add(activeGroup.id);
        return next;
      });
    }
  }, [tab]);

  const staffEmployee = isStaffEmployee();

  useEffect(() => {
    if (!isConsoleAuthenticated()) {
      navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`, { replace: true });
      return;
    }
    if (staffEmployee && initialTab !== "coding") {
      navigate(STAFF_EMPLOYEE_HOME, { replace: true });
      return;
    }
    adminFetch("/api/v1/auth/me")
      .then((r) => r.ok ? r.json() as Promise<{ session?: { account_name?: string } }> : null)
      .then((data) => setSessionName(data?.session?.account_name || ""))
      .catch(() => setSessionName(""));
  }, [navigate, staffEmployee, initialTab]);

  const load = () => {
    setLoading(true);
    setError("");
    const fetchJson = async <T,>(url: string, label: string): Promise<{ data: T | null; error?: string }> => {
      try {
        const res = await adminFetch(url);
        if (!res.ok) return { data: null, error: `${label} ${res.status}` };
        return { data: (await res.json()) as T };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "network error";
        return { data: null, error: `${label}: ${msg}` };
      }
    };

    Promise.all([
      fetchJson<{ engines?: EngineRecord[] }>("/api/v1/engines/fleet", "engines"),
      fetchJson<{ runs?: ExternalRun[] }>("/api/v1/runs?limit=200", "runs"),
      fetchJson<{ violations?: PolicyViolation[] }>("/api/v1/policy/violations?limit=200", "violations"),
      fetchJson<CostSummary>("/api/v1/costs/summary", "costs"),
      fetchJson<GatewaySummary>("/api/gateway/v1/usage/summary", "gateway"),
      fetchJson<{ conversations?: GatewayConversation[] }>("/api/gateway/v1/conversations?limit=100", "conversations"),
      fetchJson<{ requests?: GatewayRequest[] }>("/api/gateway/v1/requests?limit=100", "requests"),
      fetchJson<{ keys?: GatewayKeyInfo[] }>("/api/gateway/v1/api-keys", "gateway keys"),
    ])
      .then(([engines, runs, violations, cost, gateway, conversations, requests, keys]) => {
        const failures = [engines, runs, violations, cost, gateway, conversations, requests, keys]
          .map((item) => item.error)
          .filter(Boolean) as string[];
        if (failures.length) {
          const msg = failures.join("；");
          setError(msg.includes("403") || msg.includes("401") ? `${msg} — 请使用带 console.write 的 API Key 重新登录` : msg);
        } else {
          setError("");
        }

        const nextRuns = Array.isArray(runs.data?.runs) ? runs.data.runs : [];
        setData({
          engines: Array.isArray(engines.data?.engines) ? engines.data.engines : [],
          runs: nextRuns,
          violations: Array.isArray(violations.data?.violations) ? violations.data.violations : [],
          cost: cost.data,
          gateway: gateway.data,
          conversations: Array.isArray(conversations.data?.conversations) ? conversations.data.conversations : [],
          gatewayKeys: Array.isArray(keys.data?.keys) ? keys.data.keys : [],
          gatewayRequests: Array.isArray(requests.data?.requests) ? requests.data.requests : [],
        });
        setSelectedRun((current) => current ?? nextRuns[0] ?? null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    if (staffEmployee) return;
    load();
  }, [staffEmployee]);

  const summary = useMemo(() => {
    const total = data.runs.length;
    const ok = data.runs.filter((run) => run.status === "succeeded").length;
    const failed = data.runs.filter((run) => run.status === "failed").length;
    const risk = data.violations.filter((item) => item.status === "open").length;
    return {
      total,
      ok,
      failed,
      risk,
      critical: data.violations.filter((item) => item.severity === "critical").length,
      successRate: total ? Math.round((ok / total) * 100) : 0,
    };
  }, [data.runs, data.violations]);

  const setRoute = (next: ConsoleTab) => {
    setTab(next);
    navigate(TAB_ROUTE[next]);
  };

  const openRun = (run: ExternalRun) => {
    setSelectedRun(run);
    setTab("runs");
    navigate("/runs");
    setEventsLoading(true);
    Promise.all([
      adminFetch(`/api/v1/runs/${encodeURIComponent(run.run_id)}/events`).then((r) => r.json() as Promise<{ events?: RunEvent[] }>),
      adminFetch(`/api/v1/policy/violations?run_id=${encodeURIComponent(run.run_id)}`).then((r) => r.json() as Promise<{ violations?: PolicyViolation[] }>),
    ])
      .then(([eventData, violationData]) => {
        const riskEvents = (violationData.violations || []).map((item, index) => ({
          id: -item.violation_id,
          run_id: item.run_id,
          engine_id: item.engine_id,
          event_type: "policy_violation",
          ts: item.ts,
          seq: 10_000 + index,
          payload: {
            policy_id: item.policy_id,
            severity: item.severity,
            action: item.action,
            resource_type: item.resource_type,
            resource: item.resource,
            message: item.message,
          },
        }));
        setEvents([...(eventData.events || []), ...riskEvents].sort((a, b) => a.seq - b.seq));
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  };

  return (
    <div
      className="min-h-screen bg-slate-100 text-slate-900"
      style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 bg-slate-950 text-white md:flex md:h-screen md:sticky md:top-0 md:flex-col">
          <div className="shrink-0 border-b border-white/10 px-5 py-5">
            <button onClick={() => navigate("/")} className="flex items-center gap-3 text-left">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500 text-sm font-semibold text-white">E</span>
              <span>
                <span className="block text-sm font-semibold">{brand} Console</span>
                <span className="mt-0.5 block text-xs text-slate-400">Enterprise control plane</span>
              </span>
            </button>
          </div>
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
            {(staffEmployee
              ? MENU_GROUPS.filter((group) => group.id === "agent").map((group) => ({
                  ...group,
                  items: group.items.filter((item) => item === "coding"),
                }))
              : MENU_GROUPS
            ).map((group) => {
              const groupLabel = locale === "zh" ? group.labelZh : group.labelEn;
              const isExpanded = expandedGroups.has(group.id);
              const activeInGroup = group.items.some(item => tab === item);

              // Link group: single clickable item (首页)
              if (group.link) {
                return (
                  <button
                    key={group.id}
                    onClick={() => navigate(group.link!)}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                      tab === group.items[0]
                        ? "bg-white/12 text-white shadow-sm ring-1 ring-white/10"
                        : "text-slate-300 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-xs">🏠</span>
                    {groupLabel}
                  </button>
                );
              }

              // Expandable group
              const icons: Record<string, string> = { agent: "🤖", capability: "🧩", model: "🧠", admin: "⚙️" };
              return (
                <div key={group.id} className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      });
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                      activeInGroup && !isExpanded
                        ? "text-white/80 hover:text-white hover:bg-white/8"
                        : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-xs">
                      {icons[group.id] || "📂"}
                    </span>
                    <span className="flex-1 text-left">{groupLabel}</span>
                    <svg
                      className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <div
                    className={`ml-2 mt-0.5 space-y-0.5 overflow-hidden border-l border-white/10 pl-4 transition-all duration-200 ${
                      isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    {group.items.map((item) => (
                      <button
                        key={item}
                        onClick={() => setRoute(item)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-all ${
                          tab === item
                            ? "bg-white/12 text-white shadow-sm ring-1 ring-white/10"
                            : "text-slate-300 hover:bg-white/6 hover:text-white"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${tab === item ? "bg-sky-400" : "bg-slate-600"}`} />
                        {copy.nav[item].label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="shrink-0 space-y-2 border-t border-white/10 p-4">
            <DisplayTimezoneSelect layout="card" tone="dark" />
            {staffEmployee && (
              <button
                onClick={() => navigate("/market")}
                className="w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20"
              >
                {locale === "zh" ? "Skills 市场" : "Skills Market"}
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              {copy.shell.backHome}
            </button>
            <button
              onClick={() => navigate("/arena")}
              className="w-full rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
            >
              {copy.shell.arena}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start lg:px-8">
              <div className="min-w-0 pr-0 md:pr-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">{copy.shell.eyebrow}</div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{siteTitle}</h1>
                <p className="mt-1 text-sm text-slate-500">{copy.shell.subtitle}</p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                <div className="flex items-center justify-start gap-2 md:justify-end">
                  {sessionName && (
                    <span className="max-w-[180px] truncate rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {copy.shell.signedIn}: {sessionName}
                    </span>
                  )}
                  <LanguageToggle locale={locale} onChange={setLocale} />
                </div>
                <div className="flex flex-nowrap items-center justify-start gap-1.5 md:justify-end">
                  <button
                    onClick={() => navigate("/")}
                    className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {copy.shell.home}
                  </button>
                  <button
                    onClick={() => navigate("/arena")}
                    className="whitespace-nowrap rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-100"
                  >
                    {copy.shell.arena}
                  </button>
                  <button
                    onClick={() => {
                      clearConsoleSession();
                      navigate("/login");
                    }}
                    className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {copy.shell.logout}
                  </button>
                  <button
                    onClick={load}
                    disabled={loading}
                    className="whitespace-nowrap rounded-md bg-slate-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {loading ? copy.shell.refreshing : copy.shell.refresh}
                  </button>
                </div>
              </div>
            </div>
            <nav className="flex gap-2 overflow-x-auto px-5 pb-4 md:hidden">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item}
                  onClick={() => setRoute(item)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                    tab === item ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
                  }`}
                >
                  {copy.nav[item].label}
                </button>
              ))}
            </nav>
          </header>

          <div className={tab === "dispatch" ? "flex min-h-0 flex-col px-5 py-4 lg:px-8" : "px-5 py-6 lg:px-8"}>
            {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{copy.shell.loadFailed}: {error}</div>}

            {tab === "dashboard" && <Dashboard data={data} summary={summary} copy={copy.dashboard} locale={locale} onTab={setRoute} onRun={openRun} />}
            {tab === "gateway" && <GatewayConsole data={data} locale={locale} />}
            {tab === "accounts" && <GatewayAccountsPanel locale={locale} />}
            {tab === "engines" && <Engines engines={data.engines} runs={data.runs} violations={data.violations} />}
            {tab === "dispatch" && <DispatchPanel engines={data.engines} onRefresh={load} />}
            {tab === "coding" && <CodingAgentPage locale={locale} initialAgentId={initialAgentId} />}
            {tab === "runs" && <Runs runs={data.runs} selectedRun={selectedRun} events={events} loading={eventsLoading} onRun={openRun} onAssetSubmitted={() => setRoute("assets")} />}
            {tab === "skills" && <SkillsConsole locale={locale} />}
            {tab === "assets" && <AssetsPanel />}
            {tab === "policies" && <PoliciesPanel locale={locale} />}
            {tab === "knowledge" && <KnowledgePanel locale={locale} />}
            {tab === "databases" && <DatabasePanel locale={locale} />}
            {tab === "mcp" && <McpPanel locale={locale} />}
            {tab === "roles" && <RolePanel locale={locale} />}
            {tab === "templates" && <AgentTemplatePanel locale={locale} />}
            {tab === "dimensions" && <DimensionPanel locale={locale} />}
            {tab === "settings" && <SystemConfigPage locale={locale} />}
            {tab === "costs" && <Costs cost={data.cost} />}
            {tab === "audit" && <AgentActivityPanel locale={locale} />}
            {tab === "taskpool" && <TaskPoolPanel />}
            {tab === "risk" && (
              <Risks
                violations={data.violations}
                onRun={(runId) => {
                  const run = data.runs.find((item) => item.run_id === runId);
                  if (run) openRun(run);
                }}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Dashboard({
  data,
  summary,
  copy,
  locale,
  onTab,
  onRun,
}: {
  data: ConsoleData;
  summary: { total: number; ok: number; failed: number; risk: number; critical: number; successRate: number };
  copy: DashboardCopy;
  locale: Locale;
  onTab: (tab: ConsoleTab) => void;
  onRun: (run: ExternalRun) => void;
}) {
  const gatewayTotal = data.gateway?.total?.total_requests ?? 0;
  const gatewayCost = data.gateway?.total?.total_cost_usd ?? 0;
  const engineCost = data.cost?.total_cost_usd ?? 0;
  const totalCost = gatewayCost + engineCost;

  const defaultActivityTab: DashboardActivityTab =
    gatewayTotal > 0 || data.gatewayRequests.length > 0
      ? "gateway"
      : summary.total > 0
        ? "runs"
        : "gateway";
  const [activityTab, setActivityTab] = useState<DashboardActivityTab | null>(null);
  const activeActivityTab = activityTab ?? defaultActivityTab;

  const activityDetailTab: ConsoleTab = activeActivityTab === "gateway" ? "gateway" : "runs";

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={copy.stats.engines} value={data.engines.length} note="OpenClaw / Hermes / Custom" />
        <StatCard label={copy.stats.gatewayRequests} value={gatewayTotal} note={copy.stats.gatewayNote} />
        <StatCard label={copy.stats.externalRuns} value={summary.total} note={`${copy.stats.successRate} ${summary.successRate}%`} />
        <StatCard
          label={copy.stats.totalCost}
          value={`$${totalCost.toFixed(4)}`}
          note={`${copy.stats.gatewayCost} $${gatewayCost.toFixed(4)} · ${copy.stats.engineCost} $${engineCost.toFixed(4)}`}
        />
        <StatCard label={copy.stats.pendingRisk} value={summary.risk} note={`${summary.critical} critical`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <Card className="p-5">
          <SectionHeader
            title={copy.enginesTitle}
            subtitle={copy.enginesSubtitle}
            action={<button onClick={() => onTab("engines")} className="text-sm font-medium text-blue-600 hover:text-blue-700">{copy.viewAll}</button>}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {data.engines.length ? data.engines.slice(0, 4).map((engine) => <EngineCard key={engine.engine_id} engine={engine} runs={data.runs} violations={data.violations} />) : <EmptyState>{copy.noEngines}</EmptyState>}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            title={copy.recentTitle}
            subtitle={activeActivityTab === "gateway" ? copy.gatewaySubtitle : copy.runsSubtitle}
            action={
              <button onClick={() => onTab(activityDetailTab)} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                {copy.viewAll}
              </button>
            }
          />
          <div className="mb-4 flex gap-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActivityTab("gateway")}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
                activeActivityTab === "gateway"
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {copy.requestCalls}
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">{gatewayTotal}</span>
            </button>
            <button
              type="button"
              onClick={() => setActivityTab("runs")}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
                activeActivityTab === "runs"
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {copy.externalRuns}
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">{summary.total}</span>
            </button>
          </div>
          {activeActivityTab === "gateway" ? (
            <RecentRequestsTable requests={data.gatewayRequests} compact copy={GATEWAY_COPY[locale]} />
          ) : (
            <RunTable runs={data.runs.slice(0, 8)} selectedRunId={null} onRun={onRun} compact />
          )}
        </Card>
      </section>

      <Card className="p-5">
        <SectionHeader
          title={copy.riskTitle}
          subtitle={copy.riskSubtitle}
          action={<button onClick={() => onTab("risk")} className="text-sm font-medium text-blue-600 hover:text-blue-700">{copy.handle}</button>}
        />
        <RiskFeed
          violations={data.violations.slice(0, 5)}
          onRun={(runId) => {
            const run = data.runs.find((item) => item.run_id === runId);
            if (run) onRun(run);
          }}
        />
      </Card>
    </div>
  );
}

function EngineCard({ engine, runs, violations }: { engine: EngineRecord; runs: ExternalRun[]; violations: PolicyViolation[] }) {
  const meta = ENGINE_META[engine.engine_type] ?? ENGINE_META.custom;
  const count = runs.filter((run) => run.engine_id === engine.engine_id).length;
  const risk = violations.filter((item) => item.engine_id === engine.engine_id).length;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold text-slate-950">{engine.display_name || engine.engine_id}</div>
          <div className="mt-1 truncate text-sm text-slate-500">{engine.owner_team || "No team"} · {engine.deployment_kind || "server"}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge className={meta.className}>{meta.label}</Badge>
          <Badge
            className={
              engine.online
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }
          >
            {engine.online ? "在线" : "离线"}
          </Badge>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="font-semibold text-slate-950">{count}</div>
          <div className="text-slate-500">Runs</div>
        </div>
        <div>
          <div className="font-semibold text-slate-950">{risk}</div>
          <div className="text-slate-500">Risks</div>
        </div>
        <div>
          <div className="truncate font-semibold text-slate-950">{engine.engine_version}</div>
          <div className="text-slate-500">Version</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {enabledCapabilities(engine.capabilities).map((cap) => <Badge key={cap} className="border-slate-200 bg-slate-50 text-slate-600">{cap}</Badge>)}
      </div>
    </div>
  );
}


function Engines({ engines, runs, violations }: { engines: EngineRecord[]; runs: ExternalRun[]; violations: PolicyViolation[] }) {
  if (!engines.length) return <EmptyState>暂无引擎注册。</EmptyState>;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{engines.map((engine) => <EngineCard key={engine.engine_id} engine={engine} runs={runs} violations={violations} />)}</div>;
}

function RunTable({
  runs,
  selectedRunId,
  onRun,
  compact = false,
}: {
  runs: ExternalRun[];
  selectedRunId?: string | null;
  onRun: (run: ExternalRun) => void;
  compact?: boolean;
}) {
  if (!runs.length) return <EmptyState>暂无外部运行记录。</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Run</th>
            <th className="w-32 px-4 py-3 font-semibold">Status</th>
            {!compact && <th className="w-36 px-4 py-3 font-semibold">Engine</th>}
            <th className="w-28 px-4 py-3 font-semibold">Cost</th>
            <th className="w-28 px-4 py-3 font-semibold">Latency</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {runs.map((run) => (
            <tr
              key={run.run_id}
              onClick={() => onRun(run)}
              className={`cursor-pointer transition ${selectedRunId === run.run_id ? "bg-blue-50" : "hover:bg-slate-50"}`}
            >
              <td className="px-4 py-3">
                <div className="truncate font-mono text-sm font-semibold text-slate-950">{run.run_id}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTimeShort(run.finished_at)}</div>
              </td>
              <td className="px-4 py-3">
                <Badge className={RUN_META[run.status].className}>
                  <span className={`h-1.5 w-1.5 rounded-full ${RUN_META[run.status].dot}`} />
                  {RUN_META[run.status].label}
                </Badge>
              </td>
              {!compact && <td className="truncate px-4 py-3 font-mono text-xs text-slate-600">{run.engine_id}</td>}
              <td className="px-4 py-3 font-mono text-xs text-slate-600">${asNumber(run.signals?.cost_usd).toFixed(4)}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">{asNumber(run.signals?.latency_ms) || "-"}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Runs({
  runs,
  selectedRun,
  events,
  loading,
  onRun,
  onAssetSubmitted,
}: {
  runs: ExternalRun[];
  selectedRun: ExternalRun | null;
  events: RunEvent[];
  loading: boolean;
  onRun: (run: ExternalRun) => void;
  onAssetSubmitted: () => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <Card className="p-5">
        <SectionHeader title="运行记录" subtitle="外部引擎上报的 run 流" />
        <RunTable runs={runs} selectedRunId={selectedRun?.run_id} onRun={onRun} />
      </Card>
      <RunDetail run={selectedRun} events={events} loading={loading} onAssetSubmitted={onAssetSubmitted} />
    </div>
  );
}

function DetailMetric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{note}</div>
    </div>
  );
}

function RunDetail({
  run,
  events,
  loading,
  onAssetSubmitted,
}: {
  run: ExternalRun | null;
  events: RunEvent[];
  loading: boolean;
  onAssetSubmitted: () => void;
}) {
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeMsg, setProposeMsg] = useState("");

  if (!run) return <EmptyState>选择一条运行记录查看明细。</EmptyState>;
  const signals = run.signals || {};

  const proposeAsset = async (assetType: "prompt" | "skill" | "workflow") => {
    setProposeBusy(true);
    setProposeMsg("");
    try {
      const res = await adminFetch("/api/v1/assets/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_type: assetType,
          source_run_id: run.run_id,
          name: `${assetType} from ${run.run_id}`,
          description: `Submitted from run ${run.run_id}`,
          team_id: run.team_id || "",
          engine_id: run.engine_id,
          content: {
            log_excerpt: run.log_excerpt || "",
            signals,
            status: run.status,
          },
        }),
      });
      if (!res.ok) throw new Error(`提交失败 (${res.status})`);
      setProposeMsg("已提交至资产审核队列");
      onAssetSubmitted();
    } catch (err) {
      setProposeMsg(err instanceof Error ? err.message : "提交失败");
    } finally {
      setProposeBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">Run detail</div>
            <h2 className="mt-2 truncate font-mono text-lg font-semibold text-slate-950">{run.run_id}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {run.engine_id}
              {run.team_id ? ` · team ${run.team_id}` : ""}
              {run.agent_id ? ` · agent ${run.agent_id}` : ""}
              {" · exit "}{run.exit_code} · {formatDateTimeShort(run.finished_at)}
            </p>
          </div>
          <Badge className={RUN_META[run.status].className}>{RUN_META[run.status].label}</Badge>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailMetric label="Cost" value={`$${asNumber(signals.cost_usd).toFixed(4)}`} note="cost_usd" />
          <DetailMetric label="Tokens" value={asNumber(signals.input_tokens) + asNumber(signals.output_tokens)} note="input + output" />
          <DetailMetric label="Latency" value={asNumber(signals.latency_ms) ? `${asNumber(signals.latency_ms)}ms` : "-"} note="latency_ms" />
          <DetailMetric label="Artifacts" value={run.artifact_manifest?.length ?? 0} note="manifest items" />
        </div>

        <div>
          <SectionHeader
            title="提交为资产"
            subtitle="进入资产审核队列（prompt / skill / workflow）"
            action={
              <div className="flex flex-wrap gap-2">
                {(["prompt", "skill", "workflow"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={proposeBusy}
                    onClick={() => proposeAsset(type)}
                    className="rounded-lg border border-violet-200 px-2.5 py-1 text-xs font-medium text-violet-700 disabled:opacity-50"
                  >
                    {type}
                  </button>
                ))}
              </div>
            }
          />
          {proposeMsg && <p className="text-xs text-slate-500">{proposeMsg}</p>}
        </div>

        {run.log_excerpt ? (
          <div>
            <SectionHeader title="Log excerpt" subtitle="已脱敏的日志摘要" />
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{run.log_excerpt}</pre>
          </div>
        ) : null}

        {run.artifact_manifest && run.artifact_manifest.length > 0 ? (
          <div>
            <SectionHeader title="Artifacts" subtitle="产物清单" />
            <ul className="space-y-2">
              {run.artifact_manifest.map((item) => (
                <li key={item.path} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                  <div className="font-mono font-medium text-slate-900">{item.path}</div>
                  <div className="mt-1 text-slate-500">{item.bytes} bytes · sha256 {item.sha256.slice(0, 12)}…</div>
                  {run.artifact_bundle_url && (
                    <a href={run.artifact_bundle_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-violet-600 hover:underline">
                      下载 bundle
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <SectionHeader title="Timeline" subtitle="对话、工具调用与风控事件" />
          {loading ? <p className="text-sm text-slate-500">加载事件...</p> : <Timeline events={events} />}
        </div>

        <div>
          <SectionHeader title="Signals" subtitle="结构化运行信号" />
          <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-200">{JSON.stringify(signals, null, 2)}</pre>
        </div>
      </div>
    </Card>
  );
}

function Timeline({ events }: { events: RunEvent[] }) {
  if (!events.length) return <EmptyState>暂无 events。上报 user_message / assistant_message / tool_call 后显示。</EmptyState>;
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={`${event.id}-${event.seq}`} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm font-semibold text-slate-950">{event.event_type}</div>
              <div className="mt-1 text-xs text-slate-500">#{event.seq}</div>
            </div>
            <span className="shrink-0 text-xs text-slate-500">{formatDateTimeShort(event.ts)}</span>
          </div>
          <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{JSON.stringify(event.payload || {}, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

function Costs({ cost }: { cost: CostSummary | null }) {
  const engineChart = cost?.by_engine || [];
  const teamChart = cost?.by_team || [];
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="总成本" value={`$${(cost?.total_cost_usd || 0).toFixed(4)}`} note="cost_usd" />
        <StatCard label="运行数" value={cost?.total_runs || 0} note="runs" />
        <StatCard label="输入 Token" value={cost?.input_tokens || 0} note="input" />
        <StatCard label="输出 Token" value={cost?.output_tokens || 0} note="output" />
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="按引擎聚合" subtitle="cost_usd by engine" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={engineChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="engine_id" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a" }} />
                <Bar dataKey="cost_usd" fill="#2563eb" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <SectionHeader title="按团队聚合" subtitle="cost_usd by team_id" />
          <div className="h-72">
            {teamChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="team_id" stroke="#64748b" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a" }} />
                  <Bar dataKey="cost_usd" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>暂无 team_id 维度数据。</EmptyState>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function RiskFeed({ violations, onRun }: { violations: PolicyViolation[]; onRun: (runId: string) => void }) {
  if (!violations.length) return <EmptyState>暂无风控事件。</EmptyState>;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {violations.map((item) => (
        <button key={item.violation_id} onClick={() => onRun(item.run_id)} className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Badge className={RISK_META[item.severity].className}>{RISK_META[item.severity].label}</Badge>
            <span className="text-xs text-slate-500">{formatDateTimeShort(item.ts)}</span>
          </div>
          <div className="truncate font-mono text-sm font-semibold text-slate-950">{item.policy_id}</div>
          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.message || "No message"}</p>
          <div className="mt-3 truncate rounded-lg bg-slate-50 px-2 py-1 font-mono text-xs text-slate-500">{item.action} · {item.resource_type} · {item.resource || "-"}</div>
        </button>
      ))}
    </div>
  );
}

function Risks({ violations, onRun }: { violations: PolicyViolation[]; onRun: (runId: string) => void }) {
  const counts = {
    critical: violations.filter((item) => item.severity === "critical").length,
    high: violations.filter((item) => item.severity === "high").length,
    medium: violations.filter((item) => item.severity === "medium").length,
    low: violations.filter((item) => item.severity === "low").length,
  };
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="严重" value={counts.critical} note="critical" />
        <StatCard label="高危" value={counts.high} note="high" />
        <StatCard label="中危" value={counts.medium} note="medium" />
        <StatCard label="低危" value={counts.low} note="low" />
      </section>
      <Card className="p-5">
        <SectionHeader title="风控列表" subtitle="策略命中、阻断动作与资源范围" />
        <RiskFeed violations={violations} onRun={onRun} />
      </Card>
    </div>
  );
}
