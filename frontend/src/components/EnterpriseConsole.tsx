import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { GatewayModelRoutesPanel } from "./GatewayModelRoutesPanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { EmployeeConfigPanel } from "./market/EmployeeConfigPanel";
import { DispatchPanel } from "./DispatchPanel";
import { adminFetch, clearConsoleSession, isConsoleAuthenticated } from "../hooks/useAdminToken";

type ConsoleTab = "dashboard" | "gateway" | "accounts" | "engines" | "dispatch" | "runs" | "skills" | "knowledge" | "costs" | "risk";

type EngineRecord = {
  engine_id: string;
  engine_type: "openclaw" | "hermes" | "skilllite" | "custom";
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
  engine_type?: "openclaw" | "hermes" | "skilllite" | "custom";
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
  team_id?: string;
  engine_id?: string;
  model?: string;
};

type GatewayKeyInfo = {
  key_label: string;
  scope: string;
};

type SkillRecord = {
  skill_id: string;
  name: string;
  description?: string;
  version: string;
  runtime_targets: Array<EngineRecord["engine_type"]>;
  package_url?: string;
  package_sha256?: string;
  package_bytes?: number;
  status: "approved" | "deprecated";
  visibility: "private" | "team" | "company";
  team_id?: string;
  tags?: string[];
  source_run_id?: string;
  updated_at?: string;
};

type SkillCandidate = {
  candidate_id: string;
  source_run_id: string;
  tenant_id?: string;
  team_id?: string;
  agent_id?: string;
  engine_id: string;
  runtime_target: EngineRecord["engine_type"];
  name: string;
  description?: string;
  package_url?: string;
  inline_manifest?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  reviewer?: string;
  review_reason?: string;
  visibility?: "private" | "team" | "company";
  created_at?: string;
  reviewed_at?: string;
};

type BundleManifest = {
  bundle_id: string;
  version: string;
  channel: string;
  runtime_targets: Array<EngineRecord["engine_type"]>;
  skills: Array<{ skill_id: string; name: string; version: string; package_url: string }>;
  signature: string;
  published_at: string;
};

type ConsoleData = {
  engines: EngineRecord[];
  runs: ExternalRun[];
  violations: PolicyViolation[];
  cost: CostSummary | null;
  gateway: GatewaySummary | null;
  conversations: GatewayConversation[];
  gatewayKeys: GatewayKeyInfo[];
};

const NAV_ITEMS: Array<{ id: ConsoleTab; label: string; desc: string }> = [
  { id: "dashboard", label: "总览", desc: "Overview" },
  { id: "gateway", label: "网关", desc: "Gateway" },
  { id: "accounts", label: "账号", desc: "Accounts" },
  { id: "engines", label: "引擎", desc: "Engines" },
  { id: "dispatch", label: "派活", desc: "Dispatch" },
  { id: "runs", label: "运行", desc: "Runs" },
  { id: "skills", label: "技能", desc: "Skills" },
  { id: "knowledge", label: "知识库", desc: "Knowledge" },
  { id: "costs", label: "成本", desc: "Costs" },
  { id: "risk", label: "风控", desc: "Risk" },
];

const ENGINE_META: Record<EngineRecord["engine_type"], { label: string; className: string }> = {
  openclaw: { label: "OpenClaw", className: "border-sky-200 bg-sky-50 text-sky-700" },
  hermes: { label: "Hermes", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  skilllite: { label: "SkillLite", className: "border-amber-200 bg-amber-50 text-amber-700" },
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

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export function EnterpriseConsole({ initialTab = "dashboard" }: { initialTab?: ConsoleTab }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ConsoleTab>(initialTab);
  const [data, setData] = useState<ConsoleData>({ engines: [], runs: [], violations: [], cost: null, gateway: null, conversations: [], gatewayKeys: [] });
  const [selectedRun, setSelectedRun] = useState<ExternalRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionName, setSessionName] = useState("");

  useEffect(() => {
    if (!isConsoleAuthenticated()) {
      navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`, { replace: true });
      return;
    }
    adminFetch("/api/v1/auth/me")
      .then((r) => r.ok ? r.json() as Promise<{ session?: { account_name?: string } }> : null)
      .then((data) => setSessionName(data?.session?.account_name || ""))
      .catch(() => setSessionName(""));
  }, [navigate]);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      adminFetch("/api/v1/engines/fleet").then((r) => {
        if (!r.ok) throw new Error(`engines ${r.status}`);
        return r.json() as Promise<{ engines?: EngineRecord[] }>;
      }),
      adminFetch("/api/v1/runs?limit=200").then((r) => {
        if (!r.ok) throw new Error(`runs ${r.status}`);
        return r.json() as Promise<{ runs?: ExternalRun[] }>;
      }),
      adminFetch("/api/v1/policy/violations?limit=200").then((r) => {
        if (!r.ok) throw new Error(`violations ${r.status}`);
        return r.json() as Promise<{ violations?: PolicyViolation[] }>;
      }),
      adminFetch("/api/v1/costs/summary").then((r) => {
        if (!r.ok) throw new Error(`costs ${r.status}`);
        return r.json() as Promise<CostSummary>;
      }),
      adminFetch("/api/gateway/v1/usage/summary").then((r) => {
        if (!r.ok) throw new Error(`gateway ${r.status}`);
        return r.json() as Promise<GatewaySummary>;
      }),
      adminFetch("/api/gateway/v1/conversations?limit=100").then((r) => {
        if (!r.ok) throw new Error(`conversations ${r.status}`);
        return r.json() as Promise<{ conversations?: GatewayConversation[] }>;
      }),
      adminFetch("/api/gateway/v1/api-keys").then((r) => {
        if (!r.ok) throw new Error(`gateway keys ${r.status}`);
        return r.json() as Promise<{ keys?: GatewayKeyInfo[] }>;
      }),
    ])
      .then(([engines, runs, violations, cost, gateway, conversations, keys]) => {
        const nextRuns = Array.isArray(runs.runs) ? runs.runs : [];
        setData({
          engines: Array.isArray(engines.engines) ? engines.engines : [],
          runs: nextRuns,
          violations: Array.isArray(violations.violations) ? violations.violations : [],
          cost,
          gateway,
          conversations: Array.isArray(conversations.conversations) ? conversations.conversations : [],
          gatewayKeys: Array.isArray(keys.keys) ? keys.keys : [],
        });
        setSelectedRun((current) => current ?? nextRuns[0] ?? null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "load failed";
        setError(msg.includes("403") || msg.includes("401") ? `${msg} — 请重新登录` : msg);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, []);

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
    navigate(next === "dashboard" ? "/dashboard" : `/${next}`);
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
        <aside className="hidden w-64 shrink-0 bg-slate-950 text-white md:flex md:flex-col">
          <div className="border-b border-white/10 px-5 py-5">
            <button onClick={() => navigate("/")} className="flex items-center gap-3 text-left">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500 text-sm font-semibold text-white">E</span>
              <span>
                <span className="block text-sm font-semibold">Evotown Console</span>
                <span className="mt-0.5 block text-xs text-slate-400">Enterprise control plane</span>
              </span>
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setRoute(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  tab === item.id ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="font-medium">{item.label}</span>
                <span className={`text-xs ${tab === item.id ? "text-slate-500" : "text-slate-500"}`}>{item.desc}</span>
              </button>
            ))}
          </nav>
          <div className="border-t border-white/10 p-4">
            <button
              onClick={() => navigate("/")}
              className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              打开 Arena
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between lg:px-8">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Management Console</div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">企业管理后台</h1>
                <p className="mt-1 text-sm text-slate-500">外部引擎接入、运行记录、成本和风控事件统一观测。</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sessionName && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">已登录：{sessionName}</span>}
                <button
                  onClick={() => navigate("/")}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 md:hidden"
                >
                  Arena
                </button>
                <button
                  onClick={() => {
                    clearConsoleSession();
                    navigate("/login");
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  退出登录
                </button>
                <button
                  onClick={load}
                  disabled={loading}
                  className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {loading ? "刷新中..." : "刷新数据"}
                </button>
              </div>
            </div>
            <nav className="flex gap-2 overflow-x-auto px-5 pb-4 md:hidden">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setRoute(item.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                    tab === item.id ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </header>

          <div className="px-5 py-6 lg:px-8">
            {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">加载失败：{error}</div>}

            {tab === "dashboard" && <Dashboard data={data} summary={summary} onTab={setRoute} onRun={openRun} />}
            {tab === "gateway" && <Gateway data={data} />}
            {tab === "accounts" && <GatewayAccountsPanel />}
            {tab === "engines" && <Engines engines={data.engines} runs={data.runs} violations={data.violations} />}
            {tab === "dispatch" && <DispatchPanel engines={data.engines} onRefresh={load} />}
            {tab === "runs" && <Runs runs={data.runs} selectedRun={selectedRun} events={events} loading={eventsLoading} onRun={openRun} />}
            {tab === "skills" && <SkillsMarketPanel />}
            {tab === "knowledge" && <KnowledgePanel />}
            {tab === "costs" && <Costs cost={data.cost} />}
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
  onTab,
  onRun,
}: {
  data: ConsoleData;
  summary: { total: number; ok: number; failed: number; risk: number; critical: number; successRate: number };
  onTab: (tab: ConsoleTab) => void;
  onRun: (run: ExternalRun) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="已接入引擎" value={data.engines.length} note="OpenClaw / Hermes / Custom" />
        <StatCard label="运行总数" value={summary.total} note={`成功率 ${summary.successRate}%`} />
        <StatCard label="累计成本" value={`$${(data.cost?.total_cost_usd || 0).toFixed(4)}`} note={`${data.cost?.input_tokens || 0} input tokens`} />
        <StatCard label="待处理风险" value={summary.risk} note={`${summary.critical} critical`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <Card className="p-5">
          <SectionHeader
            title="引擎概览"
            subtitle="当前已注册的外部运行时"
            action={<button onClick={() => onTab("engines")} className="text-sm font-medium text-blue-600 hover:text-blue-700">查看全部</button>}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {data.engines.length ? data.engines.slice(0, 4).map((engine) => <EngineCard key={engine.engine_id} engine={engine} runs={data.runs} violations={data.violations} />) : <EmptyState>暂无引擎接入。</EmptyState>}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            title="最近运行"
            subtitle="点击查看对话、工具调用和结构化信号"
            action={<button onClick={() => onTab("runs")} className="text-sm font-medium text-blue-600 hover:text-blue-700">查看全部</button>}
          />
          <RunTable runs={data.runs.slice(0, 8)} selectedRunId={null} onRun={onRun} compact />
        </Card>
      </section>

      <Card className="p-5">
        <SectionHeader
          title="风控事件"
          subtitle="最新策略命中和阻断动作"
          action={<button onClick={() => onTab("risk")} className="text-sm font-medium text-blue-600 hover:text-blue-700">处理</button>}
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

function Gateway({ data }: { data: ConsoleData }) {
  const total = data.gateway?.total || {};
  const byModel = data.gateway?.by_model || [];
  const byAgent = data.gateway?.by_agent || [];
  const byAccount = data.gateway?.by_account || [];
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="网关请求" value={total.total_requests || 0} note="OpenAI-compatible calls" />
        <StatCard label="网关成本" value={`$${asNumber(total.total_cost_usd).toFixed(4)}`} note="proxied via LiteLLM" />
        <StatCard label="总 Token" value={total.total_tokens || 0} note={`${total.prompt_tokens || 0} prompt / ${total.completion_tokens || 0} completion`} />
        <StatCard label="平均延迟" value={total.avg_latency_ms ? `${Math.round(total.avg_latency_ms)}ms` : "-"} note="gateway observed latency" />
      </section>

      <Card className="p-5">
        <SectionHeader
          title="接入方式"
          subtitle="子 agent 只需要把 OpenAI-compatible endpoint 指到 Evotown"
        />
        <EmployeeConfigPanel compact className="border-slate-200 bg-slate-50/50" />
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <div className="font-semibold text-slate-950">LiteLLM backend</div>
            <p className="mt-2">
              Evotown 负责企业身份、对话审计、成本归属和风控；LiteLLM 负责模型供应商适配、fallback、路由和基础成本统计。
            </p>
            <div className="mt-4 text-xs text-slate-500">Configured gateway keys: {data.gatewayKeys.length}</div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader
          title="模型路由"
          subtitle="按 alias 将客户端 model 映射到 LiteLLM target；支持团队 / 账号 scope"
        />
        <GatewayModelRoutesPanel />
      </Card>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5">
          <SectionHeader title="模型用量" subtitle="按 model 聚合请求、成本和 token" />
          <SimpleUsageTable rows={byModel} nameKey="model" empty="暂无模型调用。" />
        </Card>
        <Card className="p-5">
          <SectionHeader title="Agent 用量" subtitle="按 agent_id 聚合网关流量" />
          <SimpleUsageTable rows={byAgent} nameKey="agent_id" empty="暂无 agent 归属数据。" />
        </Card>
        <Card className="p-5">
          <SectionHeader title="账号用量" subtitle="按 account_id 聚合网关流量" />
          <SimpleUsageTable rows={byAccount} nameKey="account_id" empty="暂无账号归属数据。" />
        </Card>
      </section>

      <Card className="p-5">
        <SectionHeader title="Conversations" subtitle="中心化沉淀的会话流，后续可进入全文审计和资产提取" />
        <ConversationTable conversations={data.conversations} />
      </Card>
    </div>
  );
}

function SimpleUsageTable({
  rows,
  nameKey,
  empty,
}: {
  rows: Array<Record<string, string | number>>;
  nameKey: string;
  empty: string;
}) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="w-28 px-4 py-3 font-semibold">Requests</th>
            <th className="w-28 px-4 py-3 font-semibold">Cost</th>
            <th className="w-28 px-4 py-3 font-semibold">Tokens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={String(row[nameKey])}>
              <td className="truncate px-4 py-3 font-mono text-xs font-semibold text-slate-950">{row[nameKey] || "-"}</td>
              <td className="px-4 py-3 text-slate-600">{row.requests || 0}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">${asNumber(row.cost_usd).toFixed(4)}</td>
              <td className="px-4 py-3 text-slate-600">{row.total_tokens || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConversationTable({ conversations }: { conversations: GatewayConversation[] }) {
  if (!conversations.length) return <EmptyState>暂无 gateway conversations。</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Conversation</th>
            <th className="w-36 px-4 py-3 font-semibold">Agent</th>
            <th className="w-32 px-4 py-3 font-semibold">Model</th>
            <th className="w-24 px-4 py-3 font-semibold">Calls</th>
            <th className="w-28 px-4 py-3 font-semibold">Cost</th>
            <th className="w-32 px-4 py-3 font-semibold">Last seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {conversations.map((item) => (
            <tr key={item.conversation_id}>
              <td className="truncate px-4 py-3 font-mono text-xs font-semibold text-slate-950">{item.conversation_id}</td>
              <td className="truncate px-4 py-3 font-mono text-xs text-slate-600">{item.agent_id || "-"}</td>
              <td className="truncate px-4 py-3 text-slate-600">{item.model || "-"}</td>
              <td className="px-4 py-3 text-slate-600">{item.requests}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">${asNumber(item.cost_usd).toFixed(4)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDate(item.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EngineCard({ engine, runs, violations }: { engine: EngineRecord; runs: ExternalRun[]; violations: PolicyViolation[] }) {
  const meta = ENGINE_META[engine.engine_type];
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

function SkillsMarketPanel() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({
    query: "",
    tag: "",
    runtime_target: "",
    status_filter: "",
  });
  const [upload, setUpload] = useState({
    skill_id: "",
    name: "",
    version: "1.0.0",
    runtime_targets: "openclaw,hermes,skilllite",
    visibility: "team",
    team_id: "",
    tags: "",
    description: "",
  });
  const [bundlePublish, setBundlePublish] = useState({
    bundle_id: "default-agent-skills",
    channel: "stable",
    version: "",
  });
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  const buildSkillsUrl = (nextFilters = filters) => {
    const params = new URLSearchParams({ limit: "200" });
    if (nextFilters.query.trim()) params.set("query", nextFilters.query.trim());
    if (nextFilters.tag.trim()) params.set("tag", nextFilters.tag.trim());
    if (nextFilters.runtime_target.trim()) params.set("runtime_target", nextFilters.runtime_target.trim());
    if (nextFilters.status_filter) params.set("status_filter", nextFilters.status_filter);
    return `/api/v1/skills?${params.toString()}`;
  };

  const loadMarket = (nextFilters = filters) => {
    setLoading(true);
    Promise.all([
      adminFetch("/api/v1/skill-bundles/default-agent-skills/manifest").then((r) => r.json() as Promise<{ manifest?: BundleManifest }>),
      adminFetch(buildSkillsUrl(nextFilters)).then((r) => r.json() as Promise<{ skills?: SkillRecord[] }>),
      adminFetch("/api/v1/skill-candidates?limit=200").then((r) => r.json() as Promise<{ candidates?: SkillCandidate[] }>),
    ])
      .then(([bundleData, skillData, candidateData]) => {
        const nextManifest = bundleData.manifest ?? null;
        const nextSkills = Array.isArray(skillData.skills) ? skillData.skills : [];
        setManifest(nextManifest);
        setSkills(nextSkills);
        setCandidates(Array.isArray(candidateData.candidates) ? candidateData.candidates : []);
        if (nextManifest?.skills?.length) {
          const approvedIds = new Set(
            nextSkills.filter((item) => item.status === "approved").map((item) => item.skill_id),
          );
          const fromManifest = nextManifest.skills
            .map((item) => item.skill_id)
            .filter((id) => approvedIds.has(id));
          setSelectedSkillIds(new Set(fromManifest));
        }
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "加载 Skills 市场失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMarket();
  }, []);

  const uploadPackage = async (file: File | null) => {
    if (!file) return;
    if (!upload.skill_id.trim() || !upload.name.trim()) {
      setMessage("请先填写 skill_id 和名称。");
      return;
    }
    const content_base64 = await fileToBase64(file);
    const body = {
      ...upload,
      runtime_targets: upload.runtime_targets.split(",").map((v) => v.trim()).filter(Boolean),
      tags: upload.tags.split(",").map((v) => v.trim()).filter(Boolean),
      filename: file.name,
      content_base64,
    };
    const res = await adminFetch("/api/v1/skill-packages", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMessage(`上传失败：${res.status}`);
      return;
    }
    setMessage("Skill 包已上传。请在下方「发布 Bundle」勾选并发布，员工 manifest 才会更新。");
    setUpload({ skill_id: "", name: "", version: "1.0.0", runtime_targets: "openclaw,hermes,skilllite", visibility: "team", team_id: "", tags: "", description: "" });
    loadMarket();
  };

  const reviewCandidate = async (candidate: SkillCandidate, decision: "approved" | "rejected") => {
    const res = await adminFetch(`/api/v1/skill-candidates/${encodeURIComponent(candidate.candidate_id)}/review`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        reviewer: "admin",
        reason: decision === "approved" ? "approved from console" : "rejected from console",
        visibility: candidate.team_id ? "team" : "company",
        promotion_channel: decision === "approved" ? "stable" : undefined,
      }),
    });
    if (!res.ok) {
      setMessage(`审核失败：${res.status}`);
      return;
    }
    setMessage(decision === "approved" ? "候选技能已批准并进入市场。" : "候选技能已拒绝。");
    loadMarket();
  };

  const downloadSkillPackage = async (skill: SkillRecord) => {
    if (!skill.package_url) return;
    const res = await adminFetch(skill.package_url);
    if (!res.ok) {
      setMessage(`下载失败：${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.skill_id}.skill.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deprecateSkill = async (skill: SkillRecord) => {
    if (skill.status === "deprecated") return;
    if (!window.confirm(`确定下线「${skill.name}」（${skill.skill_id}）？下线后将从 Bootstrap manifest 中移除。`)) return;
    const res = await adminFetch(`/api/v1/skills/${encodeURIComponent(skill.skill_id)}/deprecate`, {
      method: "POST",
      body: JSON.stringify({
        reason: "deprecated from console",
        reviewer: "admin",
      }),
    });
    if (!res.ok) {
      setMessage(`下线失败：${res.status}`);
      return;
    }
    setMessage(`技能 ${skill.skill_id} 已下线。`);
    loadMarket();
  };

  const publishBundle = async (includeAllApproved: boolean) => {
    const skill_ids = includeAllApproved ? [] : Array.from(selectedSkillIds);
    if (!includeAllApproved && !skill_ids.length) {
      setMessage("请至少选择一个 skill，或使用「发布全部已批准」。");
      return;
    }
    const res = await adminFetch(
      `/api/v1/skill-bundles/${encodeURIComponent(bundlePublish.bundle_id)}/publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: bundlePublish.channel,
          version: bundlePublish.version.trim() || null,
          skill_ids,
          include_all_approved: includeAllApproved,
        }),
      },
    );
    const data = await res.json() as { detail?: string; manifest?: BundleManifest };
    if (!res.ok) {
      setMessage(data.detail || `发布 Bundle 失败：${res.status}`);
      return;
    }
    setMessage(
      `Bundle 已发布：${data.manifest?.bundle_id}@${data.manifest?.version}，共 ${data.manifest?.skills?.length ?? 0} 个 skill。`,
    );
    loadMarket();
  };

  const toggleSkillSelection = (skillId: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  };

  const selectAllApproved = () => {
    setSelectedSkillIds(
      new Set(skills.filter((item) => item.status === "approved").map((item) => item.skill_id)),
    );
  };

  const applyFilters = () => loadMarket(filters);

  const resetFilters = () => {
    const cleared = { query: "", tag: "", runtime_target: "", status_filter: "" };
    setFilters(cleared);
    loadMarket(cleared);
  };

  const pending = candidates.filter((item) => item.status === "pending");
  const approvedCount = skills.filter((item) => item.status !== "deprecated").length;
  const deprecatedCount = skills.filter((item) => item.status === "deprecated").length;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="可用 Skills" value={approvedCount} note="approved / 可安装" />
        <StatCard label="已下线" value={deprecatedCount} note="deprecated / 不可安装" />
        <StatCard label="待审核候选" value={pending.length} note="Connector 提交" />
        <StatCard label="Bootstrap Bundle" value={manifest ? manifest.skills.length : "-"} note={manifest?.bundle_id ?? "default-agent-skills"} />
      </section>

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}

      <Card className="p-5">
        <SectionHeader
          title="私有化部署包上传"
          subtitle="上传后可在 /market 前台展示；运行端通过 manifest 获取 package_url。"
          action={<a href="/market" target="_blank" rel="noreferrer" className="text-sm font-medium text-violet-600 hover:text-violet-700">打开市场前台 →</a>}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="skill_id，例如 private-crm-summary" value={upload.skill_id} onChange={(e) => setUpload({ ...upload, skill_id: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="名称" value={upload.name} onChange={(e) => setUpload({ ...upload, name: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="版本" value={upload.version} onChange={(e) => setUpload({ ...upload, version: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="team_id" value={upload.team_id} onChange={(e) => setUpload({ ...upload, team_id: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm xl:col-span-2" placeholder="runtime_targets: openclaw,hermes,skilllite" value={upload.runtime_targets} onChange={(e) => setUpload({ ...upload, runtime_targets: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm xl:col-span-2" placeholder="tags: crm,private" value={upload.tags} onChange={(e) => setUpload({ ...upload, tags: e.target.value })} />
          <textarea className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2 xl:col-span-3" placeholder="描述" value={upload.description} onChange={(e) => setUpload({ ...upload, description: e.target.value })} />
          <label className="flex cursor-pointer items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            选择包并上传
            <input className="hidden" type="file" onChange={(e) => uploadPackage(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader
          title="发布 Bundle"
          subtitle="将已批准的 skill 写入 bootstrap manifest；员工与 evotown-agent-setup sync 拉取的是本步骤结果。"
        />
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="bundle_id"
            value={bundlePublish.bundle_id}
            onChange={(e) => setBundlePublish({ ...bundlePublish, bundle_id: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="channel（默认 stable）"
            value={bundlePublish.channel}
            onChange={(e) => setBundlePublish({ ...bundlePublish, channel: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="version（留空自动 patch+1）"
            value={bundlePublish.version}
            onChange={(e) => setBundlePublish({ ...bundlePublish, version: e.target.value })}
          />
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAllApproved}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            全选已批准
          </button>
          <button
            type="button"
            onClick={() => publishBundle(false)}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
          >
            发布选中（{selectedSkillIds.size}）
          </button>
          <button
            type="button"
            onClick={() => publishBundle(true)}
            className="rounded-lg border border-violet-200 px-4 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
          >
            发布全部已批准
          </button>
        </div>
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
          {skills.filter((item) => item.status === "approved").length ? (
            skills
              .filter((item) => item.status === "approved")
              .map((skill) => (
                <label key={skill.skill_id} className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSkillIds.has(skill.skill_id)}
                    onChange={() => toggleSkillSelection(skill.skill_id)}
                  />
                  <span className="font-semibold text-slate-950">{skill.name}</span>
                  <span className="font-mono text-xs text-slate-500">{skill.skill_id}</span>
                </label>
              ))
          ) : (
            <p className="text-sm text-slate-500">暂无已批准 skill 可发布。</p>
          )}
        </div>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <SectionHeader title="Bootstrap Manifest" subtitle="运行端首次安装时使用的初始化能力包。" action={<button onClick={() => loadMarket()} className="text-sm font-medium text-blue-600">{loading ? "刷新中..." : "刷新"}</button>} />
          {manifest ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                <div className="font-mono text-slate-900">{manifest.bundle_id}@{manifest.version}</div>
                <div className="mt-1">channel: {manifest.channel} · signature: {manifest.signature}</div>
              </div>
              {manifest.skills.map((skill) => (
                <div key={skill.skill_id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm">
                  <div>
                    <div className="font-semibold text-slate-950">{skill.name}</div>
                    <div className="font-mono text-xs text-slate-500">{skill.package_url}</div>
                  </div>
                  <Badge>{skill.version}</Badge>
                </div>
              ))}
            </div>
          ) : <EmptyState>暂无 bootstrap manifest。</EmptyState>}
        </Card>

        <Card className="p-5">
          <SectionHeader title="候选技能审核" subtitle="Connector 从 OpenClaw / Hermes / SkillLite 收集的技能候选。" />
          {candidates.length ? (
            <div className="space-y-3">
              {candidates.map((candidate) => (
                <div key={candidate.candidate_id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{candidate.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{candidate.description || "无描述"}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{candidate.runtime_target}</span>
                        <span>{candidate.engine_id}</span>
                        <span>{candidate.team_id || "no-team"}</span>
                      </div>
                    </div>
                    <Badge className={candidate.status === "pending" ? "border-amber-200 bg-amber-50 text-amber-700" : candidate.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}>{candidate.status}</Badge>
                  </div>
                  {candidate.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => reviewCandidate(candidate, "approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">批准</button>
                      <button onClick={() => reviewCandidate(candidate, "rejected")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600">拒绝</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <EmptyState>暂无候选技能。</EmptyState>}
        </Card>
      </section>

      <Card className="p-5">
        <SectionHeader
          title="已发布 Skills"
          subtitle="支持关键词、标签、runtime 与状态筛选；下线后不再出现在 Bootstrap manifest。"
          action={<button onClick={() => loadMarket()} className="text-sm font-medium text-blue-600">{loading ? "刷新中..." : "刷新"}</button>}
        />
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm xl:col-span-2"
            placeholder="搜索名称或描述"
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="tag，例如 crm"
            value={filters.tag}
            onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={filters.runtime_target}
            onChange={(e) => setFilters({ ...filters, runtime_target: e.target.value })}
          >
            <option value="">全部 runtime</option>
            <option value="openclaw">openclaw</option>
            <option value="hermes">hermes</option>
            <option value="skilllite">skilllite</option>
            <option value="custom">custom</option>
          </select>
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={filters.status_filter}
            onChange={(e) => setFilters({ ...filters, status_filter: e.target.value })}
          >
            <option value="">全部状态</option>
            <option value="approved">approved</option>
            <option value="deprecated">deprecated</option>
          </select>
        </div>
        <div className="mb-4 flex gap-2">
          <button onClick={applyFilters} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">应用筛选</button>
          <button onClick={resetFilters} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">重置</button>
        </div>
        {skills.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Skill</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Runtime</th>
                  <th className="px-4 py-3">Visibility</th>
                  <th className="px-4 py-3">Package</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {skills.map((skill) => (
                  <tr key={skill.skill_id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-950">{skill.name}</div>
                      <div className="font-mono text-xs text-slate-500">{skill.skill_id}</div>
                      {skill.tags?.length ? <div className="mt-1 text-xs text-slate-400">{skill.tags.join(", ")}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={skill.status === "deprecated" ? "border-slate-200 bg-slate-100 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                        {skill.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{skill.runtime_targets.join(", ")}</td>
                    <td className="px-4 py-3 text-slate-600">{skill.visibility}{skill.team_id ? ` · ${skill.team_id}` : ""}</td>
                    <td className="px-4 py-3">
                      {skill.package_url ? (
                        <button onClick={() => downloadSkillPackage(skill)} className="text-blue-600 hover:text-blue-700">
                          {skill.package_bytes ? `${skill.package_bytes} bytes` : "download"}
                        </button>
                      ) : <span className="text-slate-400">builtin</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(skill.updated_at)}</td>
                    <td className="px-4 py-3">
                      {skill.status !== "deprecated" ? (
                        <button onClick={() => deprecateSkill(skill)} className="text-xs font-medium text-red-600 hover:text-red-700">下线</button>
                      ) : <span className="text-xs text-slate-400">已下线</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>没有匹配的技能，请调整筛选条件。</EmptyState>}
      </Card>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
                <div className="mt-1 text-xs text-slate-500">{formatDate(run.finished_at)}</div>
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

function Runs({ runs, selectedRun, events, loading, onRun }: { runs: ExternalRun[]; selectedRun: ExternalRun | null; events: RunEvent[]; loading: boolean; onRun: (run: ExternalRun) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <Card className="p-5">
        <SectionHeader title="运行记录" subtitle="外部引擎上报的 run 流" />
        <RunTable runs={runs} selectedRunId={selectedRun?.run_id} onRun={onRun} />
      </Card>
      <RunDetail run={selectedRun} events={events} loading={loading} />
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

function RunDetail({ run, events, loading }: { run: ExternalRun | null; events: RunEvent[]; loading: boolean }) {
  if (!run) return <EmptyState>选择一条运行记录查看明细。</EmptyState>;
  const signals = run.signals || {};
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">Run detail</div>
            <h2 className="mt-2 truncate font-mono text-lg font-semibold text-slate-950">{run.run_id}</h2>
            <p className="mt-1 text-sm text-slate-500">{run.engine_id} · exit {run.exit_code} · {formatDate(run.finished_at)}</p>
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
            <span className="shrink-0 text-xs text-slate-500">{formatDate(event.ts)}</span>
          </div>
          <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{JSON.stringify(event.payload || {}, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

function Costs({ cost }: { cost: CostSummary | null }) {
  const chartData = cost?.by_engine || [];
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="总成本" value={`$${(cost?.total_cost_usd || 0).toFixed(4)}`} note="cost_usd" />
        <StatCard label="运行数" value={cost?.total_runs || 0} note="runs" />
        <StatCard label="输入 Token" value={cost?.input_tokens || 0} note="input" />
        <StatCard label="输出 Token" value={cost?.output_tokens || 0} note="output" />
      </section>
      <Card className="p-5">
        <SectionHeader title="按引擎聚合" subtitle="cost_usd by engine" />
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="engine_id" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a" }} />
              <Bar dataKey="cost_usd" fill="#2563eb" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
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
            <span className="text-xs text-slate-500">{formatDate(item.ts)}</span>
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
