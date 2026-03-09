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
      push("💀", `${getAgentName(d.agent_id)} 兵败身死，入英魂祠！`, "#f87171");
    };
    const onEvolution = (d: { agent_id: string; event_type?: string; type?: string }) => {
      const et = d.event_type || d.type || "";
      const msg =
        et === "rule_added" ? "习得新兵法" :
        et === "skill_generated" ? "创制新技能" : "进化触发";
      push("⚡", `${getAgentName(d.agent_id)} ${msg}！`, "#fbbf24");
    };
    const onTaskComplete = (d: { agent_id: string; success: boolean; balance: number }) => {
      if (d.success) {
        push("✅", `${getAgentName(d.agent_id)} 军令完成，军功 ${d.balance}`, "#86efac");
      } else {
        push("❌", `${getAgentName(d.agent_id)} 军令未竟，军功 ${d.balance}`, "#fca5a5");
      }
    };
    const onCreated = (d: { agent_id: string; display_name?: string }) => {
      const name = d.display_name || d.agent_id;
      push("🌟", `${name} 奉命入阵！`, "#a5b4fc");
    };

    const onAgentMessage = (d: { from_name: string; to_name: string; content: string; msg_type: string }) => {
      const icon = d.msg_type === "challenge" ? "⚔️" : d.msg_type === "alliance" ? "🤝" : d.msg_type === "strategy" ? "📋" : "💬";
      // 截断消息正文至 60 字，保留更多文言文内容
      const excerpt = d.content.length > 60 ? d.content.slice(0, 60) + "…" : d.content;
      push(icon, `${d.from_name} → ${d.to_name}：「${excerpt}」`, "#93c5fd");
    };
    const onAgentDecision = (d: { display_name: string; solo_preference: boolean; evolution_focus: string; prev_evolution_focus: string; reason: string }) => {
      const stance = d.solo_preference ? "独行" : "入队";
      const focus = d.evolution_focus || "无偏好";
      const prevFocus = d.prev_evolution_focus || "无";
      const changed = d.evolution_focus !== d.prev_evolution_focus;
      const detail = changed ? `${prevFocus}→${focus}` : focus;
      push("🧠", `${d.display_name} 自决·${stance}·${detail}`, "#c4b5fd");
    };

    // 任务执行日志：实时显示 tool_call 和 tool_result
    const onTaskLog = (d: { agent_id: string; agent_name: string; event: string; tool_name: string; arguments: string; result: string; is_error: boolean }) => {
      const icon = d.event === "tool_call" ? "🔧" : "📤";
      const color = d.is_error ? "#f87171" : "#60a5fa";
      // 截断参数显示
      const args = d.arguments.length > 30 ? d.arguments.slice(0, 30) + "…" : d.arguments;
      push(icon, `${d.agent_name} ${d.tool_name}(${args})`, color);
    };

    evotownEvents.on("agent_eliminated", onEliminated);
    evotownEvents.on("evolution_event", onEvolution);
    evotownEvents.on("task_complete", onTaskComplete);
    evotownEvents.on("agent_created", onCreated);
    evotownEvents.on("agent_message", onAgentMessage);
    evotownEvents.on("agent_decision", onAgentDecision);
    evotownEvents.on("task_log", onTaskLog);

    return () => {
      evotownEvents.off("agent_eliminated", onEliminated);
      evotownEvents.off("evolution_event", onEvolution);
      evotownEvents.off("task_complete", onTaskComplete);
      evotownEvents.off("agent_created", onCreated);
      evotownEvents.off("agent_message", onAgentMessage);
      evotownEvents.off("agent_decision", onAgentDecision);
      evotownEvents.off("task_log", onTaskLog);
    };
  }, []);

  // 新事件到达时自动滚到最右边
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="w-full bg-black border-t-2 border-amber-400 px-2 py-[3px] flex items-center gap-0 overflow-hidden select-none">
      {/* FC 状态栏标签 */}
      <span className="shrink-0 text-amber-400 text-[10px] font-mono font-bold mr-2 tracking-widest border-r border-amber-800 pr-2">
        ▶战报
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
            className="shrink-0 text-[11px] font-mono whitespace-nowrap"
            style={{ color: item.color }}
          >
            {item.emoji} {item.text}
            <span className="text-amber-900 mx-2">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

