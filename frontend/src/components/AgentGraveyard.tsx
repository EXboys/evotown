/** 墓园 — 消失的智能体列表与生命周期查看 */
import { useEffect, useState } from "react";

const AGENT_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e", "#14b8a6", "#84cc16",
];
function getAgentColor(agentId: string): string {
  const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

interface EliminatedRecord {
  agent_id: string;
  display_name?: string;
  reason: string;
  final_balance: number | null;
  soul_type: string;
  ts: number;
  task_count?: number;
  success_count?: number;
  evolution_count?: number;
  evolution_success_count?: number;
}

const EVO_TYPE_LABELS: Record<string, string> = {
  rule_added: "规则+",
  rule_retired: "规则-",
  example_added: "示例+",
  skill_pending: "技能待确认",
  skill_confirmed: "技能确认",
  skill_refined: "技能优化",
  skill_retired: "技能归档",
  evolution_run: "运行",
  auto_rollback: "回滚",
};

export function AgentGraveyard() {
  const [list, setList] = useState<EliminatedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<Record<string, unknown> | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  const loadList = () => {
    setLoading(true);
    fetch("/monitor/eliminated_agents?limit=100")
      .then((r) => r.json())
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setLifecycle(null);
      return;
    }
    setLifecycleLoading(true);
    fetch(`/monitor/eliminated_agents/${selectedId}/lifecycle`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setLifecycle(null);
        else setLifecycle(d);
      })
      .catch(() => setLifecycle(null))
      .finally(() => setLifecycleLoading(false));
  }, [selectedId]);

  return (
    <div className="space-y-4 min-w-0">
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="text-amber-500/80">🪦</span> 消失的智能体
          </span>
          <button
            onClick={loadList}
            disabled={loading}
            className="text-[10px] text-slate-500 hover:text-slate-400 disabled:opacity-50"
          >
            {loading ? "加载中" : "刷新"}
          </button>
        </h3>
        {list.length === 0 ? (
          <p className="text-xs text-slate-500 italic">暂无淘汰记录</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {list.map((r) => (
              <button
                key={r.agent_id}
                onClick={() => setSelectedId(selectedId === r.agent_id ? null : r.agent_id)}
                className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  selectedId === r.agent_id
                    ? "bg-slate-700/60 text-slate-200"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-300"
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0 opacity-60"
                  style={{ backgroundColor: getAgentColor(r.agent_id) }}
                />
                <span className="font-mono truncate min-w-0">{r.display_name || r.agent_id}</span>
                <span className="text-amber-500/80 shrink-0">
                  ({r.final_balance != null ? r.final_balance : "?"})
                </span>
                <span className="shrink-0 text-[10px] text-slate-500" title="任务 成功/总数 · 进化 成功/总数">
                  📋{r.success_count ?? 0}/{r.task_count ?? 0} ✨{r.evolution_success_count ?? 0}/{r.evolution_count ?? 0}
                </span>
                <span className="shrink-0 text-[10px] text-slate-600">
                  {r.reason === "balance_zero" ? "余额归零" : r.reason === "inferred" ? "历史" : "用户删除"}
                </span>
                <span className="shrink-0 text-slate-600 text-[10px]">
                  {r.ts ? new Date(r.ts * 1000).toLocaleDateString("zh-CN") : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedId && (
        <LifecycleDetail
          agentId={selectedId}
          lifecycle={lifecycle}
          loading={lifecycleLoading}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function LifecycleDetail({
  agentId,
  lifecycle,
  loading,
  onClose,
}: {
  agentId: string;
  lifecycle: Record<string, unknown> | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"executions" | "evolution" | "rules" | "skills">("executions");

  if (loading || !lifecycle) {
    return (
      <div className="rounded-xl border border-slate-600/50 bg-slate-900/50 p-4">
        <p className="text-xs text-slate-500">{loading ? "加载中..." : "无生命周期数据"}</p>
        <button onClick={onClose} className="mt-2 text-[10px] text-slate-500 hover:text-slate-400">
          关闭
        </button>
      </div>
    );
  }

  const executionLog = (lifecycle.execution_log as Array<Record<string, unknown>>) ?? [];
  const evolutionLog = (lifecycle.evolution_log as Array<Record<string, unknown>>) ?? [];
  const rules = (lifecycle.rules as Array<Record<string, unknown>>) ?? [];
  const skills = (lifecycle.skills as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="rounded-xl border border-slate-600/50 bg-slate-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-600/50">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: getAgentColor(agentId) }}
          />
          <span className="font-mono text-sm text-slate-200 truncate">{String(lifecycle?.display_name || agentId)}</span>
          <span className="text-[10px] text-slate-500 shrink-0">
            {String(lifecycle.reason_label ?? "")}
            {lifecycle.final_balance != null ? ` · 余额 ${lifecycle.final_balance}` : ""}
            {" · "}
            📋{Number(lifecycle.success_count ?? 0)}/{Number(lifecycle.task_count ?? 0)} ✨{Number(lifecycle.evolution_success_count ?? 0)}/{Number(lifecycle.evolution_count ?? 0)}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">
          ×
        </button>
      </div>
      <div className="flex border-b border-slate-600/50 overflow-x-auto">
        {(["executions", "evolution", "rules", "skills"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[10px] font-medium transition-colors shrink-0 ${
              tab === t
                ? "text-evo-accent border-b-2 border-evo-accent"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "executions" ? "执行记录" : t === "evolution" ? "进化" : t === "rules" ? "规则" : "技能"}
          </button>
        ))}
      </div>
      <div className="max-h-64 overflow-y-auto p-3">
        {tab === "executions" && (
          <ul className="space-y-1.5 font-mono text-[10px]">
            {executionLog.length === 0 ? (
              <li className="text-slate-500 py-2">暂无执行记录</li>
            ) : (
              executionLog.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-2 py-1 px-2 rounded hover:bg-slate-800/40 items-baseline">
                  <span className="text-slate-500 shrink-0 whitespace-nowrap">
                    {e.ts
                      ? new Date(typeof e.ts === "number" ? e.ts * 1000 : String(e.ts)).toLocaleString("zh-CN")
                      : "-"}
                  </span>
                  <span className="truncate text-slate-300 min-w-0" title={String(e.task ?? "")}>
                    {String(e.task ?? "-").slice(0, 60)}
                    {(e.task as string)?.length > 60 ? "…" : ""}
                  </span>
                  {e.status === "refused" ? (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] bg-rose-900/50 text-rose-400">
                      拒绝
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] ${
                        e.task_completed
                          ? "bg-emerald-900/50 text-emerald-400"
                          : "bg-amber-900/50 text-amber-400"
                      }`}
                    >
                      {e.task_completed ? "✓" : "○"}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
        {tab === "evolution" && (
          <div className="space-y-1">
            {evolutionLog.length === 0 ? (
              <p className="text-slate-500 text-xs py-2">暂无进化记录</p>
            ) : (
              evolutionLog.map((e, i) => (
                <div key={i} className="flex gap-2 py-1 px-2 rounded hover:bg-slate-800/40 text-[10px]">
                  <span className="text-slate-500 shrink-0">
                    {e.ts ? new Date(String(e.ts)).toLocaleString("zh-CN") : "-"}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                    {EVO_TYPE_LABELS[String(e.type ?? "")] ?? String(e.type ?? "-")}
                  </span>
                  <span className="text-slate-400 truncate">{String(e.reason ?? "")}</span>
                </div>
              ))
            )}
          </div>
        )}
        {tab === "rules" && (
          <ul className="space-y-2">
            {rules.length === 0 ? (
              <li className="text-slate-500 text-xs py-2">暂无规则</li>
            ) : (
              rules.map((r, i) => (
                <li key={i} className="p-2 rounded border border-slate-700/50 text-[10px] text-slate-300">
                  {String(r.instruction ?? r.content ?? JSON.stringify(r)).slice(0, 200)}
                  {String(r.instruction ?? r.content ?? "").length > 200 ? "…" : ""}
                </li>
              ))
            )}
          </ul>
        )}
        {tab === "skills" && (
          <div className="space-y-1">
            {skills.length === 0 ? (
              <p className="text-slate-500 text-xs py-2">暂无技能</p>
            ) : (
              skills.map((s, i) => (
                <div key={i} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-800/40">
                  <span className="font-mono text-[10px] text-slate-300">
                    {typeof s === "string" ? s : (s as { name?: string }).name ?? "-"}
                  </span>
                  {typeof s === "object" && s && "status" in s && (
                    <span className="text-[9px] text-slate-500">{String(s.status)}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
