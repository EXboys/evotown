import { formatDateTimeShort } from "../../lib/datetime";

export interface Decision {
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

export function DecisionList({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) {
    return (
      <li className="text-sm text-slate-500 py-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
        暂无决策记录（需 agent 至少调用 1 次工具才会记录，SkillLite 据此触发进化）
      </li>
    );
  }

  return (
    <ul className="space-y-3">
      {decisions.map((d, i) => (
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
                {d.ts ? formatDateTimeShort(d.ts) : ""}
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
      ))}
    </ul>
  );
}
