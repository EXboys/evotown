import { useEffect, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { TaskInjectorBar } from "./TaskInjectorBar";

export function ObserverPanel() {
  const [taskInput, setTaskInput] = useState("");
  const [agents, setAgents] = useState<{ id: string; balance: number }[]>([]);

  useEffect(() => {
    fetch("/agents")
      .then((r) => r.json())
      .then((list: { id: string; balance: number }[]) => {
        setAgents(list);
        list.forEach((a) => evotownEvents.emit("agent_created", { agent_id: a.id, balance: a.balance }));
      })
      .catch(() => {});
  }, []);

  const createAgent = async () => {
    const res = await fetch("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_dir: null }),
    });
    const data = await res.json();
    setAgents((a) => [...a, { id: data.id, balance: data.balance }]);
    evotownEvents.emit("agent_created", { agent_id: data.id, balance: data.balance });
  };

  const injectTask = async () => {
    if (!taskInput.trim() || agents.length === 0) return;
    await fetch("/tasks/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agents[0].id, task: taskInput }),
    });
    setTaskInput("");
  };

  const triggerEvolve = async () => {
    if (agents.length === 0) return;
    await fetch(`/agents/${agents[0].id}/evolve`, { method: "POST" });
  };

  return (
    <div className="w-[340px] flex flex-col bg-[#1e293b] backdrop-blur-sm border-l border-evo-border shadow-evo-panel">
      <div className="p-5 border-b border-evo-border/80">
        <h2 className="text-base font-semibold text-slate-200 tracking-wide flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full bg-evo-accent" />
          观测面板
        </h2>
        <p className="text-xs text-slate-500 mt-1">监控与操控智能体</p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <section className="space-y-3">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">智能体</h3>
          <button
            onClick={createAgent}
            className="w-full py-2.5 px-4 bg-emerald-600/90 hover:bg-emerald-500 rounded-lg text-sm font-medium text-white transition-colors shadow-lg shadow-emerald-900/30 hover:shadow-emerald-800/40"
          >
            + 创建 Agent
          </button>
          <div className="rounded-lg bg-slate-900/50 border border-evo-border/60 p-3 min-h-[48px]">
            <p className="text-xs text-slate-500 mb-1">当前 Agent</p>
            <p className="text-sm text-slate-300 font-mono">
              {agents.length > 0 ? agents.map((a) => (
                <span key={a.id} className="block truncate">· {a.id} <span className="text-amber-400">({a.balance})</span></span>
              )) : <span className="text-slate-500 italic">暂无</span>}
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">任务与进化</h3>
          <TaskInjectorBar
            agents={agents}
            taskInput={taskInput}
            onTaskInputChange={setTaskInput}
            onInject={injectTask}
            onEvolve={triggerEvolve}
          />
        </section>

        <p className="text-[11px] text-slate-600 pt-2 border-t border-evo-border/50">
          EGL 曲线 · Timeline · Agent 详情 — Phase 3
        </p>
      </div>
    </div>
  );
}
