/** Agent 详情抽屉 — 规则 / 技能 / 决策 / Soul */
import { useEffect, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";

interface SoulData {
  content: string;
  soul_type: string;
}

interface Rule {
  id?: string;
  instruction?: string;
  content?: string;
  effectiveness?: number;
  tool_hint?: string;
  has_skill?: boolean;
  origin?: string;
}

interface PromptItem {
  name: string;
  filename: string;
  content: string;
  evolved: boolean;
}

interface Decision {
  id?: number;
  ts?: string;
  session_id?: string;
  total_tools?: number;
  failed_tools?: number;
  replans?: number;
  elapsed_ms?: number;
  task_completed?: boolean;
  feedback?: string;
  evolved?: boolean;
  task_description?: string;
  tools_detail?: string;

  [k: string]: unknown;
}

interface EvolutionLogItem {
  ts: string;
  type: string;
  target_id: string;
  reason: string;
}

/** 执行记录：拒绝 / 已执行 */
interface ExecutionLogItem {
  ts: string | number;
  task: string;
  status: "refused" | "executed";
  refusal_reason?: string;
  task_completed?: boolean;
  total_tools?: number;
  failed_tools?: number;
  elapsed_ms?: number;
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

export function AgentDetail({
  agentId,
  onClose,
  initialTab,
}: {
  agentId: string;
  onClose: () => void;
  initialTab?: "rules" | "skills" | "decisions" | "evolution" | "soul" | "executions" | "prompts";
}) {
  const [tab, setTab] = useState<
    "rules" | "skills" | "decisions" | "evolution" | "soul" | "executions" | "prompts"
  >(initialTab ?? "executions");
  const [rules, setRules] = useState<Rule[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [skills, setSkills] = useState<
    { name: string; status: string; description?: string; created_at?: string; call_count?: number; success_count?: number }[]
  >([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [executionLog, setExecutionLog] = useState<ExecutionLogItem[]>([]);
  const [evolutionLog, setEvolutionLog] = useState<EvolutionLogItem[]>([]);
  const [soul, setSoul] = useState<SoulData | null>(null);
  const [soulEdit, setSoulEdit] = useState("");
  const [soulSaving, setSoulSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const removeAgent = useEvotownStore((s) => s.removeAgent);
  const agent = useEvotownStore((s) => s.agents.find((a) => a.id === agentId));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) setLoading(true);
      try {
        const [rRes, sRes, dRes, exeRes, soulRes, evoRes, promptsRes] = await Promise.all([
          fetch(`/agents/${agentId}/rules`),
          fetch(`/agents/${agentId}/skills`),
          fetch(`/agents/${agentId}/decisions?limit=50`),
          fetch(`/agents/${agentId}/execution_log?limit=30`),
          fetch(`/agents/${agentId}/soul`),
          fetch(`/agents/${agentId}/evolution_log?limit=100`),
          fetch(`/agents/${agentId}/prompts`),
        ]);
        if (cancelled) return;

        const safeJson = async (res: Response, fallback: unknown = []) => {
          try { return res.ok ? (await res.json()) ?? fallback : fallback; }
          catch { return fallback; }
        };

        setRules((await safeJson(rRes, [])) as Rule[]);

        const skillsRaw = (await safeJson(sRes, [])) as unknown[];
        setSkills(
          Array.isArray(skillsRaw)
            ? skillsRaw.map((s: unknown) =>
                typeof s === "string" ? { name: s, status: "confirmed" } : (s as typeof skills[number])
              )
            : []
        );

        const decisionsData = (await safeJson(dRes, [])) as Decision[];
        setDecisions(decisionsData);

        if (exeRes.ok) {
          setExecutionLog((await safeJson(exeRes, [])) as ExecutionLogItem[]);
        } else {
          setExecutionLog(
            decisionsData.slice(0, 30).map((d: Decision) => ({
              ts: d.ts ?? "",
              task: d.task_description ?? "-",
              status: "executed" as const,
              task_completed: d.task_completed,
              total_tools: d.total_tools,
              failed_tools: d.failed_tools,
              elapsed_ms: d.elapsed_ms,
            }))
          );
        }

        const evoRaw = (await safeJson(evoRes, [])) as Record<string, unknown>[];
        setEvolutionLog(
          Array.isArray(evoRaw)
            ? evoRaw.map((r) => ({
                ts: String(r.ts ?? r.timestamp ?? ""),
                type: String(r.type ?? r.event_type ?? ""),
                target_id: String(r.target_id ?? r.id ?? ""),
                reason: String(r.reason ?? ""),
              }))
            : []
        );

        const soulData = await safeJson(soulRes, null);
        if (soulData && typeof soulData === "object" && "content" in (soulData as Record<string, unknown>)) {
          setSoul(soulData as SoulData);
          setSoulEdit((soulData as SoulData).content ?? "");
        } else {
          setSoul(null);
        }

        const promptsRaw = (await safeJson(promptsRes, [])) as PromptItem[];
        setPrompts(Array.isArray(promptsRaw) ? promptsRaw : []);
      } catch (err) {
        if (cancelled) return;
        console.warn(`[evotown] AgentDetail load failed for ${agentId}`, err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [agentId]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [agentId, initialTab]);

  const saveSoul = async () => {
    setSoulSaving(true);
    try {
      const res = await fetch(`/agents/${agentId}/soul`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: soulEdit }),
      });
      const data = await res.json();
      if (data?.ok) {
        setSoul((prev) => (prev ? { ...prev, content: soulEdit } : { content: soulEdit, soul_type: "balanced" }));
      }
    } finally {
      setSoulSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定要删除 Agent「${agentId}」吗？删除后可从竞技场重新创建。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        removeAgent(agentId);
        evotownEvents.emit("agent_eliminated", { agent_id: agentId, reason: "user_deleted" });
        evotownEvents.emit("request_sync", {});
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? "删除失败");
      }
    } catch (err) {
      console.warn("[evotown] delete agent failed", err);
      alert("删除失败，请检查网络");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-slate-900/95 backdrop-blur-sm border-l border-slate-600/50 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-600/50">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-slate-200 truncate">{agentId} 详情</h3>
          {agent && (
            <p className="text-[10px] text-slate-500 mt-0.5" title="任务 成功/总数 · 进化 成功/总数">
              📋{agent.success_count ?? 0}/{agent.task_count ?? 0} ✨{agent.evolution_success_count ?? 0}/{agent.evolution_count ?? 0}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-2 py-1 text-[10px] font-medium rounded bg-rose-600/20 text-rose-400 border border-rose-600/30 hover:bg-rose-600/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? "删除中..." : "删除"}
          </button>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex border-b border-slate-600/50 overflow-x-auto">
        {(["executions", "decisions", "rules", "prompts", "skills", "evolution", "soul"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium transition-colors shrink-0 ${
              tab === t
                ? "text-evo-accent border-b-2 border-evo-accent"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "executions" ? "执行记录" : t === "rules" ? "规则" : t === "prompts" ? "Prompts" : t === "skills" ? "技能" : t === "decisions" ? "决策" : t === "evolution" ? "进化" : "Soul"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-sm text-slate-500">加载中...</p>
        ) : tab === "executions" ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">任务态度与执行（最近 30 条：拒绝 / 接受并执行）</p>
            {executionLog.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
                暂无执行记录
              </p>
            ) : (
              <ul className="space-y-1.5 font-mono text-xs">
                {executionLog.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-2 py-1.5 px-2 rounded hover:bg-slate-800/40 items-baseline">
                    <span className="text-slate-500 shrink-0 whitespace-nowrap">
                      {typeof e.ts === "number"
                        ? new Date(e.ts * 1000).toLocaleString("zh-CN")
                        : e.ts
                          ? new Date(e.ts).toLocaleString("zh-CN")
                          : "-"}
                    </span>
                    <span className="truncate text-slate-300 min-w-0" title={e.task}>
                      {e.task || "-"}
                    </span>
                    {e.status === "refused" ? (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-rose-900/50 text-rose-400 border border-rose-700/50">
                        拒绝
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                          e.task_completed
                            ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/50"
                            : "bg-amber-900/50 text-amber-400 border border-amber-700/50"
                        }`}
                      >
                        {e.task_completed ? "✓ 完成" : "○ 未完成"}
                      </span>
                    )}
                    {e.status === "refused" && e.refusal_reason && (
                      <span className="text-slate-500 text-[10px] truncate max-w-[180px]" title={e.refusal_reason}>
                        {e.refusal_reason}
                      </span>
                    )}
                    {e.status === "executed" && (e.total_tools != null || e.elapsed_ms != null) && (
                      <span className="text-slate-500 text-[10px]">
                        {e.total_tools != null && `🔧 ${e.total_tools}次`}
                        {e.failed_tools != null && e.failed_tools > 0 && (
                          <span className="text-amber-400"> 失败{e.failed_tools}</span>
                        )}
                        {e.elapsed_ms != null && ` ⏱ ${e.elapsed_ms}ms`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : tab === "rules" ? (
          <ul className="space-y-2">
            {rules.length === 0 ? (
              <li className="text-sm text-slate-500">暂无规则</li>
            ) : (
              rules.map((r, i) => (
                <li
                  key={r.id ?? i}
                  className={`p-2 rounded border text-xs text-slate-300 ${
                    r.origin === "evolved"
                      ? "bg-violet-900/20 border-violet-700/40"
                      : "bg-slate-800/50 border-slate-700/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono whitespace-pre-wrap break-words flex-1 min-w-0">
                      {r.instruction ?? r.content ?? JSON.stringify(r)}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {r.origin === "evolved" && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] bg-violet-900/50 text-violet-400 border border-violet-600/50"
                          title="进化产出"
                        >
                          ✨ 进化
                        </span>
                      )}
                      {r.tool_hint != null && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            r.has_skill
                              ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/50"
                              : "bg-amber-900/30 text-amber-500/90 border border-amber-700/30"
                          }`}
                          title={r.has_skill ? "已拥有此技能" : "未拥有此技能"}
                        >
                          {r.tool_hint}
                          {r.has_skill ? " ✓" : " ✗"}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.effectiveness != null && (
                    <p className="text-slate-500 mt-1">effectiveness: {r.effectiveness}</p>
                  )}
                </li>
              ))
            )}
          </ul>
        ) : tab === "prompts" ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">planning / execution / system / examples（进化过的会标记 ✨）</p>
            {prompts.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
                暂无 Prompts
              </p>
            ) : (
              prompts.map((p) => (
                <div
                  key={p.name}
                  className={`rounded-xl border text-xs overflow-hidden ${
                    p.evolved
                      ? "bg-violet-900/15 border-violet-700/40"
                      : "bg-slate-800/40 border-slate-700/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-700/50 bg-slate-900/30">
                    <span className="font-mono font-medium text-slate-200">{p.filename}</span>
                    {p.evolved && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-violet-900/50 text-violet-400 border border-violet-600/50"
                        title="曾被进化修改"
                      >
                        ✨ 进化
                      </span>
                    )}
                  </div>
                  <pre className="p-3 text-slate-400 whitespace-pre-wrap break-words font-mono text-[11px] max-h-48 overflow-y-auto">
                    {p.content || "(空)"}
                  </pre>
                </div>
              ))
            )}
          </div>
        ) : tab === "skills" ? (
          <div className="space-y-2">
            {skills.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
                暂无进化技能
              </p>
            ) : (
              skills.map((s) => (
                <div
                  key={s.name}
                  className={`rounded-xl border text-xs transition-all ${
                    s.status === "pending"
                      ? "bg-gradient-to-b from-amber-950/20 to-slate-800/50 border-amber-700/40"
                      : "bg-slate-800/40 border-slate-700/40"
                  }`}
                >
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-slate-200 font-medium truncate">{s.name}</span>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            s.status === "pending"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          {s.status === "pending" ? "待确认" : "已启用"}
                        </span>
                      </div>
                      {s.status === "pending" && (
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={async () => {
                              const res = await fetch(`/agents/${agentId}/skills/${s.name}/confirm`, { method: "POST" });
                              const data = await res.json();
                              if (data.ok) {
                                setSkills((prev) =>
                                  prev.map((sk) => sk.name === s.name ? { ...sk, status: "confirmed" } : sk)
                                );
                              }
                            }}
                            className="px-2 py-1 rounded text-[10px] font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/40 transition-colors"
                          >
                            确认
                          </button>
                          <button
                            onClick={async () => {
                              const res = await fetch(`/agents/${agentId}/skills/${s.name}/reject`, { method: "POST" });
                              const data = await res.json();
                              if (data.ok) {
                                setSkills((prev) => prev.filter((sk) => sk.name !== s.name));
                              }
                            }}
                            className="px-2 py-1 rounded text-[10px] font-medium bg-rose-600/20 text-rose-400 border border-rose-600/30 hover:bg-rose-600/40 transition-colors"
                          >
                            拒绝
                          </button>
                        </div>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-slate-400 text-[11px] leading-relaxed">{s.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                      {s.created_at && (
                        <span>创建: {new Date(s.created_at).toLocaleString("zh-CN")}</span>
                      )}
                      {s.call_count != null && s.status === "confirmed" && (
                        <span>调用 {s.call_count} 次</span>
                      )}
                      {s.success_count != null && s.status === "confirmed" && s.call_count != null && s.call_count > 0 && (
                        <span>成功 {s.success_count} 次</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === "evolution" ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">进化事件明细（时间倒序）</p>
            {evolutionLog.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
                暂无进化记录
              </p>
            ) : (
              <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800/50 text-slate-400">
                      <th className="text-left py-2 px-2 font-medium">时间</th>
                      <th className="text-left py-2 px-2 font-medium">类型</th>
                      <th className="text-left py-2 px-2 font-medium">目标</th>
                      <th className="text-left py-2 px-2 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evolutionLog.map((e, i) => (
                      <tr key={i} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                        <td className="py-1.5 px-2 text-slate-500 whitespace-nowrap">
                          {e.ts ? new Date(e.ts).toLocaleString("zh-CN") : "-"}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                            {EVO_TYPE_LABELS[e.type] ?? e.type}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 font-mono text-slate-400 truncate max-w-[80px]" title={e.target_id}>
                          {e.target_id || "-"}
                        </td>
                        <td className="py-1.5 px-2 text-slate-400 break-words max-w-[180px]">
                          {e.reason || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : tab === "soul" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              {soul ? (
                <span className="text-slate-500 text-xs">
                  类型: {soul.soul_type === "conservative" ? "保守" : soul.soul_type === "aggressive" ? "激进" : "均衡"}
                </span>
              ) : (
                <span className="text-slate-500 text-xs">Soul 文件</span>
              )}
              <button
                onClick={saveSoul}
                disabled={soulSaving || (soul ? soulEdit === soul.content : false)}
                className="px-3 py-1 text-xs rounded bg-evo-accent/20 text-evo-accent border border-evo-accent/20 hover:bg-evo-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {soulSaving ? "保存中..." : "保存"}
              </button>
            </div>
            <textarea
              value={soulEdit}
              onChange={(e) => setSoulEdit(e.target.value)}
              className="w-full h-64 p-3 rounded bg-slate-800/50 border border-slate-700/50 text-slate-300 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-evo-accent/50"
              placeholder="SOUL.md"
              spellCheck={false}
            />
          </div>
        ) : (
          <ul className="space-y-3">
            {decisions.length === 0 ? (
              <li className="text-sm text-slate-500 py-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
                暂无决策记录（需 agent 至少调用 1 次工具才会记录，SkillLite 据此触发进化）
              </li>
            ) : (
              decisions.map((d, i) => (
                <li
                  key={d.id ?? i}
                  className={`relative overflow-hidden rounded-xl border text-xs transition-all ${
                    d.evolved
                      ? "bg-slate-800/25 border-slate-600/40 opacity-90"
                      : d.task_completed
                        ? "bg-gradient-to-b from-emerald-950/20 to-slate-800/50 border-emerald-800/30"
                        : "bg-gradient-to-b from-amber-950/15 to-slate-800/50 border-amber-800/30"
                  }`}
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-500/30 to-transparent" />
                  <div className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            d.task_completed
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          {d.task_completed ? "✓ 完成" : "○ 未完成"}
                        </span>
                        {d.evolved && (
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-violet-900/50 text-violet-400 border border-violet-600/50"
                            title="该决策已被进化引擎使用"
                          >
                            ✨ 已进化
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500 text-[10px] shrink-0">
                        {d.ts ? new Date(d.ts).toLocaleString("zh-CN") : ""}
                      </span>
                    </div>
                    <p className="text-slate-200 font-medium break-words leading-relaxed pl-0.5">
                      {d.task_description ?? "-"}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500 text-[10px]">
                      <span className="flex items-center gap-1">
                        <span className="text-slate-600">🔧</span> {d.total_tools ?? 0} 次
                      </span>
                      {d.failed_tools != null && d.failed_tools > 0 && (
                        <span className="text-amber-400">失败 {d.failed_tools}</span>
                      )}
                      {d.replans != null && d.replans > 0 && (
                        <span>🔄 重规划 {d.replans}</span>
                      )}
                      {d.elapsed_ms != null && (
                        <span>⏱ {d.elapsed_ms}ms</span>
                      )}
                      {d.feedback && d.feedback !== "neutral" && (
                        <span className="text-slate-400">反馈: {d.feedback}</span>
                      )}
                    </div>
                    {d.tools_detail && (() => {
                      try {
                        const tools = JSON.parse(d.tools_detail) as { tool?: string; success?: boolean }[];
                        if (Array.isArray(tools) && tools.length > 0) {
                          return (
                            <div className="mt-2 pt-2 border-t border-slate-700/50">
                              <p className="text-slate-500 mb-1.5 text-[10px] font-medium">工具明细</p>
                              <ul className="space-y-2">
                                {tools.map((t, j) => (
                                  <li key={j} className="flex items-center gap-2 py-1 px-2 rounded bg-slate-900/40">
                                    <span
                                      className={`w-4 h-4 rounded flex items-center justify-center text-[10px] shrink-0 ${
                                        t.success ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                                      }`}
                                    >
                                      {t.success ? "✓" : "✗"}
                                    </span>
                                    <span className="font-mono text-slate-400 truncate">{t.tool ?? String(t)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        }
                      } catch {
                        /* ignore */
                      }
                      return null;
                    })()}
                  </div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
