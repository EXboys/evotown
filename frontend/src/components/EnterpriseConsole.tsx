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

type ConsoleTab = "dashboard" | "engines" | "runs" | "costs" | "risk";

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

type ConsoleData = {
  engines: EngineRecord[];
  runs: ExternalRun[];
  violations: PolicyViolation[];
  cost: CostSummary | null;
};

const NAV_ITEMS: Array<{ id: ConsoleTab; label: string; desc: string }> = [
  { id: "dashboard", label: "总览", desc: "Overview" },
  { id: "engines", label: "引擎", desc: "Engines" },
  { id: "runs", label: "运行", desc: "Runs" },
  { id: "costs", label: "成本", desc: "Costs" },
  { id: "risk", label: "风控", desc: "Risk" },
];

const ENGINE_META: Record<EngineRecord["engine_type"], { label: string; className: string }> = {
  openclaw: { label: "OpenClaw", className: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  hermes: { label: "Hermes", className: "border-violet-200 bg-violet-50 text-violet-700" },
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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
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

function MetricCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <Panel className="p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{note}</div>
    </Panel>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function EnterpriseConsole({ initialTab = "dashboard" }: { initialTab?: ConsoleTab }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ConsoleTab>(initialTab);
  const [data, setData] = useState<ConsoleData>({ engines: [], runs: [], violations: [], cost: null });
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
    ])
      .then(([engines, runs, violations, cost]) => {
        const nextRuns = Array.isArray(runs.runs) ? runs.runs : [];
        setData({
          engines: Array.isArray(engines.engines) ? engines.engines : [],
          runs: nextRuns,
          violations: Array.isArray(violations.violations) ? violations.violations : [],
          cost,
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:block">
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 px-6 py-6">
              <button onClick={() => navigate("/")} className="text-left">
                <div className="text-sm font-semibold text-slate-950">Evotown Console</div>
                <div className="mt-1 text-xs text-slate-500">Enterprise control plane</div>
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setRoute(item.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition ${
                    tab === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className={`text-xs ${tab === item.id ? "text-slate-300" : "text-slate-400"}`}>{item.desc}</span>
                </button>
              ))}
            </nav>
            <div className="border-t border-slate-200 p-4">
              <button
                onClick={() => navigate("/arena")}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                打开 Arena
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Management Console</div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">企业管理后台</h1>
                <p className="mt-1 text-sm text-slate-500">统一查看外部引擎接入、运行记录、成本和风控事件。Arena 保持独立游戏体验。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => navigate("/arena")}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden"
                >
                  Arena
                </button>
                <button
                  onClick={load}
                  disabled={loading}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {loading ? "刷新中..." : "刷新数据"}
                </button>
              </div>
            </div>
            <nav className="flex gap-2 overflow-x-auto px-5 pb-4 lg:hidden">
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
        <MetricCard label="已接入引擎" value={data.engines.length} note="OpenClaw / Hermes / Custom" />
        <MetricCard label="运行总数" value={summary.total} note={`成功率 ${summary.successRate}%`} />
        <MetricCard label="累计成本" value={`$${(data.cost?.total_cost_usd || 0).toFixed(4)}`} note={`${data.cost?.input_tokens || 0} input tokens`} />
        <MetricCard label="待处理风险" value={summary.risk} note={`${summary.critical} critical`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.1fr_0.9fr]">
        <Panel className="p-5">
          <SectionHeader
            title="引擎概览"
            subtitle="当前已注册的外部运行时"
            action={<button onClick={() => onTab("engines")} className="text-sm font-medium text-slate-600 hover:text-slate-950">查看全部</button>}
          />
          <div className="space-y-3">
            {data.engines.length ? data.engines.slice(0, 4).map((engine) => <EngineCard key={engine.engine_id} engine={engine} runs={data.runs} violations={data.violations} />) : <EmptyState>暂无引擎接入。</EmptyState>}
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionHeader
            title="最近运行"
            subtitle="点击查看对话、工具调用和结构化信号"
            action={<button onClick={() => onTab("runs")} className="text-sm font-medium text-slate-600 hover:text-slate-950">查看全部</button>}
          />
          <RunList runs={data.runs.slice(0, 8)} onRun={onRun} />
        </Panel>

        <Panel className="p-5">
          <SectionHeader
            title="风控事件"
            subtitle="策略命中和阻断动作"
            action={<button onClick={() => onTab("risk")} className="text-sm font-medium text-slate-600 hover:text-slate-950">处理</button>}
          />
          <RiskFeed
            violations={data.violations.slice(0, 5)}
            onRun={(runId) => {
              const run = data.runs.find((item) => item.run_id === runId);
              if (run) onRun(run);
            }}
          />
        </Panel>
      </section>
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

function RunList({ runs, onRun }: { runs: ExternalRun[]; onRun: (run: ExternalRun) => void }) {
  if (!runs.length) return <EmptyState>暂无外部运行记录。</EmptyState>;
  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <button key={run.run_id} onClick={() => onRun(run)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm font-semibold text-slate-950">{run.run_id}</div>
              <div className="mt-1 text-sm text-slate-500">{run.engine_id} · {formatDate(run.finished_at)}</div>
            </div>
            <Badge className={RUN_META[run.status].className}>
              <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${RUN_META[run.status].dot}`} />
              {RUN_META[run.status].label}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>{asNumber(run.signals?.latency_ms) || "-"}ms</span>
            <span>${asNumber(run.signals?.cost_usd).toFixed(4)}</span>
            <span>{run.artifact_manifest?.length ?? 0} artifacts</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Runs({ runs, selectedRun, events, loading, onRun }: { runs: ExternalRun[]; selectedRun: ExternalRun | null; events: RunEvent[]; loading: boolean; onRun: (run: ExternalRun) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
      <Panel className="max-h-[calc(100vh-190px)] overflow-y-auto p-4">
        <SectionHeader title="运行列表" subtitle="外部引擎上报记录" />
        <RunList runs={runs} onRun={onRun} />
      </Panel>
      <RunDetail run={selectedRun} events={events} loading={loading} />
    </div>
  );
}

function RunDetail({ run, events, loading }: { run: ExternalRun | null; events: RunEvent[]; loading: boolean }) {
  if (!run) return <EmptyState>选择一条运行记录查看明细。</EmptyState>;
  const signals = run.signals || {};
  return (
    <Panel className="p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-500">运行详情</div>
          <h2 className="mt-1 truncate font-mono text-xl font-semibold text-slate-950">{run.run_id}</h2>
          <p className="mt-1 text-sm text-slate-500">{run.engine_id} · exit {run.exit_code} · {formatDate(run.finished_at)}</p>
        </div>
        <Badge className={RUN_META[run.status].className}>{RUN_META[run.status].label}</Badge>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <MetricCard label="成本" value={`$${asNumber(signals.cost_usd).toFixed(4)}`} note="cost_usd" />
        <MetricCard label="Token" value={asNumber(signals.input_tokens) + asNumber(signals.output_tokens)} note="input + output" />
        <MetricCard label="耗时" value={asNumber(signals.latency_ms) ? `${asNumber(signals.latency_ms)}ms` : "-"} note="latency_ms" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div>
          <SectionHeader title="结构化信号" subtitle="signals" />
          <pre className="max-h-80 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(signals, null, 2)}</pre>
        </div>
        <div>
          <SectionHeader title="对话与工具时间线" subtitle="events" />
          {loading ? <p className="text-sm text-slate-500">加载事件...</p> : <Timeline events={events} />}
        </div>
      </div>
    </Panel>
  );
}

function Timeline({ events }: { events: RunEvent[] }) {
  if (!events.length) return <EmptyState>暂无 events。上报 user_message / assistant_message / tool_call 后显示。</EmptyState>;
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={`${event.id}-${event.seq}`} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{event.seq}</span>
              <span className="font-mono text-sm font-medium text-slate-950">{event.event_type}</span>
            </div>
            <span className="text-xs text-slate-500">{formatDate(event.ts)}</span>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(event.payload || {}, null, 2)}</pre>
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
        <MetricCard label="总成本" value={`$${(cost?.total_cost_usd || 0).toFixed(4)}`} note="cost_usd" />
        <MetricCard label="运行数" value={cost?.total_runs || 0} note="runs" />
        <MetricCard label="输入 Token" value={cost?.input_tokens || 0} note="input" />
        <MetricCard label="输出 Token" value={cost?.output_tokens || 0} note="output" />
      </section>
      <Panel className="p-5">
        <SectionHeader title="按引擎聚合" subtitle="cost_usd by engine" />
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="engine_id" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a" }} />
              <Bar dataKey="cost_usd" fill="#0f172a" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}

function RiskFeed({ violations, onRun }: { violations: PolicyViolation[]; onRun: (runId: string) => void }) {
  if (!violations.length) return <EmptyState>暂无风控事件。</EmptyState>;
  return (
    <div className="space-y-3">
      {violations.map((item) => (
        <button key={item.violation_id} onClick={() => onRun(item.run_id)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50">
          <div className="mb-2 flex items-center justify-between gap-3">
            <Badge className={RISK_META[item.severity].className}>{RISK_META[item.severity].label}</Badge>
            <span className="text-xs text-slate-500">{formatDate(item.ts)}</span>
          </div>
          <div className="font-mono text-sm font-semibold text-slate-950">{item.policy_id}</div>
          <p className="mt-1 text-sm text-slate-600">{item.message || "No message"}</p>
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
        <MetricCard label="严重" value={counts.critical} note="critical" />
        <MetricCard label="高危" value={counts.high} note="high" />
        <MetricCard label="中危" value={counts.medium} note="medium" />
        <MetricCard label="低危" value={counts.low} note="low" />
      </section>
      <Panel className="p-5">
        <SectionHeader title="风控列表" subtitle="策略命中、阻断动作与资源范围" />
        <RiskFeed violations={violations} onRun={onRun} />
      </Panel>
    </div>
  );
}
