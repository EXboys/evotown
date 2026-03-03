/** Agent 详情抽屉 — 规则 / 技能 / 决策 */
import { useEffect, useState } from "react";

interface Rule {
  id?: string;
  instruction?: string;
  content?: string;
  effectiveness?: number;
  tool_hint?: string;
  has_skill?: boolean;
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

export function AgentDetail({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"rules" | "skills" | "decisions">("rules");
  const [rules, setRules] = useState<Rule[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) setLoading(true);
      try {
        const [rRes, sRes, dRes] = await Promise.all([
          fetch(`/agents/${agentId}/rules`),
          fetch(`/agents/${agentId}/skills`),
          fetch(`/agents/${agentId}/decisions?limit=50`),
        ]);
        if (cancelled) return;
        setRules((await rRes.json()) ?? []);
        setSkills((await sRes.json()) ?? []);
        setDecisions((await dRes.json()) ?? []);
      } catch {
        if (cancelled) return;
        setRules([]);
        setSkills([]);
        setDecisions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [agentId]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-slate-900/95 backdrop-blur-sm border-l border-slate-600/50">
      <div className="flex items-center justify-between p-3 border-b border-slate-600/50">
        <h3 className="text-sm font-medium text-slate-200">{agentId} 详情</h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </div>
      <div className="flex border-b border-slate-600/50">
        {(["rules", "skills", "decisions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === t
                ? "text-evo-accent border-b-2 border-evo-accent"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "rules" ? "规则" : t === "skills" ? "技能" : "决策"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-sm text-slate-500">加载中...</p>
        ) : tab === "rules" ? (
          <ul className="space-y-2">
            {rules.length === 0 ? (
              <li className="text-sm text-slate-500">暂无规则</li>
            ) : (
              rules.map((r, i) => (
                <li
                  key={r.id ?? i}
                  className="p-2 rounded bg-slate-800/50 border border-slate-700/50 text-xs text-slate-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono whitespace-pre-wrap break-words flex-1 min-w-0">
                      {r.instruction ?? r.content ?? JSON.stringify(r)}
                    </p>
                    {r.tool_hint != null && (
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
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
                  {r.effectiveness != null && (
                    <p className="text-slate-500 mt-1">effectiveness: {r.effectiveness}</p>
                  )}
                </li>
              ))
            )}
          </ul>
        ) : tab === "skills" ? (
          <ul className="space-y-1">
            {skills.length === 0 ? (
              <li className="text-sm text-slate-500">暂无进化技能</li>
            ) : (
              skills.map((s) => (
                <li key={s} className="text-sm font-mono text-slate-300">
                  · {s}
                </li>
              ))
            )}
          </ul>
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
