import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import type { Locale } from "../lib/i18n";

type AccountSummary = {
  account_id: string;
  account_name: string;
  org_id: string;
  org_name: string;
  run_count: number;
  mcp_calls: number;
  gateway_requests: number;
  total_tokens: number;
  cost_usd: number;
};

type AgentRunRow = {
  run_id: string;
  agent_id: string;
  status: string;
  prompt: string;
  created_at: string;
  mcp_calls: number;
};

type TimelineEvent = {
  kind: "run" | "mcp" | "gateway";
  ts: string;
  account_id?: string;
  run_id?: string;
  agent_id?: string;
  status?: string;
  prompt?: string;
  service_id?: string;
  args?: string;
  request_id?: string;
  model?: string;
  status_code?: number;
  total_tokens?: number;
};

type RunDetail = {
  run_id: string;
  agent_id: string;
  status: string;
  prompt: string;
  model: string;
  created_at: string;
  result_summary: string;
  error: string;
};

type McpCallRow = {
  id: number;
  service_id: string;
  args: string;
  status: string;
  result: string;
  called_at: string;
};

const COPY = {
  zh: {
    title: "员工 Agent 追溯",
    subtitle: "合并 Runs、MCP 审计与网关用量，按员工归纳查询。",
    from: "开始",
    to: "结束",
    refresh: "刷新",
    exportCsv: "导出 CSV",
    loading: "加载中…",
    loadFailed: "加载失败",
    summaryTab: "按员工",
    timelineTab: "时间线",
    columns: {
      account: "员工",
      org: "部门",
      runs: "Runs",
      mcp: "MCP 调用",
      gateway: "网关请求",
      tokens: "Token",
      cost: "成本 (USD)",
    },
    runsFor: "Run 列表",
    noData: "所选时间范围内暂无数据",
    selectAccount: "点击员工查看 Run 列表",
    runDetail: "Run 详情",
    mcpCalls: "MCP 调用",
    close: "关闭",
    kinds: { run: "Run", mcp: "MCP", gateway: "Gateway" },
  },
  en: {
    title: "Agent Activity Audit",
    subtitle: "Merged runs, MCP audit, and gateway usage by employee.",
    from: "From",
    to: "To",
    refresh: "Refresh",
    exportCsv: "Export CSV",
    loading: "Loading…",
    loadFailed: "Load failed",
    summaryTab: "By employee",
    timelineTab: "Timeline",
    columns: {
      account: "Employee",
      org: "Org",
      runs: "Runs",
      mcp: "MCP calls",
      gateway: "Gateway",
      tokens: "Tokens",
      cost: "Cost (USD)",
    },
    runsFor: "Runs",
    noData: "No activity in the selected range",
    selectAccount: "Select an employee to view runs",
    runDetail: "Run detail",
    mcpCalls: "MCP calls",
    close: "Close",
    kinds: { run: "Run", mcp: "MCP", gateway: "Gateway" },
  },
} as const;

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function toIsoStart(date: string): string {
  return `${date}T00:00:00`;
}

function toIsoEnd(date: string): string {
  return `${date}T23:59:59`;
}

function buildCsv(rows: AccountSummary[]): string {
  const header = ["account_id", "account_name", "org_name", "run_count", "mcp_calls", "gateway_requests", "total_tokens", "cost_usd"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.account_id,
        `"${(row.account_name || "").replace(/"/g, '""')}"`,
        `"${(row.org_name || "").replace(/"/g, '""')}"`,
        row.run_count,
        row.mcp_calls,
        row.gateway_requests,
        row.total_tokens,
        row.cost_usd.toFixed(4),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function AgentActivityPanel({ locale = "zh" }: { locale?: Locale }) {
  const copy = COPY[locale];
  const initialRange = useMemo(() => defaultRange(), []);
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [view, setView] = useState<"summary" | "timeline">("summary");
  const [summary, setSummary] = useState<AccountSummary[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [mcpCalls, setMcpCalls] = useState<McpCallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(
    () => `from_ts=${encodeURIComponent(toIsoStart(fromDate))}&to_ts=${encodeURIComponent(toIsoEnd(toDate))}`,
    [fromDate, toDate],
  );

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/audit/agent-activity?${query}&limit=200`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { summary?: AccountSummary[] };
      setSummary(Array.isArray(data.summary) ? data.summary : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadFailed);
      setSummary([]);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed, query]);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const accountPart = selectedAccount ? `&account_id=${encodeURIComponent(selectedAccount.account_id)}` : "";
      const res = await adminFetch(`/api/v1/audit/agent-activity/timeline?${query}${accountPart}&limit=200`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { events?: TimelineEvent[] };
      setTimeline(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadFailed);
      setTimeline([]);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed, query, selectedAccount]);

  const loadRuns = useCallback(
    async (account: AccountSummary) => {
      setRunsLoading(true);
      setSelectedRun(null);
      setMcpCalls([]);
      try {
        const res = await adminFetch(
          `/api/v1/audit/agent-activity/runs?account_id=${encodeURIComponent(account.account_id)}&${query}&limit=100`,
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { runs?: AgentRunRow[] };
        setRuns(Array.isArray(data.runs) ? data.runs : []);
      } catch {
        setRuns([]);
      } finally {
        setRunsLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    if (view === "summary") {
      void loadSummary();
    } else {
      void loadTimeline();
    }
  }, [view, loadSummary, loadTimeline]);

  const openAccount = (account: AccountSummary) => {
    setSelectedAccount(account);
    void loadRuns(account);
  };

  const openRunDetail = async (runId: string) => {
    setDetailLoading(true);
    setSelectedRun(null);
    setMcpCalls([]);
    try {
      const [runRes, mcpRes] = await Promise.all([
        adminFetch(`/api/v1/agent-runs/${encodeURIComponent(runId)}`),
        adminFetch(`/api/v1/audit/agent-activity/mcp?run_id=${encodeURIComponent(runId)}`),
      ]);
      if (runRes.ok) {
        const data = (await runRes.json()) as { run?: RunDetail };
        setSelectedRun(data.run ?? null);
      }
      if (mcpRes.ok) {
        const data = (await mcpRes.json()) as { calls?: McpCallRow[] };
        setMcpCalls(Array.isArray(data.calls) ? data.calls : []);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob([buildCsv(summary)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agent-activity-${fromDate}-${toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">{copy.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm text-slate-600">
          {copy.from}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 block rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-slate-600">
          {copy.to}
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 block rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => (view === "summary" ? void loadSummary() : void loadTimeline())}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {copy.refresh}
        </button>
        {view === "summary" && summary.length > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {copy.exportCsv}
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {(["summary", "timeline"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setView(tab)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
              view === tab ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab === "summary" ? copy.summaryTab : copy.timelineTab}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">{copy.loading}</div>
      ) : view === "summary" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{copy.columns.account}</th>
                  <th className="px-4 py-3">{copy.columns.org}</th>
                  <th className="px-4 py-3">{copy.columns.runs}</th>
                  <th className="px-4 py-3">{copy.columns.mcp}</th>
                  <th className="px-4 py-3">{copy.columns.gateway}</th>
                  <th className="px-4 py-3">{copy.columns.tokens}</th>
                  <th className="px-4 py-3">{copy.columns.cost}</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      {copy.noData}
                    </td>
                  </tr>
                ) : (
                  summary.map((row) => (
                    <tr
                      key={row.account_id}
                      onClick={() => openAccount(row)}
                      className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${
                        selectedAccount?.account_id === row.account_id ? "bg-sky-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{row.account_name}</td>
                      <td className="px-4 py-3 text-slate-600">{row.org_name || "—"}</td>
                      <td className="px-4 py-3">{row.run_count}</td>
                      <td className="px-4 py-3">{row.mcp_calls}</td>
                      <td className="px-4 py-3">{row.gateway_requests}</td>
                      <td className="px-4 py-3">{row.total_tokens}</td>
                      <td className="px-4 py-3">{row.cost_usd.toFixed(4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            {!selectedAccount ? (
              <p className="text-sm text-slate-500">{copy.selectAccount}</p>
            ) : runsLoading ? (
              <p className="text-sm text-slate-500">{copy.loading}</p>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-slate-900">
                  {copy.runsFor}: {selectedAccount.account_name}
                </h3>
                <div className="mt-3 max-h-[480px] space-y-2 overflow-y-auto">
                  {runs.length === 0 ? (
                    <p className="text-sm text-slate-500">{copy.noData}</p>
                  ) : (
                    runs.map((run) => (
                      <button
                        key={run.run_id}
                        type="button"
                        onClick={() => void openRunDetail(run.run_id)}
                        className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-sky-300 hover:bg-sky-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-mono text-slate-500">{run.run_id}</span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{run.status}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-800">{run.prompt}</p>
                        <div className="mt-1 flex gap-3 text-xs text-slate-500">
                          <span>{formatDateTimeShort(run.created_at)}</span>
                          <span>MCP {run.mcp_calls}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="divide-y divide-slate-100">
            {timeline.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">{copy.noData}</p>
            ) : (
              timeline.map((event, index) => (
                <div key={`${event.kind}-${event.ts}-${index}`} className="flex gap-3 px-4 py-3 text-sm">
                  <span className="w-16 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-xs font-medium text-slate-600">
                    {copy.kinds[event.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-500">{formatDateTimeShort(event.ts)}</div>
                    {event.kind === "run" && (
                      <button
                        type="button"
                        onClick={() => event.run_id && void openRunDetail(event.run_id)}
                        className="mt-1 text-left text-slate-900 hover:text-sky-700"
                      >
                        {event.prompt || event.run_id}
                      </button>
                    )}
                    {event.kind === "mcp" && (
                      <p className="mt-1 text-slate-800">
                        {event.service_id} · {event.args || event.run_id}
                      </p>
                    )}
                    {event.kind === "gateway" && (
                      <p className="mt-1 text-slate-800">
                        {event.model || "gateway"} · {event.total_tokens ?? 0} tokens
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {(selectedRun || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-semibold text-slate-950">{copy.runDetail}</h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedRun(null);
                  setMcpCalls([]);
                }}
                className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                {copy.close}
              </button>
            </div>
            {detailLoading ? (
              <p className="mt-4 text-sm text-slate-500">{copy.loading}</p>
            ) : selectedRun ? (
              <div className="mt-4 space-y-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><span className="text-slate-500">run_id</span><div className="font-mono text-xs">{selectedRun.run_id}</div></div>
                  <div><span className="text-slate-500">status</span><div>{selectedRun.status}</div></div>
                  <div><span className="text-slate-500">agent</span><div className="font-mono text-xs">{selectedRun.agent_id}</div></div>
                  <div><span className="text-slate-500">model</span><div>{selectedRun.model || "—"}</div></div>
                </div>
                <div>
                  <div className="text-slate-500">prompt</div>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{selectedRun.prompt}</p>
                </div>
                {selectedRun.result_summary && (
                  <div>
                    <div className="text-slate-500">result</div>
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">{selectedRun.result_summary}</p>
                  </div>
                )}
                {selectedRun.error && (
                  <div>
                    <div className="text-slate-500">error</div>
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-red-700">{selectedRun.error}</p>
                  </div>
                )}
                <div>
                  <div className="mb-2 font-medium text-slate-900">{copy.mcpCalls} ({mcpCalls.length})</div>
                  {mcpCalls.length === 0 ? (
                    <p className="text-slate-500">—</p>
                  ) : (
                    <div className="space-y-2">
                      {mcpCalls.map((call) => (
                        <div key={call.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex justify-between gap-2 text-xs text-slate-500">
                            <span>{call.service_id}</span>
                            <span>{formatDateTimeShort(call.called_at)}</span>
                          </div>
                          <p className="mt-1 text-slate-800">{call.args}</p>
                          <p className="mt-1 text-xs text-slate-500">{call.status} · {call.result}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
