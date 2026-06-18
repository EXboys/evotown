import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import { evotownEvents, type EvotownEventMap } from "../phaser/events";

export type FleetEngine = {
  engine_id: string;
  engine_type: string;
  engine_version: string;
  display_name?: string;
  owner_team?: string;
  deployment_kind?: string;
  online?: boolean;
  last_seen_at?: string;
  connector_version?: string;
  ingest_token_prefix?: string;
};

function toDispatchJob(raw: EvotownEventMap["dispatch_job_updated"]["job"]): DispatchJob {
  return {
    job_id: raw.job_id,
    status: raw.status,
    kind: raw.kind ?? "dispatch",
    message: raw.message ?? "",
    title: raw.title,
    source_engine_id: raw.source_engine_id as string | undefined,
    target_engine_id: raw.target_engine_id as string | undefined,
    target_team_id: raw.target_team_id as string | undefined,
    result_summary: raw.result_summary as string | undefined,
    log_excerpt: raw.log_excerpt as string | undefined,
    run_id: raw.run_id as string | undefined,
    created_at: raw.created_at as string | undefined,
    completed_at: raw.completed_at as string | undefined,
    payload: raw.payload as DispatchJob["payload"],
    refs: raw.refs as DispatchJob["refs"],
  };
}

function mergeJob(list: DispatchJob[], incoming: DispatchJob): DispatchJob[] {
  const idx = list.findIndex((j) => j.job_id === incoming.job_id);
  if (idx < 0) return [incoming, ...list].slice(0, 80);
  const next = [...list];
  next[idx] = { ...next[idx], ...incoming };
  return next;
}

export type DispatchJob = {
  job_id: string;
  kind: string;
  status: string;
  source_engine_id?: string;
  target_engine_id?: string;
  target_team_id?: string;
  title?: string;
  message: string;
  run_id?: string;
  created_at?: string;
  completed_at?: string;
  result_summary?: string;
  log_excerpt?: string;
  refs?: { parent_job_id?: string };
  payload?: { model?: string; on_success_handoff?: Record<string, unknown> };
};

type ModelOption = { id: string; label: string; provider?: string };

type Props = {
  engines: FleetEngine[];
  onRefresh: () => void;
};

const STATUS_META: Record<string, { label: string; className: string; dot: string }> = {
  queued: { label: "排队中", className: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  leased: { label: "已领取", className: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
  running: { label: "执行中", className: "border-blue-200 bg-blue-50 text-blue-800", dot: "bg-blue-500 animate-pulse" },
  completed: { label: "已完成", className: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-800", dot: "bg-red-500" },
  cancelled: { label: "已取消", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
};

const KIND_LABEL: Record<string, string> = {
  dispatch: "中心派活",
  handoff: "团队交接",
  notify: "通知",
};

function isHostedEngine(engineId: string) {
  return engineId.startsWith("hosted-ws-");
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || {
    label: status,
    className: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function FleetChipStrip({
  engines,
  selectedId,
  onPick,
  onRotate,
}: {
  engines: FleetEngine[];
  selectedId: string;
  onPick: (engineId: string) => void;
  onRotate: (engineId: string) => void;
}) {
  if (engines.length === 0) {
    return (
      <div className="shrink-0 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">暂无 Fleet 引擎</div>
    );
  }

  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">目标引擎</div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
        {engines.map((e) => {
          const hosted = isHostedEngine(e.engine_id);
          const active = selectedId === e.engine_id;
          return (
            <button
              key={e.engine_id}
              type="button"
              onClick={() => onPick(e.engine_id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
                active
                  ? "border-indigo-400 bg-indigo-50 text-indigo-950 shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${e.online ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className="max-w-[140px] truncate text-xs font-medium">{e.display_name || e.engine_id}</span>
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500">
                {hosted ? "托管" : "conn"}
              </span>
              {!hosted && (
                <span
                  role="button"
                  tabIndex={0}
                  title="轮换 evi_ token"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onRotate(e.engine_id);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.stopPropagation();
                      onRotate(e.engine_id);
                    }
                  }}
                  className="text-[10px] text-indigo-600 hover:underline"
                >
                  ↻
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DispatchPanel({ engines, onRefresh }: Props) {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<DispatchJob | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"content" | "result" | "log">("content");
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

  const loadJobs = useCallback(() => {
    setLoading(true);
    const q = statusFilter ? `?limit=80&status_filter=${encodeURIComponent(statusFilter)}` : "?limit=80";
    adminFetch(`/api/v1/jobs${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { jobs?: DispatchJob[] }) => setJobs(data.jobs || []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, 60000);
    return () => clearInterval(t);
  }, [loadJobs]);

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
    const onUpdate = (data: EvotownEventMap["dispatch_job_updated"]) => {
      const job = toDispatchJob(data.job);
      setJobs((prev) => mergeJob(prev, job));
      setSelected((cur) => (cur?.job_id === job.job_id ? { ...cur, ...job } : cur));
    };
    evotownEvents.on("dispatch_job_updated", onUpdate);
    return () => evotownEvents.off("dispatch_job_updated", onUpdate);
  }, []);

  const fetchJobDetail = useCallback(async (job: DispatchJob) => {
    setSelected(job);
    setDetailLoading(true);
    try {
      const r = await adminFetch(`/api/v1/jobs/${encodeURIComponent(job.job_id)}`);
      if (r.ok) {
        const data = (await r.json()) as { job?: DispatchJob };
        if (data.job) {
          setSelected(data.job);
          setJobs((prev) => mergeJob(prev, data.job!));
          if (data.job.status === "failed" && data.job.log_excerpt?.trim()) {
            setDetailTab("log");
          } else if (data.job.status === "completed" && data.job.result_summary?.trim()) {
            setDetailTab("result");
          } else {
            setDetailTab("content");
          }
        }
      } else {
        setDetailTab("content");
      }
    } catch {
      setDetailTab("content");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !jobs.some((j) => j.job_id === selected.job_id)) {
      void fetchJobDetail(jobs[0]);
    }
  }, [jobs, selected, fetchJobDetail]);

  const stats = useMemo(() => {
    const online = engines.filter((e) => e.online).length;
    const active = jobs.filter((j) => ["queued", "leased", "running"].includes(j.status)).length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    return { online, totalEngines: engines.length, active, failed, totalJobs: jobs.length };
  }, [engines, jobs]);

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
      const data = (await r.json()) as { job?: DispatchJob };
      setMessage({
        tone: "ok",
        text: form.chain ? "已入队，成功后自动 handoff 到下一团队" : "任务已入队",
      });
      setForm((f) => ({ ...f, message: "", title: "", chain_message: "" }));
      loadJobs();
      onRefresh();
      if (data.job) {
        setJobs((prev) => mergeJob(prev, data.job!));
        void fetchJobDetail(data.job);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    const r = await adminFetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    if (r.ok) {
      loadJobs();
      setSelected((cur) => (cur?.job_id === jobId ? null : cur));
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
        ? `已轮换 ${engineId}，新 token 前缀 ${data.ingest_token.slice(0, 12)}…（仅显示一次，请写入员工机）`
        : `已轮换 ${engineId}`,
    });
    onRefresh();
  };

  const pickEngine = (engineId: string) => {
    setForm((f) => ({ ...f, target_engine_id: engineId, target_team_id: "" }));
  };

  return (
    <div className="-mx-1 flex min-h-[calc(100vh-12rem)] flex-col gap-4">
      {/* Page header */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">派活中心</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            选引擎、写任务、派发 — 结果在下方操作台实时查看
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span>
            引擎 <strong className="text-slate-900">{stats.online}</strong>/{stats.totalEngines}
          </span>
          <span>
            进行中 <strong className="text-blue-700">{stats.active}</strong>
          </span>
          {stats.failed > 0 && (
            <span>
              失败 <strong className="text-red-700">{stats.failed}</strong>
            </span>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Compose strip — full width */}
      <section className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <FleetChipStrip
          engines={engines}
          selectedId={form.target_engine_id}
          onPick={pickEngine}
          onRotate={rotateIngestToken}
        />

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">
              {isHostedTarget ? "托管工作区" : "Connector"}
            </span>
            <span className="text-slate-300">·</span>
            <span className="truncate font-mono text-[11px]">{form.target_engine_id || "未选引擎"}</span>
            {form.target_team_id && (
              <>
                <span className="text-slate-300">·</span>
                <span>团队 {form.target_team_id}</span>
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <label className="min-w-0 flex-1 text-sm">
              <span className="sr-only">任务内容</span>
              <textarea
                className="min-h-[72px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
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
                onClick={submit}
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
                  list="engine-ids"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs"
                  value={form.target_engine_id}
                  onChange={(e) => setForm({ ...form, target_engine_id: e.target.value })}
                />
                <datalist id="engine-ids">
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
                    onClick={savePolicy}
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

      {/* Operations console — master / detail */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
          <p className="text-sm text-slate-600">
            任务队列
            <span className="ml-1.5 tabular-nums text-slate-900">{stats.totalJobs}</span>
            {loading && <span className="ml-2 text-xs text-slate-400">刷新中…</span>}
          </p>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                loadJobs();
                onRefresh();
              }}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              刷新
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-b border-slate-100 lg:border-b-0 lg:border-r">
            {jobs.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <p className="text-sm font-medium text-slate-600">暂无任务</p>
                <p className="mt-1 text-xs text-slate-400">在上方填写内容并点击派发</p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
                {jobs.map((j) => {
                  const active = selected?.job_id === j.job_id;
                  return (
                    <li key={j.job_id}>
                      <button
                        type="button"
                        onClick={() => void fetchJobDetail(j)}
                        className={`w-full px-4 py-3 text-left transition ${
                          active
                            ? "border-l-2 border-l-indigo-500 bg-indigo-50 pl-[14px]"
                            : "border-l-2 border-l-transparent hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <StatusBadge status={j.status} />
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {j.created_at ? formatDateTimeShort(j.created_at) : ""}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-snug text-slate-800">
                          {j.title || j.message}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{j.job_id}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <JobDetailWorkspace
            job={selected}
            loading={detailLoading}
            tab={detailTab}
            onTabChange={setDetailTab}
            onCancel={cancelJob}
            onRefresh={() => selected && void fetchJobDetail(selected)}
          />
        </div>
      </section>
    </div>
  );
}

function hostedWorkspacePath(engineId: string | undefined): string | null {
  if (!engineId?.startsWith("hosted-ws-")) return null;
  return `/agent/agents/${engineId.slice("hosted-ws-".length)}`;
}

type DetailTab = "content" | "result" | "log";

function JobDetailWorkspace({
  job,
  loading,
  tab,
  onTabChange,
  onCancel,
  onRefresh,
}: {
  job: DispatchJob | null;
  loading: boolean;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onCancel: (jobId: string) => void;
  onRefresh: () => void;
}) {
  if (!job) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-slate-50/40 p-8 text-center">
        <p className="text-sm font-medium text-slate-600">选择任务查看明细</p>
        <p className="mt-1 max-w-xs text-xs text-slate-400">派发后任务出现在上方列表，内容与日志在此展示</p>
      </div>
    );
  }

  const workspacePath = hostedWorkspacePath(job.target_engine_id);
  const canCancel = ["queued", "leased", "running"].includes(job.status);
  const hasResult = Boolean(job.result_summary?.trim());
  const hasLog = Boolean(job.log_excerpt?.trim());

  const tabs: { id: DetailTab; label: string; hint?: string }[] = [
    { id: "content", label: "任务明细" },
    { id: "result", label: "执行结果", hint: hasResult ? undefined : "暂无" },
    { id: "log", label: "运行日志", hint: hasLog ? undefined : "暂无" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50/30">
      {/* Compact header */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={job.status} />
              {loading && <span className="text-[10px] text-slate-400">同步中…</span>}
            </div>
            <h3 className="mt-1.5 truncate text-base font-semibold text-slate-950">{job.title || job.message.slice(0, 48)}</h3>
            <p className="mt-0.5 truncate text-[10px] font-mono text-slate-400">{job.job_id}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              刷新
            </button>
            {workspacePath && (
              <Link
                to={workspacePath}
                className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-800 hover:bg-indigo-100"
              >
                工作区
              </Link>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => onCancel(job.job_id)}
                className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
              >
                取消
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 truncate text-[11px] text-slate-500">
          {KIND_LABEL[job.kind] || job.kind} → {job.target_engine_id || `team:${job.target_team_id}`}
          {job.payload?.model ? ` · ${job.payload.model}` : ""}
          {job.created_at ? ` · ${formatDateTimeShort(job.created_at)}` : ""}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-0.5 border-b border-slate-200 bg-white px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.hint && <span className="ml-1 text-xs font-normal text-slate-400">({t.hint})</span>}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "content" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                派活内容
              </div>
              <div className="px-4 py-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{job.message}</p>
              </div>
            </div>
            {job.title && job.title !== job.message.slice(0, job.title.length) && (
              <p className="text-xs text-slate-500">
                标题：<span className="text-slate-700">{job.title}</span>
              </p>
            )}
            {job.refs?.parent_job_id && (
              <p className="text-xs text-slate-500">
                父任务 <span className="font-mono">{job.refs.parent_job_id}</span>
              </p>
            )}
            {job.run_id && (
              <p className="text-xs text-slate-500">
                Run <span className="font-mono">{job.run_id}</span>
              </p>
            )}
          </div>
        )}

        {tab === "result" && (
          <div
            className={`min-h-[200px] rounded-lg border p-4 ${
              job.status === "failed"
                ? "border-red-200 bg-red-50/80"
                : job.status === "completed"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-slate-200 bg-white"
            }`}
          >
            {hasResult ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{job.result_summary}</p>
            ) : (
              <p className="text-sm text-slate-500">
                {["queued", "leased", "running"].includes(job.status) ? "执行中…" : "暂无结果"}
              </p>
            )}
          </div>
        )}

        {tab === "log" && (
          <div className="min-h-[200px] overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
            {hasLog ? (
              <pre className="max-h-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-slate-200">
                {job.log_excerpt}
              </pre>
            ) : (
              <p className="p-4 text-sm text-slate-400">
                {["queued", "leased", "running"].includes(job.status) ? "执行中…" : "暂无日志"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
