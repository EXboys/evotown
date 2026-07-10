import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import { evotownEvents } from "../phaser/events";
import type { FleetEngine } from "./DispatchPanel";

type Agent = {
  agent_id: string;
  name: string;
  status: "active" | "archived";
};

type TaskNode = {
  node_id: string;
  agent_id: string;
  source_type: "dispatch_job" | "hosted_run";
  source_id: string;
  title: string;
  message: string;
  board_status: "queued" | "running" | "done" | "failed";
  source_status: string;
  depends_on_node_id?: string;
  run_id?: string;
  dispatch_job_id?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
};

type BoardColumns = Record<TaskNode["board_status"], TaskNode[]>;

type BoardResponse = {
  agent_id: string;
  columns: BoardColumns;
  total: number;
  board_statuses: TaskNode["board_status"][];
};

type ModelOption = { id: string; label: string; provider?: string };

type Props = {
  engines?: FleetEngine[];
  onRefresh?: () => void;
};

const COLUMN_META: Record<
  TaskNode["board_status"],
  { label: string; hint: string; headerClass: string; countClass: string }
> = {
  queued: {
    label: "排队中",
    hint: "Queued",
    headerClass: "border-amber-200 bg-amber-50 text-amber-900",
    countClass: "bg-amber-100 text-amber-800",
  },
  running: {
    label: "执行中",
    hint: "Running",
    headerClass: "border-blue-200 bg-blue-50 text-blue-900",
    countClass: "bg-blue-100 text-blue-800",
  },
  done: {
    label: "已完成",
    hint: "Done",
    headerClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
    countClass: "bg-emerald-100 text-emerald-800",
  },
  failed: {
    label: "失败",
    hint: "Failed",
    headerClass: "border-red-200 bg-red-50 text-red-900",
    countClass: "bg-red-100 text-red-800",
  },
};

const SOURCE_LABEL: Record<TaskNode["source_type"], string> = {
  dispatch_job: "派活",
  hosted_run: "托管运行",
};

function isHostedEngine(engineId: string) {
  return engineId.startsWith("hosted-ws-");
}

function TaskCard({ node }: { node: TaskNode }) {
  const title = node.title?.trim() || node.message.slice(0, 80) || node.source_id;
  const subtitle = node.title?.trim() ? node.message.slice(0, 120) : "";
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{title}</div>
          {subtitle && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
          {SOURCE_LABEL[node.source_type]}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="font-mono">{node.source_id.slice(0, 14)}…</span>
        {node.run_id && node.agent_id && (
          <Link to={`/agent/agents/${node.agent_id}`} className="text-blue-600 hover:underline">
            run
          </Link>
        )}
        {node.depends_on_node_id && <span>依赖上一节点</span>}
      </div>
      {node.created_at && (
        <div className="mt-2 text-[11px] text-slate-400">{formatDateTimeShort(node.created_at)}</div>
      )}
    </article>
  );
}

export function TaskBoardPanel({ engines: enginesProp = [], onRefresh }: Props) {
  const [engines, setEngines] = useState<FleetEngine[]>(enginesProp);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [teamPairs, setTeamPairs] = useState("*");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [form, setForm] = useState({
    kind: "dispatch" as "dispatch" | "handoff" | "notify",
    target_engine_id: "",
    target_team_id: "",
    title: "",
    message: "",
    model: "",
    chain: false,
    chain_team: "",
    chain_message: "",
  });

  useEffect(() => {
    setEngines(enginesProp);
  }, [enginesProp]);

  const loadEngines = useCallback(async () => {
    if (enginesProp.length) return;
    const res = await adminFetch("/api/v1/engines/fleet");
    if (!res.ok) return;
    const data = (await res.json()) as { engines?: FleetEngine[] };
    setEngines(data.engines || []);
  }, [enginesProp.length]);

  const loadAgents = useCallback(async () => {
    const res = await adminFetch("/api/v1/agents?limit=200");
    if (!res.ok) return;
    const data = (await res.json()) as { agents?: Agent[] };
    const active = (data.agents || []).filter((a) => a.status === "active");
    setAgents(active);
  }, []);

  const loadBoard = useCallback(async (selectedAgentId: string, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    const query = selectedAgentId ? `?agent_id=${encodeURIComponent(selectedAgentId)}` : "";
    const res = await adminFetch(`/api/v1/task-board${query}`);
    if (!res.ok) {
      setError(`加载看板失败 (${res.status})`);
      setBoard(null);
      setLoading(false);
      return;
    }
    setBoard((await res.json()) as BoardResponse);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAgents();
    void loadEngines();
  }, [loadAgents, loadEngines]);

  useEffect(() => {
    void loadBoard(agentId);
  }, [agentId, loadBoard]);

  useEffect(() => {
    adminFetch("/api/v1/dispatch/policy")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { team_pairs?: string }) => setTeamPairs(data.team_pairs || "*"))
      .catch(() => setTeamPairs("*"));
  }, []);

  useEffect(() => {
    adminFetch("/api/v1/agent/options")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { models?: ModelOption[]; default_model?: string }) => {
        const list = data.models || [];
        setModels(list);
        const fallback = data.default_model || list[0]?.id || "";
        setForm((f) => ({ ...f, model: f.model || fallback }));
      })
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (engines.length === 0) return;
    setForm((f) => {
      if (f.target_engine_id && engines.some((e) => e.engine_id === f.target_engine_id)) return f;
      const preferred = engines.find((e) => e.online) || engines[0];
      return preferred ? { ...f, target_engine_id: preferred.engine_id } : f;
    });
  }, [engines]);

  useEffect(() => {
    const onUpdate = () => {
      void loadBoard(agentId, true);
    };
    evotownEvents.on("dispatch_job_updated", onUpdate);
    return () => evotownEvents.off("dispatch_job_updated", onUpdate);
  }, [agentId, loadBoard]);

  const columns = useMemo(() => {
    const empty: BoardColumns = { queued: [], running: [], done: [], failed: [] };
    return board?.columns ?? empty;
  }, [board]);

  const isHostedTarget = isHostedEngine(form.target_engine_id);

  const savePolicy = async () => {
    setPolicyLoading(true);
    setMessage(null);
    const r = await adminFetch("/api/v1/dispatch/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_pairs: teamPairs }),
    });
    setPolicyLoading(false);
    if (!r.ok) {
      setMessage({ tone: "err", text: `策略保存失败: ${(await r.text()).slice(0, 120)}` });
      return;
    }
    setMessage({ tone: "ok", text: "Handoff 策略已保存" });
  };

  const submit = async () => {
    setMessage(null);
    if (!form.message.trim()) {
      setMessage({ tone: "err", text: "请填写任务内容" });
      return;
    }
    if (!form.target_engine_id && !form.target_team_id) {
      setMessage({ tone: "err", text: "请指定目标引擎或目标团队" });
      return;
    }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      kind: form.kind,
      target_engine_id: form.target_engine_id || undefined,
      target_team_id: form.target_team_id || undefined,
      title: form.title,
      message: form.message,
    };
    const payload: Record<string, unknown> = {};
    if (form.model.trim()) payload.model = form.model.trim();
    if (form.chain && form.chain_team && form.chain_message.trim()) {
      payload.on_success_handoff = {
        kind: "handoff",
        target_team_id: form.chain_team,
        title: "接续任务",
        message: form.chain_message,
      };
    }
    if (Object.keys(payload).length) body.payload = payload;

    try {
      const r = await adminFetch("/api/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setMessage({ tone: "err", text: `派发失败: ${(await r.text()).slice(0, 200)}` });
        return;
      }
      setMessage({
        tone: "ok",
        text: form.chain ? "已入队，成功后自动 handoff 到下一团队" : "任务已入队，看板将刷新",
      });
      setForm((f) => ({ ...f, message: "", title: "", chain_message: "" }));
      await loadBoard(agentId, true);
      onRefresh?.();
    } finally {
      setSubmitting(false);
    }
  };

  const rotateIngestToken = async (engineId: string) => {
    if (!window.confirm(`轮换引擎 ${engineId} 的 evi_ token？旧 token 将立即失效。`)) return;
    setMessage(null);
    const r = await adminFetch(`/api/v1/engines/${encodeURIComponent(engineId)}/rotate-ingest-token`, {
      method: "POST",
    });
    if (!r.ok) {
      setMessage({ tone: "err", text: `轮换失败: ${(await r.text()).slice(0, 120)}` });
      return;
    }
    const data = (await r.json()) as { ingest_token?: string };
    setMessage({
      tone: "ok",
      text: data.ingest_token
        ? `已轮换 ${engineId}，新 token 前缀 ${data.ingest_token.slice(0, 12)}…（仅显示一次）`
        : `已轮换 ${engineId}`,
    });
    onRefresh?.();
    void loadEngines();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Task Board</div>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">任务看板</h2>
          <p className="mt-1 text-sm text-slate-500">派活与状态流转合一：创建任务后直接在看板中跟踪。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">全部 agent</option>
            {agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadBoard(agentId)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            刷新
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {message.text}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">目标引擎</div>
          {engines.length === 0 ? (
            <div className="py-1 text-xs text-slate-500">暂无 Fleet 引擎</div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
              {engines.map((e) => {
                const hosted = isHostedEngine(e.engine_id);
                const active = form.target_engine_id === e.engine_id;
                return (
                  <button
                    key={e.engine_id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, target_engine_id: e.engine_id, target_team_id: "" }))}
                    className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
                      active
                        ? "border-slate-900 bg-slate-950 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${e.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <span className="max-w-[140px] truncate text-xs font-medium">{e.display_name || e.engine_id}</span>
                    <span className={`rounded px-1 py-0.5 text-[9px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {hosted ? "托管" : "conn"}
                    </span>
                    {!hosted && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="轮换 evi_ token"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void rotateIngestToken(e.engine_id);
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.stopPropagation();
                            void rotateIngestToken(e.engine_id);
                          }
                        }}
                        className={`text-[10px] hover:underline ${active ? "text-white/80" : "text-slate-600"}`}
                      >
                        ↻
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{isHostedTarget ? "托管工作区" : "Connector"}</span>
            <span className="text-slate-300">·</span>
            <span className="truncate font-mono text-[11px]">{form.target_engine_id || "未选引擎"}</span>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <label className="min-w-0 flex-1 text-sm">
              <span className="sr-only">任务内容</span>
              <textarea
                className="min-h-[72px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-100"
                placeholder="描述 Agent 需要完成的工作…"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
                }}
              />
            </label>

            <div className="flex shrink-0 flex-col gap-2 lg:w-44">
              {isHostedTarget && (
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  aria-label="模型"
                >
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {submitting ? "提交中…" : "派发"}
              </button>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                {showAdvanced ? "收起选项" : "更多选项"}
              </button>
            </div>
          </div>

          {showAdvanced && (
            <div className="grid gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs sm:col-span-2 lg:col-span-1">
                <span className="mb-1 block font-medium text-slate-600">任务类型</span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
                >
                  <option value="dispatch">dispatch — 中心派活</option>
                  <option value="handoff">handoff — 团队交接</option>
                  <option value="notify">notify — 通知</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-600">标题（可选）</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-600">目标团队（可选）</span>
                <input
                  placeholder="owner_team"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  value={form.target_team_id}
                  onChange={(e) => setForm({ ...form, target_team_id: e.target.value })}
                />
              </label>
              <label className="block text-xs sm:col-span-2 lg:col-span-1">
                <span className="mb-1 block font-medium text-slate-600">手动 engine_id</span>
                <input
                  list="taskboard-engine-ids"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs"
                  value={form.target_engine_id}
                  onChange={(e) => setForm({ ...form, target_engine_id: e.target.value })}
                />
                <datalist id="taskboard-engine-ids">
                  {engines.map((e) => (
                    <option key={e.engine_id} value={e.engine_id} />
                  ))}
                </datalist>
              </label>
              <div className="space-y-2 sm:col-span-2 lg:col-span-4">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.chain}
                    onChange={(e) => setForm({ ...form, chain: e.target.checked })}
                  />
                  成功后自动 handoff 到下一团队
                </label>
                {form.chain && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                      placeholder="下一团队"
                      value={form.chain_team}
                      onChange={(e) => setForm({ ...form, chain_team: e.target.value })}
                    />
                    <input
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                      placeholder="接续内容"
                      value={form.chain_message}
                      onChange={(e) => setForm({ ...form, chain_message: e.target.value })}
                    />
                  </div>
                )}
              </div>
              <details className="text-xs sm:col-span-2 lg:col-span-4">
                <summary className="cursor-pointer font-medium text-slate-600">Handoff 白名单</summary>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <textarea
                    className="min-w-[200px] flex-1 rounded border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
                    rows={1}
                    value={teamPairs}
                    onChange={(e) => setTeamPairs(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={policyLoading}
                    onClick={() => void savePolicy()}
                    className="rounded border border-slate-200 px-2 py-1 hover:bg-white disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
          加载中…
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-500">共 {board?.total ?? 0} 个节点</div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(COLUMN_META) as TaskNode["board_status"][]).map((status) => {
              const meta = COLUMN_META[status];
              const items = columns[status] || [];
              return (
                <section key={status} className="flex min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-slate-50/70">
                  <header className={`flex items-center justify-between border-b px-4 py-3 ${meta.headerClass}`}>
                    <div>
                      <div className="text-sm font-semibold">{meta.label}</div>
                      <div className="text-xs opacity-70">{meta.hint}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.countClass}`}>
                      {items.length}
                    </span>
                  </header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 p-6 text-center text-xs text-slate-400">
                        暂无任务
                      </div>
                    ) : (
                      items.map((node) => <TaskCard key={node.node_id} node={node} />)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
