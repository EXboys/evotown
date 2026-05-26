import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import { evotownEvents } from "../phaser/events";

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
  created_at?: string;
  completed_at?: string;
  result_summary?: string;
  refs?: { parent_job_id?: string };
  payload?: { on_success_handoff?: Record<string, unknown> };
};

type Props = {
  engines: FleetEngine[];
  onRefresh: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  leased: "已领取",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function DispatchPanel({ engines, onRefresh }: Props) {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<DispatchJob | null>(null);
  const [teamPairs, setTeamPairs] = useState("*");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [form, setForm] = useState({
    kind: "dispatch" as "dispatch" | "handoff" | "notify",
    target_engine_id: "",
    target_team_id: "",
    title: "",
    message: "",
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
    const onUpdate = (data: { job: DispatchJob }) => {
      setJobs((prev) => mergeJob(prev, data.job));
      setSelected((cur) => (cur?.job_id === data.job.job_id ? { ...cur, ...data.job } : cur));
    };
    evotownEvents.on("dispatch_job_updated", onUpdate);
    return () => evotownEvents.off("dispatch_job_updated", onUpdate);
  }, []);

  const savePolicy = async () => {
    setPolicyLoading(true);
    setMessage("");
    const r = await adminFetch("/api/v1/dispatch/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_pairs: teamPairs }),
    });
    setPolicyLoading(false);
    if (!r.ok) {
      setMessage(`策略保存失败: ${(await r.text()).slice(0, 120)}`);
      return;
    }
    setMessage("Handoff 策略已保存（若设置了环境变量 EVOTOWN_DISPATCH_TEAM_PAIRS 仍以 env 为准）");
  };

  const submit = async () => {
    setMessage("");
    if (!form.message.trim()) {
      setMessage("请填写任务内容");
      return;
    }
    if (!form.target_engine_id && !form.target_team_id) {
      setMessage("请指定目标引擎 ID 或目标团队");
      return;
    }
    const body: Record<string, unknown> = {
      kind: form.kind,
      target_engine_id: form.target_engine_id || undefined,
      target_team_id: form.target_team_id || undefined,
      title: form.title,
      message: form.message,
    };
    if (form.chain && form.chain_team && form.chain_message.trim()) {
      body.payload = {
        on_success_handoff: {
          kind: "handoff",
          target_team_id: form.chain_team,
          title: "接续任务",
          message: form.chain_message,
        },
      };
    }
    const r = await adminFetch("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text();
      setMessage(`派发失败: ${err.slice(0, 200)}`);
      return;
    }
    setMessage(form.chain ? "已入队（成功后自动 handoff 到下一团队）" : "已入队");
    setForm((f) => ({ ...f, message: "", title: "", chain_message: "" }));
    loadJobs();
    onRefresh();
  };

  const cancelJob = async (jobId: string) => {
    const r = await adminFetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    if (r.ok) {
      loadJobs();
      if (selected?.job_id === jobId) setSelected(null);
    }
  };

  const rotateIngestToken = async (engineId: string) => {
    if (!window.confirm(`轮换引擎 ${engineId} 的 evi_ token？旧 token 将立即失效。`)) return;
    setMessage("");
    const r = await adminFetch(`/api/v1/engines/${encodeURIComponent(engineId)}/rotate-ingest-token`, {
      method: "POST",
    });
    if (!r.ok) {
      setMessage(`轮换失败: ${(await r.text()).slice(0, 120)}`);
      return;
    }
    const data = (await r.json()) as { ingest_token?: string };
    setMessage(
      data.ingest_token
        ? `已轮换 ${engineId}。请将新 token 写入员工机 EVOTOWN_ENGINE_INGEST_TOKEN（仅显示一次）：${data.ingest_token.slice(0, 12)}…`
        : `已轮换 ${engineId}`,
    );
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 text-sm text-slate-700">
        <strong>部署检查：</strong> 员工机需 <code className="text-xs">register</code> +{" "}
        <code className="text-xs">connector</code>；OpenClaw 配置 <code className="text-xs">hooks</code> 与{" "}
        <code className="text-xs">OPENCLAW_HOOK_TOKEN</code>。跨团队 handoff 受服务端{" "}
        <code className="text-xs">EVOTOWN_DISPATCH_TEAM_PAIRS</code> 控制；可在下方编辑并保存到{" "}
        <code className="text-xs">evotown_config.json</code>。
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-950">Handoff 团队白名单</h2>
        <p className="mt-1 text-xs text-slate-500">
          格式：<code>*</code> 允许全部，或 <code>sales:finance,it:finance</code>（源团队:目标团队，逗号分隔）
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">派发任务</h2>
          <p className="mt-1 text-sm text-slate-500">任务由目标 Connector 经本机 Gateway 执行。</p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">类型</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
              >
                <option value="dispatch">dispatch（中心派活）</option>
                <option value="handoff">handoff（交接）</option>
                <option value="notify">notify（通知，触发后即完成）</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">目标引擎 ID</span>
              <input
                list="engine-ids"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                value={form.target_engine_id}
                onChange={(e) => setForm({ ...form, target_engine_id: e.target.value })}
              />
              <datalist id="engine-ids">
                {engines.map((e) => (
                  <option key={e.engine_id} value={e.engine_id} />
                ))}
              </datalist>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">或目标团队</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.target_team_id}
                onChange={(e) => setForm({ ...form, target_team_id: e.target.value })}
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">标题</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">任务内容</span>
              <textarea
                className="mt-1 min-h-[100px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.chain}
                onChange={(e) => setForm({ ...form, chain: e.target.checked })}
              />
              成功后自动 handoff 到下一团队
            </label>
            {form.chain && (
              <>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="下一团队 owner_team"
                  value={form.chain_team}
                  onChange={(e) => setForm({ ...form, chain_team: e.target.value })}
                />
                <textarea
                  className="min-h-[60px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="接续任务内容"
                  value={form.chain_message}
                  onChange={(e) => setForm({ ...form, chain_message: e.target.value })}
                />
              </>
            )}

            <button
              type="button"
              onClick={submit}
              className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              派发到队列
            </button>
            {message && <p className="text-sm text-slate-600">{message}</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">Fleet 与任务队列</h2>
            <div className="flex items-center gap-2">
              <select
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">全部状态</option>
                <option value="queued">queued</option>
                <option value="running">running</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  loadJobs();
                  onRefresh();
                }}
                disabled={loading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                刷新
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">引擎</th>
                  <th className="px-3 py-2">团队</th>
                  <th className="px-3 py-2">token</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {engines.map((e) => (
                  <tr key={e.engine_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-medium text-slate-800"
                        onClick={() => setForm((f) => ({ ...f, target_engine_id: e.engine_id }))}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${e.online ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {e.display_name || e.engine_id}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{e.owner_team || "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {e.ingest_token_prefix ? `${e.ingest_token_prefix}…` : "未签发"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded border border-slate-200 px-2 py-0.5 hover:bg-white"
                        onClick={() => rotateIngestToken(e.engine_id)}
                      >
                        轮换 evi_
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-slate-200 max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jobs.map((j) => (
                    <tr
                      key={j.job_id}
                      onClick={() => setSelected(j)}
                      className={`cursor-pointer hover:bg-slate-50 ${selected?.job_id === j.job_id ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{j.job_id.slice(0, 18)}…</div>
                        <div className="line-clamp-1 text-slate-600">{j.title || j.message.slice(0, 40)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{STATUS_LABEL[j.status] || j.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              {selected ? (
                <>
                  <div className="font-mono text-xs text-slate-500">{selected.job_id}</div>
                  <div className="mt-2 font-semibold text-slate-950">{selected.title || "（无标题）"}</div>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{selected.message}</p>
                  <dl className="mt-4 space-y-1 text-xs text-slate-600">
                    <div>
                      <dt className="inline font-medium">状态：</dt>
                      <dd className="inline">{STATUS_LABEL[selected.status] || selected.status}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">目标：</dt>
                      <dd className="inline font-mono">
                        {selected.target_engine_id || `team:${selected.target_team_id}`}
                      </dd>
                    </div>
                    {selected.source_engine_id && (
                      <div>
                        <dt className="inline font-medium">来源：</dt>
                        <dd className="inline font-mono">{selected.source_engine_id}</dd>
                      </div>
                    )}
                    {selected.refs?.parent_job_id && (
                      <div>
                        <dt className="inline font-medium">父任务：</dt>
                        <dd className="inline font-mono">{selected.refs.parent_job_id}</dd>
                      </div>
                    )}
                    {selected.result_summary && (
                      <div className="mt-2 rounded bg-white p-2 text-slate-700">{selected.result_summary.slice(0, 500)}</div>
                    )}
                  </dl>
                  {["queued", "leased", "running"].includes(selected.status) && (
                    <button
                      type="button"
                      onClick={() => cancelJob(selected.job_id)}
                      className="mt-4 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                    >
                      取消任务
                    </button>
                  )}
                </>
              ) : (
                <p className="text-slate-500">选择一条任务查看详情</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
