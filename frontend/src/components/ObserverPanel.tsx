import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { evotownEvents } from "../phaser/events";

/** 与 TownScene 一致的 agent 颜色（按 agentId 哈希） */
const AGENT_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e", "#14b8a6", "#84cc16",
];
function getAgentColor(agentId: string): string {
  const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}
import { useEvotownStore } from "../store/evotownStore";
import { TaskInjectorBar } from "./TaskInjectorBar";
import { EvolutionTimeline } from "./EvolutionTimeline";
import { MetricsDashboard } from "./MetricsDashboard";
import { AgentDetail } from "./AgentDetail";
import { ArenaControl } from "./ArenaControl";
import { AgentGraveyard } from "./AgentGraveyard";

type TabId = "timeline" | "metrics" | "agents" | "arena" | "graveyard";

export function ObserverPanel() {
  const [taskInput, setTaskInput] = useState("");
  const [tab, setTab] = useState<TabId>("arena");
  const [agentDetailInitialTab, setAgentDetailInitialTab] = useState<
    "rules" | "skills" | "decisions" | "evolution" | "soul" | undefined
  >(undefined);
  const agents = useEvotownStore((s) => s.agents);
  const selectedAgentId = useEvotownStore((s) => s.selectedAgentId);
  const evolutionEvents = useEvotownStore((s) => s.evolutionEvents);
  const setSelectedAgent = useEvotownStore((s) => s.setSelectedAgent);
  const setExperimentInfo = useEvotownStore((s) => s.setExperimentInfo);
  const experimentInfo = useEvotownStore((s) => s.experimentInfo);
  const [tokenUsage, setTokenUsage] = useState<{ prompt_tokens: number; completion_tokens: number; total_tokens: number } | null>(null);

  useEffect(() => {
    fetch("/config/experiment")
      .then((r) => r.json())
      .then((d) => setExperimentInfo({ experiment_id: d.experiment_id ?? null, config: d.config ?? null }))
      .catch(() => {});
  }, [setExperimentInfo]);

  useEffect(() => {
    const refresh = () => {
      fetch("/monitor/token_usage")
        .then((r) => r.json())
        .then(setTokenUsage)
        .catch(() => setTokenUsage(null));
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  // 数据刷新后恢复滚动位置，避免自动跳到顶部
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (el && savedScrollTop.current > 0) {
      el.scrollTop = savedScrollTop.current;
    }
  }, [agents, evolutionEvents]);

  // Agent 同步已由 useAgentSync 统一处理，ObserverPanel 仅消费 store

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);

  const [createSoulType, setCreateSoulType] = useState<"conservative" | "aggressive" | "balanced">("balanced");
  const createAgent = async () => {
    try {
      const res = await fetch("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_dir: null, soul_type: createSoulType }),
      });
      const data = await res.json();
      if (!res.ok || !data) return;
      evotownEvents.emit("request_sync", {});
    } catch (err) {
      console.warn("[evotown] createAgent failed", err);
    }
  };

  const [injectFeedback, setInjectFeedback] = useState("");
  const injectTask = async () => {
    if (!taskInput.trim() || agents.length === 0) return;
    const agentId = agents[0].id;
    const task = taskInput;
    setTaskInput("");
    try {
      const res = await fetch("/tasks/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, task }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInjectFeedback("任务已注入 → 任务中心");
        setTimeout(() => setInjectFeedback(""), 2000);
        const payload = { agent_id: agentId, balance: agents[0].balance };
        evotownEvents.emit("agent_created", payload);
        evotownEvents.emit("sprite_move", {
          agent_id: agentId,
          from: "广场",
          to: "任务中心",
          reason: "task",
        });
        // 注入后立即请求 Phaser 从 API 同步，确保 NPC 出现（兜底 WS 未连接或时序问题）
        evotownEvents.emit("request_sync", {});
      } else {
        const err = data?.error ?? "注入失败";
        setInjectFeedback(String(err));
        setTimeout(() => setInjectFeedback(""), 2000);
      }
    } catch (err) {
      console.warn("[evotown] injectTask failed", err);
      setInjectFeedback("注入失败");
      setTimeout(() => setInjectFeedback(""), 2000);
    }
  };

  const [evolveFeedback, setEvolveFeedback] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const removeAgent = useEvotownStore((s) => s.removeAgent);

  const deleteAgent = async (agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`确定要删除 Agent「${agentId}」吗？删除后可从竞技场重新创建。`)) return;
    setDeletingId(agentId);
    try {
      const res = await fetch(`/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        removeAgent(agentId);
        evotownEvents.emit("agent_eliminated", { agent_id: agentId, reason: "user_deleted" });
        evotownEvents.emit("request_sync", {});
        if (selectedAgentId === agentId) {
          setSelectedAgent(null);
          setAgentDetailInitialTab(undefined);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? "删除失败");
      }
    } catch (err) {
      console.warn("[evotown] delete agent failed", err);
      alert("删除失败，请检查网络");
    } finally {
      setDeletingId(null);
    }
  };

  const triggerEvolve = async () => {
    if (agents.length === 0) return;
    const agentId = (selectedAgentId && agents.some((a) => a.id === selectedAgentId))
      ? selectedAgentId
      : agents[0].id;
    try {
      const res = await fetch(`/agents/${agentId}/evolve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        evotownEvents.emit("sprite_move", {
          agent_id: agentId,
          from: "广场",
          to: "进化神殿",
          reason: "forced_evolution",
        });
        const msg = data.message || (data.ok ? "进化已触发" : "进化未产生变更");
        setEvolveFeedback(msg.slice(0, 80));
        setTimeout(() => setEvolveFeedback(""), 4000);
      } else {
        setEvolveFeedback(data.error || "进化失败");
        setTimeout(() => setEvolveFeedback(""), 4000);
      }
    } catch (err) {
      console.warn("[evotown] triggerEvolve failed", err);
      setEvolveFeedback("请求失败");
      setTimeout(() => setEvolveFeedback(""), 3000);
    }
  };

  return (
    <div className="w-[min(380px,40%)] min-w-[260px] max-w-[420px] flex flex-col shrink-0 bg-[#1e293b] backdrop-blur-sm border-l border-slate-600/50 shadow-evo-panel relative">
      {/* 紧凑头部：观测面板 + 实验 ID */}
      <div className="px-3 py-3 sm:px-4 sm:py-3.5 border-b border-slate-600/50 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 min-w-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-200 tracking-wide flex items-center gap-2">
              <span className="w-1.5 h-3.5 sm:h-4 rounded-full bg-evo-accent shrink-0" />
              <span className="truncate">观测面板</span>
            </h2>
            <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">监控与操控智能体</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            {experimentInfo.experiment_id && (
              <p className="text-[10px] text-slate-600 font-mono truncate sm:max-w-[180px]" title={experimentInfo.experiment_id}>
                实验: {experimentInfo.experiment_id}
              </p>
            )}
            {tokenUsage && tokenUsage.total_tokens > 0 && (
              <p className="text-[10px] text-slate-500" title={`输入 ${tokenUsage.prompt_tokens.toLocaleString()} / 输出 ${tokenUsage.completion_tokens.toLocaleString()}`}>
                Token: {(tokenUsage.total_tokens / 1000).toFixed(1)}K
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tab 栏：支持横向滚动，小屏不溢出 */}
      <div className="flex items-stretch border-b border-slate-600/50 shrink-0 overflow-x-auto [scrollbar-width:thin]">
        <div className="flex items-center min-w-0 flex-1">
          {[
            { id: "arena" as TabId, label: "竞技场" },
            { id: "agents" as TabId, label: "智能体" },
            { id: "graveyard" as TabId, label: "墓园" },
            { id: "timeline" as TabId, label: "时间线" },
            { id: "metrics" as TabId, label: "EGL" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[56px] py-2 sm:py-2.5 px-2 text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                tab === t.id
                  ? "text-evo-accent border-b-2 border-evo-accent"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={createAgent}
          className="mx-2 my-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 text-[10px] font-medium bg-emerald-600/80 hover:bg-emerald-500 rounded text-white shrink-0 self-center"
        >
          + 新建
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={(e) => { savedScrollTop.current = (e.target as HTMLDivElement).scrollTop; }}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-4 sm:space-y-5"
      >
        {tab === "agents" && (
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">智能体</h3>
            <div className="flex gap-2 items-center">
              <select
                value={createSoulType}
                onChange={(e) => setCreateSoulType(e.target.value as "conservative" | "aggressive" | "balanced")}
                className="flex-1 py-2 px-3 rounded-lg bg-slate-800/50 border border-slate-600/50 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-evo-accent/50"
              >
                <option value="balanced">均衡</option>
                <option value="conservative">保守</option>
                <option value="aggressive">激进</option>
              </select>
              <button
                onClick={createAgent}
                className="flex-1 py-2.5 px-4 bg-emerald-600/90 hover:bg-emerald-500 rounded-lg text-sm font-medium text-white transition-colors shadow-lg shadow-emerald-900/30 hover:shadow-emerald-800/40"
              >
                + 创建 Agent
              </button>
            </div>
            <div className="rounded-lg bg-slate-900/50 border border-slate-600/50 p-3 min-h-[48px]">
              <p className="text-xs text-slate-500 mb-1">当前 Agent</p>
              {agents.length > 0 ? (
                <div className="space-y-1">
                  {agents.map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center gap-1.5 rounded transition-colors ${
                        selectedAgentId === a.id
                          ? "bg-evo-accent/20"
                          : "hover:bg-slate-800/50"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setSelectedAgent(a.id);
                          setAgentDetailInitialTab(undefined);
                        }}
                        className={`flex-1 flex items-center gap-1.5 text-left px-2 py-1.5 text-sm font-mono truncate min-w-0 ${
                          selectedAgentId === a.id ? "text-evo-accent" : "text-slate-300"
                        }`}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getAgentColor(a.id) }}
                        />
                        <span className="truncate min-w-0">{a.id}</span>
                        <span className="text-amber-400 shrink-0">({a.balance})</span>
                        <span className="shrink-0 text-[10px] text-slate-500" title="任务 成功/总数 · 进化 成功/总数">
                          📋{a.success_count ?? 0}/{a.task_count ?? 0} ✨{a.evolution_success_count ?? 0}/{a.evolution_count ?? 0}
                        </span>
                      </button>
                      <button
                        onClick={(e) => deleteAgent(a.id, e)}
                        disabled={deletingId === a.id}
                        className="shrink-0 px-1.5 py-1 text-[10px] text-slate-500 hover:text-rose-400 hover:bg-rose-600/20 rounded disabled:opacity-50"
                        title="删除 Agent"
                      >
                        {deletingId === a.id ? "…" : "删除"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 italic text-sm">暂无</p>
              )}
            </div>
          </section>
        )}

        {tab === "agents" && (
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">任务与进化</h3>
            <TaskInjectorBar
              agents={agents}
              taskInput={taskInput}
              onTaskInputChange={setTaskInput}
              onInject={injectTask}
              onEvolve={triggerEvolve}
              feedback={evolveFeedback || injectFeedback}
            />
          </section>
        )}

        {tab === "arena" && <ArenaControl />}
        {tab === "graveyard" && <AgentGraveyard />}
        {tab === "timeline" && (
          <EvolutionTimeline
            agents={agents}
            onSelectAgent={(agentId, evoTab) => {
              setSelectedAgent(agentId);
              setAgentDetailInitialTab(evoTab === "evolution" ? "evolution" : undefined);
            }}
          />
        )}
        {tab === "metrics" && <MetricsDashboard agents={agents} />}

      </div>

      {selectedAgentId && (
        <AgentDetail
          agentId={selectedAgentId}
          onClose={() => {
            setSelectedAgent(null);
            setAgentDetailInitialTab(undefined);
          }}
          initialTab={agentDetailInitialTab}
        />
      )}
    </div>
  );
}
