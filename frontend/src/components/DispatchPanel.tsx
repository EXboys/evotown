import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
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
  const [fleetExpanded, setFleetExpanded] = useState(true);
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
    adminFetch("/api/v1/coding-agent/options")
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
    setDetailTab("content");
    setDetailLoading(true);
    try {
      const r = await adminFetch(`/api/v1/jobs/${encodeURIComponent(job.job_id)}`);
      if (r.ok) {
        const data = (await r.json()) as { job?: DispatchJob };
        if (data.job) {
          setSelected(data.job);
          setJobs((prev) => mergeJob(prev, data.job!));
        }
      }
    } catch {
      /* keep list row */
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
  const selectedEngine = engines.find((e) => e.engine_id === form.target_engine_id);

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
        text: form.chain ? "已入队，成功后自动 handoff 到下一团队" : "任务已入队",
      });
      setForm((f) => ({ ...f, message: "", title: "", chain_message: "" }));
      loadJobs();
      onRefresh();
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">派活中心</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            向 Connector 或 Coding Agent 托管工作区派发任务，实时查看队列与执行结果。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatPill label="在线引擎" value={`${stats.online}/${stats.totalEngines}`} tone="emerald" />
          <StatPill label="进行中" value={String(stats.active)} tone="blue" />
          {stats.failed > 0 && <StatPill label="失败" value={String(stats.failed)} tone="red" />}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* Left: compose */}
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">新建任务</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isHostedTarget
                    ? "托管工作区 · 服务端 Claude Agent 执行"
                    : form.target_engine_id
                      ? "Connector · 员工机 Gateway 执行"
                      : "选择目标引擎或填写团队 ID"}
                </p>
              </div>
              {selectedEngine && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    selectedEngine.online ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {selectedEngine.online ? "在线" : "离线"}
                </span>
              )}
            </div>

            <div className="mt-5 space-y-5">
              <div className="space-y-3">
                <SectionTitle>目标</SectionTitle>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">任务类型</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
                  >
                    <option value="dispatch">dispatch — 中心派活</option>
                    <option value="handoff">handoff — 团队交接</option>
                    <option value="notify">notify — 通知（触发即完成）</option>
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">目标引擎</span>
                  <input
                    list="engine-ids"
                    placeholder="从右侧 Fleet 点选，或手动输入 engine_id"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    value={form.target_engine_id}
                    onChange={(e) => setForm({ ...form, target_engine_id: e.target.value })}
                  />
                  <datalist id="engine-ids">
                    {engines.map((e) => (
                      <option key={e.engine_id} value={e.engine_id} />
                    ))}
                  </datalist>
                </label>

                <div className="relative flex items-center gap-3 py-1 text-xs text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  或
                  <span className="h-px flex-1 bg-slate-200" />
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">目标团队</span>
                  <input
                    placeholder="owner_team，如 org_root"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    value={form.target_team_id}
                    onChange={(e) => setForm({ ...form, target_team_id: e.target.value })}
                  />
                </label>

                {(isHostedTarget || form.model) && (
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">模型</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                    >
                      {!form.model && <option value="">Gateway 默认模型</option>}
                      {models.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                          {item.provider ? ` · ${item.provider}` : ""}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-slate-500">与工作台相同；仅托管工作区生效</span>
                  </label>
                )}
              </div>

              <div className="space-y-3 border-t border-slate-100 pt-5">
                <SectionTitle>内容</SectionTitle>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">标题（可选）</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">任务内容</span>
                  <textarea
                    className="min-h-[120px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="描述 Agent 需要完成的工作…"
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                  />
                </label>
              </div>

              <div className="space-y-3 border-t border-slate-100 pt-5">
                <SectionTitle>高级</SectionTitle>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-300"
                    checked={form.chain}
                    onChange={(e) => setForm({ ...form, chain: e.target.checked })}
                  />
                  <span>
                    <span className="font-medium">成功后自动 handoff</span>
                    <span className="mt-0.5 block text-xs text-slate-500">父任务完成后自动创建子任务给下一团队</span>
                  </span>
                </label>
                {form.chain && (
                  <div className="space-y-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3">
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      placeholder="下一团队 owner_team"
                      value={form.chain_team}
                      onChange={(e) => setForm({ ...form, chain_team: e.target.value })}
                    />
                    <textarea
                      className="min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      placeholder="接续任务内容"
                      value={form.chain_message}
                      onChange={(e) => setForm({ ...form, chain_message: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={submit}
                className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              >
                {submitting ? "提交中…" : "派发到队列"}
              </button>
            </div>
          </div>

          <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between">
                Handoff 团队白名单
                <span className="text-xs font-normal text-slate-400 group-open:hidden">展开</span>
              </span>
            </summary>
            <div className="border-t border-slate-100 px-4 pb-4 pt-3">
              <p className="text-xs text-slate-500">
                <code>*</code> 允许全部，或 <code>sales:finance,it:finance</code>
              </p>
              <textarea
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
                rows={2}
                value={teamPairs}
                onChange={(e) => setTeamPairs(e.target.value)}
              />
              <button
                type="button"
                disabled={policyLoading}
                onClick={savePolicy}
                className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                保存策略
              </button>
            </div>
          </details>

          <details className="group rounded-xl border border-blue-100 bg-blue-50/50 shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between">
                Connector 部署检查
                <span className="text-xs font-normal text-slate-400 group-open:hidden">展开</span>
              </span>
            </summary>
            <div className="border-t border-blue-100 px-4 pb-4 pt-3 text-xs leading-relaxed text-slate-600">
              员工机需 <code>register</code> + <code>connector</code>；OpenClaw 配置 <code>hooks</code> 与{" "}
              <code>OPENCLAW_HOOK_TOKEN</code>。Handoff 受 <code>EVOTOWN_DISPATCH_TEAM_PAIRS</code> 控制。
            </div>
          </details>
        </aside>

        {/* Right: compact fleet picker */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setFleetExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <div>
              <h2 className="text-base font-semibold text-slate-950">Fleet</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {stats.online}/{stats.totalEngines} 在线 · 点击卡片填入目标引擎
              </p>
            </div>
            <span className="text-xs text-slate-400">{fleetExpanded ? "收起 ▴" : "展开 ▾"}</span>
          </button>
          {fleetExpanded && (
            <div className="border-t border-slate-100 px-5 pb-5">
              {engines.length === 0 ? (
                <p className="pt-4 text-sm text-slate-500">暂无注册引擎</p>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {engines.map((e) => {
                    const hosted = isHostedEngine(e.engine_id);
                    const selectedCard = form.target_engine_id === e.engine_id;
                    return (
                      <button
                        key={e.engine_id}
                        type="button"
                        onClick={() => pickEngine(e.engine_id)}
                        className={`rounded-xl border p-3 text-left transition ${
                          selectedCard
                            ? "border-indigo-300 bg-indigo-50/80 ring-2 ring-indigo-100"
                            : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-medium text-slate-900">
                            {e.display_name || e.engine_id}
                          </span>
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${e.online ? "bg-emerald-500" : "bg-slate-300"}`}
                          />
                        </div>
                        <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{e.engine_id}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
                            {hosted ? "托管" : e.engine_type || "connector"}
                          </span>
                          {e.owner_team && (
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
                              {e.owner_team}
                            </span>
                          )}
                        </div>
                        {!hosted && (
                          <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2">
                            <span className="font-mono text-[10px] text-slate-500">
                              {e.ingest_token_prefix ? `${e.ingest_token_prefix}…` : "未签发 token"}
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
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
                              className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800"
                            >
                              轮换 evi_
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full-width operations console */}
      <div className="flex min-h-[min(780px,calc(100vh-10rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">任务操作台</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              共 {stats.totalJobs} 条 · 选中任务可查看完整内容与执行日志
              {loading ? " · 刷新中…" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm"
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

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {/* Job list */}
          <div className="flex min-h-0 flex-col border-b border-slate-100 lg:border-b-0 lg:border-r">
            {jobs.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
                <p className="text-sm font-medium text-slate-700">暂无任务</p>
                <p className="mt-1 text-xs text-slate-500">左侧派发后将在此显示</p>
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
                        className={`w-full px-4 py-3.5 text-left transition ${
                          active ? "border-l-2 border-l-indigo-500 bg-indigo-50/90 pl-[14px]" : "border-l-2 border-l-transparent hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <StatusBadge status={j.status} />
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {j.created_at ? formatDateTimeShort(j.created_at) : ""}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm leading-snug text-slate-800">{j.title || j.message}</p>
                        <p className="mt-1.5 truncate font-mono text-[10px] text-slate-400">{j.job_id}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Job detail workspace */}
          <JobDetailWorkspace
            job={selected}
            loading={detailLoading}
            tab={detailTab}
            onTabChange={setDetailTab}
            onCancel={cancelJob}
            onRefresh={() => selected && void fetchJobDetail(selected)}
          />
        </div>
      </div>
    </div>
  );
}

function hostedWorkspacePath(engineId: string | undefined): string | null {
  if (!engineId?.startsWith("hosted-ws-")) return null;
  return `/coding-agent/workspaces/${engineId.slice("hosted-ws-".length)}`;
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
      <div className="flex min-h-[480px] flex-1 flex-col items-center justify-center bg-slate-50/30 p-8 text-center">
        <p className="text-base font-medium text-slate-700">任务操作台</p>
        <p className="mt-2 max-w-sm text-sm text-slate-500">从左侧列表选择任务，在此查看完整派活内容、执行结果与运行日志</p>
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
    <div className="flex min-h-[480px] flex-1 flex-col bg-slate-50/30">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={job.status} />
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {KIND_LABEL[job.kind] || job.kind}
              </span>
              {loading && <span className="text-xs text-slate-400">同步中…</span>}
            </div>
            <h3 className="mt-2 truncate text-xl font-semibold text-slate-950">{job.title || "（无标题）"}</h3>
            <p className="mt-1 font-mono text-xs text-slate-400">{job.job_id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              刷新详情
            </button>
            {workspacePath && (
              <Link
                to={workspacePath}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
              >
                打开工作区
              </Link>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => onCancel(job.job_id)}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                取消任务
              </button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetaItem label="目标" value={job.target_engine_id || `team:${job.target_team_id}`} mono />
          {job.payload?.model && <MetaItem label="模型" value={job.payload.model} mono />}
          {job.source_engine_id && <MetaItem label="来源" value={job.source_engine_id} mono />}
          {job.run_id && <MetaItem label="Run" value={job.run_id} mono />}
          {job.created_at && <MetaItem label="创建" value={formatDateTimeShort(job.created_at)} />}
          {job.completed_at && <MetaItem label="完成" value={formatDateTimeShort(job.completed_at)} />}
        </dl>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex gap-1 border-b border-slate-200 bg-white px-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${
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

      {/* Tab body — fills remaining height */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === "content" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">派活内容</p>
              </div>
              <div className="min-h-[280px] px-5 py-5">
                <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-800">{job.message}</p>
              </div>
            </div>
            {job.refs?.parent_job_id && (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                父任务：<span className="font-mono text-xs">{job.refs.parent_job_id}</span>
              </div>
            )}
            {job.payload?.on_success_handoff && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <p className="text-xs font-semibold text-amber-900">成功后 Handoff</p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-amber-950">
                  {JSON.stringify(job.payload.on_success_handoff, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === "result" && (
          <div
            className={`min-h-[320px] rounded-xl border p-6 shadow-sm ${
              job.status === "failed"
                ? "border-red-200 bg-red-50/80"
                : job.status === "completed"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-slate-200 bg-white"
            }`}
          >
            {hasResult ? (
              <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-800">{job.result_summary}</p>
            ) : (
              <p className="text-sm text-slate-500">
                {["queued", "leased", "running"].includes(job.status)
                  ? "任务执行中，完成后将显示结果摘要…"
                  : "暂无执行结果"}
              </p>
            )}
          </div>
        )}

        {tab === "log" && (
          <div className="min-h-[320px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm">
            {hasLog ? (
              <pre className="max-h-[min(520px,calc(100vh-22rem))] overflow-auto whitespace-pre-wrap p-5 font-mono text-sm leading-relaxed text-slate-200">
                {job.log_excerpt}
              </pre>
            ) : (
              <p className="p-6 text-sm text-slate-400">
                {["queued", "leased", "running"].includes(job.status) ? "执行中，日志将在完成后可用" : "暂无运行日志"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "blue" | "red";
}) {
  const colors = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 text-center ${colors[tone]}`}>
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-sm text-slate-800 ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</dd>
    </div>
  );
}
