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

type ConsoleTab = "dashboard" | "gateway" | "engines" | "runs" | "costs" | "risk";

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
};

type ExternalRun = {
  run_id: string;
  engine_id: string;
  engine_version: string;
  status: "succeeded" | "failed" | "cancelled";
  exit_code: number;
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
  { id: "engines", label: "引擎", desc: "Engines" },
  { id: "runs", label: "运行", desc: "Runs" },
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

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/v1/engines").then((r) => {
        if (!r.ok) throw new Error(`engines ${r.status}`);
        return r.json() as Promise<{ engines?: EngineRecord[] }>;
      }),
      fetch("/api/v1/runs?limit=200").then((r) => {
        if (!r.ok) throw new Error(`runs ${r.status}`);
        return r.json() as Promise<{ runs?: ExternalRun[] }>;
      }),
      fetch("/api/v1/policy/violations?limit=200").then((r) => {
        if (!r.ok) throw new Error(`violations ${r.status}`);
        return r.json() as Promise<{ violations?: PolicyViolation[] }>;
      }),
      fetch("/api/v1/costs/summary").then((r) => {
        if (!r.ok) throw new Error(`costs ${r.status}`);
        return r.json() as Promise<CostSummary>;
      }),
      fetch("/api/gateway/v1/usage/summary").then((r) => {
        if (!r.ok) throw new Error(`gateway ${r.status}`);
        return r.json() as Promise<GatewaySummary>;
      }),
      fetch("/api/gateway/v1/conversations?limit=100").then((r) => {
        if (!r.ok) throw new Error(`conversations ${r.status}`);
        return r.json() as Promise<{ conversations?: GatewayConversation[] }>;
      }),
      fetch("/api/gateway/v1/api-keys").then((r) => {
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "load failed"))
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
      fetch(`/api/v1/runs/${encodeURIComponent(run.run_id)}/events`).then((r) => r.json() as Promise<{ events?: RunEvent[] }>),
      fetch(`/api/v1/policy/violations?run_id=${encodeURIComponent(run.run_id)}`).then((r) => r.json() as Promise<{ violations?: PolicyViolation[] }>),
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
              onClick={() => navigate("/arena")}
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
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => navigate("/arena")}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 md:hidden"
                >
                  Arena
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
            {tab === "engines" && <Engines engines={data.engines} runs={data.runs} violations={data.violations} />}
            {tab === "runs" && <Runs runs={data.runs} selectedRun={selectedRun} events={events} loading={eventsLoading} onRun={openRun} />}
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
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-200">{`OPENAI_BASE_URL=http://127.0.0.1:8765/api/gateway/v1
OPENAI_API_KEY=evotown_agent_key_xxx

# optional attribution headers
X-Evotown-Agent-Id: agent-local-001
X-Evotown-Team-Id: platform
X-Evotown-Engine-Id: openclaw-local`}</pre>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="font-semibold text-slate-950">LiteLLM backend</div>
            <p className="mt-2">
              Evotown 负责企业身份、对话审计、成本归属和风控；LiteLLM 负责模型供应商适配、fallback、路由和基础成本统计。
            </p>
            <div className="mt-4 text-xs text-slate-500">Configured gateway keys: {data.gatewayKeys.length}</div>
          </div>
        </div>
      </Card>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="模型用量" subtitle="按 model 聚合请求、成本和 token" />
          <SimpleUsageTable rows={byModel} nameKey="model" empty="暂无模型调用。" />
        </Card>
        <Card className="p-5">
          <SectionHeader title="Agent 用量" subtitle="按 agent_id 聚合网关流量" />
          <SimpleUsageTable rows={byAgent} nameKey="agent_id" empty="暂无 agent 归属数据。" />
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
        <Badge className={meta.className}>{meta.label}</Badge>
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
