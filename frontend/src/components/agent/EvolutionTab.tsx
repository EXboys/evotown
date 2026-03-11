export interface EvolutionLogItem {
  ts: string;
  type: string;
  target_id: string;
  reason: string;
}

export interface EvolutionMetricsRow {
  date?: string;
  first_success_rate?: number;
  avg_replans?: number;
  user_correction_rate?: number;
  egl?: number;
}

export interface EvolutionMetrics {
  daily: EvolutionMetricsRow[];
  egl_7d: number;
  egl_all_time: number;
}

const EVO_TYPE_LABELS: Record<string, string> = {
  rule_added: "规则+",
  rule_retired: "规则-",
  example_added: "示例+",
  skill_pending: "技能待确认",
  skill_generated: "技能生成",
  skill_confirmed: "技能确认",
  skill_refined: "技能优化",
  skill_retired: "技能归档",
  evolution_run: "运行",
  auto_rollback: "回滚",
  memory_knowledge_added: "记忆+",
  memory_extraction_parse_failed: "记忆解析失败",
};

/** 从 reason 中解析「方向: xxx」用于展示 */
function parseDirection(reason: string): string {
  if (!reason) return "";
  const m = reason.match(/方向:\s*([^；;]+)/);
  return m ? m[1].trim() : "";
}

interface EvolutionTabProps {
  evolutionLog: EvolutionLogItem[];
  metrics?: EvolutionMetrics | null;
}

export function EvolutionTab({ evolutionLog, metrics }: EvolutionTabProps) {
  const daily = metrics?.daily ?? [];

  return (
    <div className="space-y-4">
      {/* 系统指标：始终展示该区块，便于用户看到 EGL 等 */}
      <div className="space-y-2">
        <p className="text-xs text-slate-500">系统指标趋势（最近 7 天）</p>
        {metrics == null ? (
          <p className="text-xs text-slate-500 py-2">暂无指标数据（需使用一段时间后由引擎生成）</p>
        ) : (
          <>
            {daily.length > 0 ? (
              <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800/50 text-slate-400">
                      <th className="text-left py-2 px-2 font-medium">日期</th>
                      <th className="text-right py-2 px-2 font-medium">成功率</th>
                      <th className="text-right py-2 px-2 font-medium">Replan</th>
                      <th className="text-right py-2 px-2 font-medium">纠正率</th>
                      <th className="text-right py-2 px-2 font-medium">EGL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((row, i) => (
                      <tr key={row.date ?? i} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                        <td className="py-1.5 px-2 text-slate-400">{row.date ?? "-"}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">
                          {row.first_success_rate != null ? `${Math.round(row.first_success_rate * 100)}%` : "-"}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-300">
                          {row.avg_replans != null ? row.avg_replans.toFixed(1) : "-"}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-300">
                          {row.user_correction_rate != null ? `${Math.round(row.user_correction_rate * 100)}%` : "-"}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-300">
                          {row.egl != null ? row.egl.toFixed(1) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="text-xs text-slate-400">
              近7天累计 EGL: <span className="font-medium text-slate-300">{(metrics.egl_7d ?? 0).toFixed(1)}</span>
              {" | "}
              全量 EGL: <span className="font-medium text-slate-300">{(metrics.egl_all_time ?? 0).toFixed(1)}</span>
            </p>
            <p className="text-[10px] text-slate-500 max-w-md">
              EGL = 每 1000 次「有工具调用的决策」中新增的进化条数（规则/示例/技能）。0 表示暂无产出；约 10～100 表示有稳定学习；过高需结合纠正率看是否过拟合。与「成功率↑、纠正率↓」一起看更准。
            </p>
            {((metrics.egl_7d ?? 0) > 200 || (metrics.egl_all_time ?? 0) > 200) && (
              <p className="text-[10px] text-amber-400/90 max-w-md">
                EGL 偏高：可设环境变量降频 — <code className="bg-slate-700/50 px-0.5 rounded">SKILLLITE_EVOLUTION_DECISION_THRESHOLD=20</code>（决策数≥20 才触发）、<code className="bg-slate-700/50 px-0.5 rounded">SKILLLITE_EVOLUTION_INTERVAL_SECS=3600</code>（周期 1 小时）、<code className="bg-slate-700/50 px-0.5 rounded">SKILLLITE_MAX_EVOLUTIONS_PER_DAY=10</code>（每日上限）。
              </p>
            )}
          </>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs text-slate-500">进化事件明细（时间倒序，共 {evolutionLog.length} 条）</p>
      {evolutionLog.length === 0 ? (
        <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
          暂无进化记录
        </p>
      ) : (
        <div className="rounded-lg border border-slate-700/50 overflow-hidden max-h-[min(320px,50vh)] overflow-y-auto">
          <table className="w-full text-xs table-fixed">
            <thead className="sticky top-0 bg-slate-800/95 z-10">
              <tr className="text-slate-400">
                <th className="text-left py-1.5 px-2 font-medium w-0 whitespace-nowrap" style={{ width: "7.5em" }}>时间</th>
                <th className="text-left py-1.5 px-2 font-medium w-0 whitespace-nowrap" style={{ width: "5.5em" }}>类型</th>
                <th className="text-left py-1.5 px-2 font-medium w-0 whitespace-nowrap" style={{ width: "8em" }}>方向</th>
                <th className="text-left py-1.5 px-2 font-medium truncate" style={{ width: "11em" }}>目标</th>
                <th className="text-left py-1.5 px-2 font-medium min-w-0">说明</th>
              </tr>
            </thead>
            <tbody>
              {evolutionLog.map((e, i) => {
                const direction = parseDirection(e.reason ?? "");
                return (
                  <tr key={i} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                    <td className="py-1 px-2 text-slate-500 whitespace-nowrap" style={{ width: "7.5em" }}>
                      {e.ts ? new Date(e.ts).toLocaleString("zh-CN") : "-"}
                    </td>
                    <td className="py-1 px-2" style={{ width: "5.5em" }}>
                      <span className="px-1 py-0.5 rounded bg-slate-700/50 text-slate-300 text-[10px]">
                        {EVO_TYPE_LABELS[e.type] ?? e.type}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-slate-400 truncate" style={{ width: "8em" }} title={direction || undefined}>
                      {direction ? (
                        <span className="text-amber-200/90">{direction}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-1 px-2 font-mono text-slate-400 truncate" style={{ width: "11em" }} title={e.target_id}>
                      {e.target_id || "-"}
                    </td>
                    <td className="py-1 px-2 text-slate-400 truncate min-w-0" title={e.reason || ""}>
                      {e.reason || "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
