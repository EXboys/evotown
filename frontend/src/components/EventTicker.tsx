/**
 * EventTicker — 底部滚动事件播报栏
 * 监听 evotownEvents，实时显示关键事件（破产、进化、任务完成等）
 */
import { useEffect, useRef, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";

interface TickerItem {
  id: number;
  text: string;
  emoji: string;
  color: string;
}

let _tickerSeq = 0;

/** 从 store 获取 agent 的展示名（有名字用名字，否则用 ID） */
function getAgentName(agentId: string): string {
  const agents = useEvotownStore.getState().agents;
  const agent = agents.find((a) => a.id === agentId);
  return agent?.display_name || agentId;
}

export function EventTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const push = (emoji: string, text: string, color: string) => {
    const item: TickerItem = { id: _tickerSeq++, emoji, text, color };
    setItems((prev) => [...prev.slice(-40), item]); // 最多保留 40 条
  };

  useEffect(() => {
    const onEliminated = (d: { agent_id: string; reason?: string }) => {
      push("💀", `${getAgentName(d.agent_id)} 破产出局！`, "#f87171");
    };
    const onEvolution = (d: { agent_id: string; event_type?: string; type?: string }) => {
      const et = d.event_type || d.type || "";
      const msg =
        et === "rule_added" ? "学到了新规则" :
        et === "skill_generated" ? "生成了新技能" : "进化触发";
      push("⚡", `${getAgentName(d.agent_id)} ${msg}！`, "#fbbf24");
    };
    const onTaskComplete = (d: { agent_id: string; success: boolean; balance: number }) => {
      if (d.success) {
        push("✅", `${getAgentName(d.agent_id)} 完成任务，余额 $${d.balance}`, "#86efac");
      } else {
        push("❌", `${getAgentName(d.agent_id)} 任务失败，余额 $${d.balance}`, "#fca5a5");
      }
    };
    const onCreated = (d: { agent_id: string; display_name?: string }) => {
      const name = d.display_name || d.agent_id;
      push("🌟", `${name} 加入竞技场！`, "#a5b4fc");
    };

    evotownEvents.on("agent_eliminated", onEliminated);
    evotownEvents.on("evolution_event", onEvolution);
    evotownEvents.on("task_complete", onTaskComplete);
    evotownEvents.on("agent_created", onCreated);

    return () => {
      evotownEvents.off("agent_eliminated", onEliminated);
      evotownEvents.off("evolution_event", onEvolution);
      evotownEvents.off("task_complete", onTaskComplete);
      evotownEvents.off("agent_created", onCreated);
    };
  }, []);

  // 新事件到达时自动滚到最右边
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="w-full bg-slate-950/90 border-t border-slate-700/60 px-2 py-1 flex items-center gap-0 overflow-hidden select-none">
      {/* 标签 */}
      <span className="shrink-0 text-amber-400 text-[10px] font-bold mr-2 tracking-widest">
        📡 LIVE
      </span>
      {/* 滚动区域 */}
      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((item) => (
          <span
            key={item.id}
            className="shrink-0 text-[11px] font-medium whitespace-nowrap"
            style={{ color: item.color }}
          >
            {item.emoji} {item.text}
            <span className="text-slate-600 mx-2">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

