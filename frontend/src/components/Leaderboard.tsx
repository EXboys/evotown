/** 实时排行榜 — 按余额从高到低排序，支持排名翻转箭头 */
import { useRef } from "react";
import { useEvotownStore } from "../store/evotownStore";
import { WarriorPortraitCanvas } from "./WarriorPortraitCanvas";

/** 根据 team_id 哈希返回 NES 风格阵营颜色 */
function teamBadgeColor(teamId: string): string {
  const hash = teamId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  const palette = ["#ef4444", "#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#eab308"];
  return palette[Math.abs(hash) % palette.length];
}


export function Leaderboard() {
  const agents = useEvotownStore((s) => s.agents);
  const selectedAgentId = useEvotownStore((s) => s.selectedAgentId);
  const setSelectedAgent = useEvotownStore((s) => s.setSelectedAgent);

  // 按余额降序排列（余额相同时，任务数多的靠前）
  const ranked = [...agents].sort((a, b) =>
    b.balance !== a.balance ? b.balance - a.balance : (b.task_count ?? 0) - (a.task_count ?? 0)
  );

  // 追踪上一帧的排名，用于计算排名变化箭头
  const prevRanksRef = useRef<Record<string, number>>({});
  const currentRanks: Record<string, number> = {};
  ranked.forEach((a, i) => { currentRanks[a.id] = i; });

  const rankDeltas: Record<string, number> = {};
  ranked.forEach((a) => {
    const prev = prevRanksRef.current[a.id];
    if (prev != null) {
      rankDeltas[a.id] = prev - currentRanks[a.id]; // 正数 = 上升，负数 = 下降
    }
  });
  prevRanksRef.current = currentRanks;

  // 最高余额，用于绘制比例条
  const maxBalance = ranked.length > 0 ? Math.max(...ranked.map((a) => a.balance), 1) : 1;

  if (agents.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500 italic">
        暂无 Agent，请先创建
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
        <span className="text-amber-400">⚔️</span> 军功榜
        <span className="text-slate-600 font-normal">({ranked.length})</span>
      </h3>

      <div className="space-y-1.5">
        {ranked.map((agent, idx) => {
          const rank = idx + 1;
          const delta = rankDeltas[agent.id] ?? 0;
          const isSelected = selectedAgentId === agent.id;
          const balancePct = Math.min((agent.balance / maxBalance) * 100, 100);
          const successRate =
            (agent.task_count ?? 0) > 0
              ? Math.round(((agent.success_count ?? 0) / (agent.task_count ?? 1)) * 100)
              : null;

          // 余额条颜色
          const barColor =
            agent.balance <= 20
              ? "bg-red-500"
              : agent.balance <= 60
              ? "bg-amber-500"
              : "bg-emerald-500";

          return (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
              className={`w-full text-left rounded-xl border p-3 transition-all ${
                isSelected
                  ? "border-evo-accent/60 bg-evo-accent/10 shadow-inner"
                  : "border-slate-700/40 bg-slate-800/40 hover:bg-slate-800/70"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* 名次 */}
                <span
                  className={`text-sm font-bold w-5 shrink-0 text-center ${
                    rank === 1
                      ? "text-amber-400"
                      : rank === 2
                      ? "text-slate-300"
                      : rank === 3
                      ? "text-orange-400"
                      : "text-slate-500"
                  }`}
                >
                  {rank}
                </span>

                {/* 队伍颜色标识旗 */}
                {agent.team_id && (
                  <span
                    title={agent.team_name ?? agent.team_id}
                    style={{ backgroundColor: teamBadgeColor(agent.team_id) }}
                    className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-sm text-[8px] font-bold text-white leading-none"
                  >
                    {(agent.team_name ?? agent.team_id).slice(0, 1)}
                  </span>
                )}

                {/* 武将像素头像（32×48 → scale=1 → 32×48px，裁剪显示上半身） */}
                <div className="shrink-0 overflow-hidden rounded-sm" style={{ width: 20, height: 28 }}>
                  <WarriorPortraitCanvas
                    agentDisplayName={agent.display_name || agent.id}
                    scale={1}
                    showLabel={false}
                  />
                </div>

                {/* 名字 + 状态 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-slate-200 truncate">
                      {agent.display_name ? `${agent.display_name}(${agent.id})` : agent.id}
                    </span>
                    {agent.in_task && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" title="执行中" />
                    )}
                    {agent.status === "bankrupt" && (
                      <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-red-900/50 text-red-400 border border-red-700/40">
                        💀
                      </span>
                    )}
                  </div>
                  {/* 余额条 */}
                  <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${balancePct}%` }}
                    />
                  </div>
                </div>

                {/* 军功数字 */}
                <span className={`text-xs font-mono font-semibold shrink-0 ${
                  agent.balance <= 20 ? "text-red-400" : agent.balance <= 60 ? "text-amber-400" : "text-emerald-400"
                }`}>
                  {agent.balance} 功
                </span>

                {/* 排名变化箭头 */}
                <span className="w-4 shrink-0 text-center text-[10px] font-bold">
                  {delta > 0 ? (
                    <span className="text-emerald-400" title={`上升 ${delta} 位`}>↑</span>
                  ) : delta < 0 ? (
                    <span className="text-red-400" title={`下降 ${Math.abs(delta)} 位`}>↓</span>
                  ) : null}
                </span>
              </div>

              {/* 统计数据行 */}
              <div className="mt-1.5 pl-11 flex items-center gap-3 text-[10px] text-slate-500">
                <span title="任务 成功/总数">📋 {agent.success_count ?? 0}/{agent.task_count ?? 0}</span>
                {successRate !== null && (
                  <span className={successRate >= 60 ? "text-emerald-500" : "text-amber-500"}>
                    {successRate}%
                  </span>
                )}
                <span title="进化次数">✨ {agent.evolution_count ?? 0}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

