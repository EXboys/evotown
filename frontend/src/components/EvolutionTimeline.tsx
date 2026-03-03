/** 进化时间线 — 横向多角色对比，进化事件旗帜 */
import { useEffect, useState } from "react";
import { useEvotownStore, type EvolutionEventItem } from "../store/evotownStore";

const AGENT_COLORS: Record<string, string> = {
  agent_1: "#38bdf8",
  agent_2: "#a78bfa",
  agent_3: "#34d399",
  agent_4: "#fbbf24",
  agent_5: "#f87171",
};

function agentColor(id: string) {
  return AGENT_COLORS[id] ?? "#94a3b8";
}

function eventLabel(type: string): string {
  const map: Record<string, string> = {
    rule_added: "规则+",
    rule_retired: "规则-",
    skill_generated: "技能",
    example_added: "示例+",
    auto_rollback: "回滚",
    evolution_run: "运行",
  };
  return map[type] ?? type;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

export function EvolutionTimeline({ agents }: { agents: { id: string }[] }) {
  const [logByAgent, setLogByAgent] = useState<Record<string, EvolutionEventItem[]>>({});
  const evolutionEvents = useEvotownStore((s) => s.evolutionEvents);
  const setEvolutionLog = useEvotownStore((s) => s.setEvolutionLog);

  const agentIds = agents.map((a) => a.id).join(",");
  useEffect(() => {
    const load = async () => {
      const next: Record<string, EvolutionEventItem[]> = {};
      for (const a of agents) {
        try {
          const r = await fetch(`/agents/${a.id}/evolution_log?limit=50`);
          const data = await r.json();
          const items: EvolutionEventItem[] = data.map((row: { ts?: string; type?: string; target_id?: string; reason?: string }) => ({
            agent_id: a.id,
            ts: row.ts ?? "",
            type: row.type ?? "evolution",
            target_id: row.target_id,
            reason: row.reason,
          }));
          setEvolutionLog(a.id, items);
          next[a.id] = items;
        } catch {
          next[a.id] = [];
        }
      }
      setLogByAgent(next);
    };
    if (agents.length) load();
  }, [agentIds]);

  // 合并 API 历史 + 实时 WS 事件，按时间排序
  const merged: EvolutionEventItem[] = [];
  const seen = new Set<string>();
  for (const a of agents) {
    const api = logByAgent[a.id] ?? [];
    for (const e of api) {
      const key = `${e.agent_id}:${e.ts}:${e.type}:${e.target_id ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(e);
      }
    }
  }
  for (const e of evolutionEvents) {
    if (!agents.some((a) => a.id === e.agent_id)) continue;
    const key = `${e.agent_id}:${e.ts}:${e.type}:${e.target_id ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(e);
    }
  }
  merged.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (agents.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-6 text-center">暂无 Agent，请先创建</div>
    );
  }

  const hasAnyEvents = merged.length > 0;

  return (
    <div className="space-y-4">
      {!hasAnyEvents && (
        <p className="text-xs text-slate-500">
          进化时间线展示规则、技能等进化事件。每次进化运行（含无变更）会记录一条事件。
          请执行任务后触发进化，或等待自动进化。
        </p>
      )}
      <div className="overflow-x-auto pb-2 -mx-1">
        <div className="min-w-[400px]">
          {/* 时间轴刻度 */}
          <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-2">
            {hasAnyEvents && (
              <>
                <span>{formatTime(merged[0].ts)}</span>
                <span className="flex-1 border-t border-dashed border-slate-600" />
                <span>{formatTime(merged[merged.length - 1].ts)}</span>
              </>
            )}
          </div>
          {/* 每行一个 Agent */}
          {agents.map((a) => {
            const events = merged.filter((e) => e.agent_id === a.id);
            const color = agentColor(a.id);
            return (
              <div key={a.id} className="flex items-center gap-2 py-1.5 min-h-[28px]">
                <span className="w-16 text-xs text-slate-400 truncate" title={a.id}>
                  {a.id}
                </span>
                <div className="flex-1 flex items-center gap-0.5 relative h-6">
                  {events.length === 0 ? (
                    <span className="text-[10px] text-slate-600 italic">暂无进化事件</span>
                  ) : null}
                  {events.map((e, i) => (
                    <div
                      key={`${e.ts}-${e.type}-${e.target_id ?? i}`}
                      className="group relative flex items-center justify-center w-5 h-5 rounded-full border-2 cursor-pointer transition-transform hover:scale-110"
                      style={{
                        backgroundColor: `${color}22`,
                        borderColor: color,
                      }}
                      title={`${eventLabel(e.type)} ${e.reason ?? ""} ${formatTime(e.ts)}`}
                    >
                      <span className="text-[10px] font-medium" style={{ color }}>
                        {eventLabel(e.type).slice(0, 1)}
                      </span>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-slate-800 border border-slate-600 text-[10px] text-slate-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {eventLabel(e.type)} · {formatTime(e.ts)}
                        {e.reason && ` · ${e.reason}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
