/**
 * EventTicker — 底部战报卷轴
 * 监听 evotownEvents，实时显示关键事件，按类型区分样式
 */
import { useEffect, useRef, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";

export type TickerEventType =
  | "eliminated"
  | "evolution"
  | "task_success"
  | "task_fail"
  | "created"
  | "message_challenge"
  | "message_alliance"
  | "message_strategy"
  | "message_other"
  | "decision"
  | "task_log";

interface TickerItem {
  id: number;
  text: string;
  emoji: string;
  type: TickerEventType;
}

let _tickerSeq = 0;

/** 从 store 获取 agent 的展示名 */
function getAgentName(agentId: string): string {
  const agents = useEvotownStore.getState().agents;
  const agent = agents.find((a) => a.id === agentId);
  return agent?.display_name || agentId;
}

const EVENT_STYLES: Record<
  TickerEventType,
  { bg: string; border: string; text: string; accent: string; label?: string }
> = {
  eliminated: {
    bg: "bg-red-950/80",
    border: "border-red-800/70",
    text: "text-red-200",
    accent: "text-red-400",
    label: "败亡",
  },
  evolution: {
    bg: "bg-amber-950/70",
    border: "border-amber-600/60",
    text: "text-amber-200",
    accent: "text-amber-400",
    label: "进化",
  },
  task_success: {
    bg: "bg-emerald-950/50",
    border: "border-emerald-700/50",
    text: "text-emerald-200",
    accent: "text-emerald-400",
    label: "达成",
  },
  task_fail: {
    bg: "bg-rose-950/60",
    border: "border-rose-700/50",
    text: "text-rose-200",
    accent: "text-rose-400",
    label: "未竟",
  },
  created: {
    bg: "bg-indigo-950/50",
    border: "border-indigo-600/50",
    text: "text-indigo-200",
    accent: "text-indigo-400",
    label: "入阵",
  },
  message_challenge: {
    bg: "bg-red-950/40",
    border: "border-red-700/40",
    text: "text-slate-200",
    accent: "text-red-400",
    label: "战书",
  },
  message_alliance: {
    bg: "bg-teal-950/40",
    border: "border-teal-600/40",
    text: "text-slate-200",
    accent: "text-teal-400",
    label: "结盟",
  },
  message_strategy: {
    bg: "bg-sky-950/40",
    border: "border-sky-600/40",
    text: "text-slate-200",
    accent: "text-sky-400",
    label: "谋略",
  },
  message_other: {
    bg: "bg-slate-900/60",
    border: "border-slate-600/40",
    text: "text-slate-300",
    accent: "text-blue-400",
    label: "传讯",
  },
  decision: {
    bg: "bg-violet-950/40",
    border: "border-violet-600/40",
    text: "text-violet-200",
    accent: "text-violet-400",
    label: "自决",
  },
  task_log: {
    bg: "bg-slate-900/50",
    border: "border-slate-600/40",
    text: "text-slate-300",
    accent: "text-sky-400",
  },
};

function TickerCard({ item }: { item: TickerItem }) {
  const style = EVENT_STYLES[item.type];
  const isImportant = item.type === "eliminated" || item.type === "evolution";

  return (
    <div
      className={`
        shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-sm
        border-l-2 border-r ${style.bg} ${style.border}
        transition-all duration-200
        ${isImportant ? "ring-1 ring-amber-500/30 shadow-sm border-l-amber-500/50" : ""}
      `}
    >
      <span className={`${isImportant ? "text-base" : "text-sm"} ${style.accent} shrink-0`}>{item.emoji}</span>
      {style.label && (
        <span className={`${isImportant ? "text-[10px]" : "text-[9px]"} ${style.accent} font-bold uppercase tracking-wider shrink-0 border-r pr-2 border-current/40`}>
          {style.label}
        </span>
      )}
      <span className={`${isImportant ? "text-xs font-semibold" : "text-[11px] font-medium"} ${style.text} whitespace-nowrap`}>
        {item.text}
      </span>
    </div>
  );
}

export function EventTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const push = (emoji: string, text: string, type: TickerEventType) => {
    const item: TickerItem = { id: _tickerSeq++, emoji, text, type };
    setItems((prev) => [...prev.slice(-40), item]);
  };

  useEffect(() => {
    const onEliminated = (d: { agent_id: string; reason?: string }) => {
      push("💀", `${getAgentName(d.agent_id)} 兵败身死，入英魂祠！`, "eliminated");
    };
    const onEvolution = (d: { agent_id: string; event_type?: string; type?: string }) => {
      const et = d.event_type || d.type || "";
      const msg =
        et === "rule_added" ? "习得新兵法" :
        et === "skill_generated" ? "创制新技能" : "进化触发";
      push("⚡", `${getAgentName(d.agent_id)} ${msg}！`, "evolution");
    };
    const onTaskComplete = (d: { agent_id: string; success: boolean; balance: number }) => {
      if (d.success) {
        push("✅", `${getAgentName(d.agent_id)} 军令完成，军功 ${d.balance}`, "task_success");
      } else {
        push("❌", `${getAgentName(d.agent_id)} 军令未竟，军功 ${d.balance}`, "task_fail");
      }
    };
    const onCreated = (d: { agent_id: string; display_name?: string }) => {
      const name = d.display_name || d.agent_id;
      push("🌟", `${name} 奉命入阵！`, "created");
    };

    const onAgentMessage = (d: { from_name: string; to_name: string; content: string; msg_type: string }) => {
      const excerpt = d.content.length > 60 ? d.content.slice(0, 60) + "…" : d.content;
      const text = `${d.from_name} → ${d.to_name}：「${excerpt}」`;
      const type: TickerEventType =
        d.msg_type === "challenge" ? "message_challenge" :
        d.msg_type === "alliance" ? "message_alliance" :
        d.msg_type === "strategy" ? "message_strategy" : "message_other";
      const icon = d.msg_type === "challenge" ? "⚔️" : d.msg_type === "alliance" ? "🤝" : d.msg_type === "strategy" ? "📋" : "💬";
      push(icon, text, type);
    };
    const onAgentDecision = (d: { display_name: string; solo_preference: boolean; evolution_focus: string; prev_evolution_focus: string; reason: string }) => {
      const stance = d.solo_preference ? "独行" : "入队";
      const focus = d.evolution_focus || "无偏好";
      const prevFocus = d.prev_evolution_focus || "无";
      const changed = d.evolution_focus !== d.prev_evolution_focus;
      const detail = changed ? `${prevFocus}→${focus}` : focus;
      push("🧠", `${d.display_name} 自决·${stance}·${detail}`, "decision");
    };

    const onTaskLog = (d: { agent_id: string; agent_name: string; event: string; tool_name: string; arguments: string; result: string; is_error: boolean }) => {
      const icon = d.event === "tool_call" ? "🔧" : "📤";
      const args = d.arguments.length > 30 ? d.arguments.slice(0, 30) + "…" : d.arguments;
      push(icon, `${d.agent_name} ${d.tool_name}(${args})`, "task_log");
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

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="w-full relative border-t-2 border-amber-800/90 px-0 py-2 flex items-center overflow-hidden select-none bg-[linear-gradient(180deg,#1c1917_0%,#0f0d0b_50%,#1c1917_100%)] shadow-[0_-4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(251,191,36,0.08)]">
      {/* 卷轴左轴 */}
      <div className="shrink-0 w-9 h-10 flex items-center justify-center bg-gradient-to-r from-amber-900/80 to-transparent border-r-2 border-amber-700/70 rounded-r-md">
        <span className="text-amber-500/90 text-xs font-bold tracking-[0.25em]">战报</span>
      </div>
      {/* 竖线分隔 + 滚动区域 */}
      <div className="flex-1 flex items-center gap-0 min-w-0">
        <div className="shrink-0 w-px h-6 bg-amber-700/40" aria-hidden />
        <div
          ref={containerRef}
          className="flex-1 flex gap-2 overflow-x-auto scrollbar-none pl-2"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 shrink-0">
              {i > 0 && <div className="w-px h-5 bg-amber-800/30" aria-hidden />}
              <TickerCard item={item} />
            </div>
          ))}
        </div>
        <div className="shrink-0 w-px h-6 bg-amber-700/40" aria-hidden />
      </div>
      {/* 卷轴右轴 */}
      <div className="shrink-0 w-6 h-10 flex items-center justify-center bg-gradient-to-l from-amber-900/80 to-transparent border-l-2 border-amber-700/70 rounded-l-md">
        <span className="text-amber-700/70 text-[10px]">◆</span>
      </div>
    </div>
  );
}
