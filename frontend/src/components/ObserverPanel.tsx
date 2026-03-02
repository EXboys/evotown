import { useEffect, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";
import { TaskInjectorBar } from "./TaskInjectorBar";
import { EvolutionTimeline } from "./EvolutionTimeline";
import { MetricsDashboard } from "./MetricsDashboard";
import { AgentDetail } from "./AgentDetail";
import { ArenaControl } from "./ArenaControl";

type TabId = "timeline" | "metrics" | "agents" | "arena";

export function ObserverPanel() {
  const [taskInput, setTaskInput] = useState("");
  const [tab, setTab] = useState<TabId>("agents");
  const agents = useEvotownStore((s) => s.agents);
  const setAgents = useEvotownStore((s) => s.setAgents);
  const selectedAgentId = useEvotownStore((s) => s.selectedAgentId);
  const setSelectedAgent = useEvotownStore((s) => s.setSelectedAgent);

  const syncAgentsToPhaser = () => {
    const list = useEvotownStore.getState().agents;
    list.forEach((a) =>
      evotownEvents.emit("agent_created", { agent_id: a.id, balance: a.balance })
    );
  };

  useEffect(() => {
    fetch("/agents")
      .then((r) => r.json())
      .then((list: { id: string; balance: number }[]) => {
        setAgents(list);
        list.forEach((a) =>
          evotownEvents.emit("agent_created", { agent_id: a.id, balance: a.balance })
        );
      })
      .catch(() => {});
  }, [setAgents]);

  useEffect(() => {
    const handler = () => syncAgentsToPhaser();
    evotownEvents.on("phaser_ready", handler);
    const t1 = setTimeout(syncAgentsToPhaser, 300);
    const t2 = setTimeout(syncAgentsToPhaser, 600);
    const t3 = setTimeout(syncAgentsToPhaser, 1200);
    const t4 = setTimeout(syncAgentsToPhaser, 2500);
    return () => {
      evotownEvents.off("phaser_ready", handler);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  // agents 变化时同步到 Phaser（刷新后 store 有数据但 Phaser 可能刚就绪）
  useEffect(() => {
    if (agents.length > 0) {
      syncAgentsToPhaser();
    }
  }, [agents]);

  const createAgent = async () => {
    try {
      const res = await fetch("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_dir: null }),
      });
      const data = await res.json();
      if (!res.ok || !data) return;
      const list = await fetch("/agents").then((r) => r.json());
      if (Array.isArray(list)) {
        setAgents(list);
        list.forEach((a: { id: string; balance: number }) =>
          evotownEvents.emit("agent_created", { agent_id: a.id, balance: a.balance })
        );
      }
    } catch {
      // ignore
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
      if (res.ok) {
        setInjectFeedback("任务已注入 → 任务中心");
        setTimeout(() => setInjectFeedback(""), 2000);
        const payload = { agent_id: agentId, balance: agents[0].balance };
        evotownEvents.emit("agent_created", payload);
        setTimeout(() => {
          evotownEvents.emit("sprite_move", {
            agent_id: agentId,
            from: "广场",
            to: "任务中心",
            reason: "task",
          });
        }, 50);
      }
    } catch {
      setInjectFeedback("注入失败");
      setTimeout(() => setInjectFeedback(""), 2000);
    }
  };

  const triggerEvolve = async () => {
    if (agents.length === 0) return;
    const agentId = agents[0].id;
    const res = await fetch(`/agents/${agentId}/evolve`, { method: "POST" });
    if (res.ok) {
      evotownEvents.emit("sprite_move", {
        agent_id: agentId,
        from: "广场",
        to: "进化神殿",
        reason: "forced_evolution",
      });
    }
  };

  return (
    <div className="w-[380px] flex flex-col bg-[#1e293b] backdrop-blur-sm border-l border-slate-600/50 shadow-evo-panel relative">
      <div className="p-5 border-b border-slate-600/50">
        <h2 className="text-base font-semibold text-slate-200 tracking-wide flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full bg-evo-accent" />
          观测面板
        </h2>
        <p className="text-xs text-slate-500 mt-1">监控与操控智能体</p>
      </div>

      <div className="flex items-center border-b border-slate-600/50">
        {[
          { id: "agents" as TabId, label: "智能体" },
          { id: "arena" as TabId, label: "竞技场" },
          { id: "timeline" as TabId, label: "时间线" },
          { id: "metrics" as TabId, label: "EGL" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "text-evo-accent border-b-2 border-evo-accent"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={createAgent}
          className="ml-2 mr-2 px-2.5 py-1.5 text-[10px] font-medium bg-emerald-600/80 hover:bg-emerald-500 rounded text-white shrink-0"
        >
          + 新建
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {tab === "agents" && (
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">智能体</h3>
            <button
              onClick={createAgent}
              className="w-full py-2.5 px-4 bg-emerald-600/90 hover:bg-emerald-500 rounded-lg text-sm font-medium text-white transition-colors shadow-lg shadow-emerald-900/30 hover:shadow-emerald-800/40"
            >
              + 创建 Agent
            </button>
            <div className="rounded-lg bg-slate-900/50 border border-slate-600/50 p-3 min-h-[48px]">
              <p className="text-xs text-slate-500 mb-1">当前 Agent</p>
              {agents.length > 0 ? (
                <div className="space-y-1">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedAgent(a.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm font-mono truncate transition-colors ${
                        selectedAgentId === a.id
                          ? "bg-evo-accent/20 text-evo-accent"
                          : "text-slate-300 hover:bg-slate-800/50"
                      }`}
                    >
                      · {a.id} <span className="text-amber-400">({a.balance})</span>
                    </button>
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
              feedback={injectFeedback}
            />
          </section>
        )}

        {tab === "arena" && <ArenaControl />}
        {tab === "timeline" && <EvolutionTimeline agents={agents} />}
        {tab === "metrics" && <MetricsDashboard agents={agents} />}

        {(tab === "timeline" || tab === "metrics" || tab === "arena") && (
          <section className="pt-4 border-t border-slate-600/50">
            <TaskInjectorBar
              agents={agents}
              taskInput={taskInput}
              onTaskInputChange={setTaskInput}
              onInject={injectTask}
              onEvolve={triggerEvolve}
              feedback={injectFeedback}
            />
          </section>
        )}
      </div>

      {selectedAgentId && (
        <AgentDetail
          agentId={selectedAgentId}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
