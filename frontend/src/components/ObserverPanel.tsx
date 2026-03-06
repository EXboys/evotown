import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { useReplay } from "../hooks/useReplay";
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
import { Leaderboard } from "./Leaderboard";

type TabId = "metrics" | "agents" | "arena" | "graveyard" | "leaderboard";

export function ObserverPanel() {
  const [taskInput, setTaskInput] = useState("");
  const [tab, setTab] = useState<TabId>("leaderboard");
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

  // ── Replay ──────────────────────────────────────────────────────────────────
  const replay = useReplay();
  const [selectedExpId, setSelectedExpId] = useState<string>("");

  useEffect(() => {
    replay.fetchActiveSession();
    replay.fetchSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === "leaderboard") replay.fetchSessions();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // 当 experimentInfo 加载后，默认选中当前实验 ID
  useEffect(() => {
    if (experimentInfo.experiment_id && !selectedExpId) {
      setSelectedExpId(experimentInfo.experiment_id);
    }
  }, [experimentInfo.experiment_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [evolveFeedback, setEvolveFeedback] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const removeAgent = useEvotownStore((s) => s.removeAgent);

  const deleteAgent = async (agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const displayName = agents.find((a) => a.id === agentId)?.display_name || agentId;
    if (!window.confirm(`确定要删除 Agent「${displayName}」吗？删除后可从竞技场重新创建。`)) return;
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
          <div className="flex flex-col items-end gap-1">
            {/* 实验 ID 选择器 */}
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[10px] text-slate-500 shrink-0">实验:</span>
              {replay.sessions.length > 1 ? (
                <select
                  value={selectedExpId}
                  onChange={(e) => setSelectedExpId(e.target.value)}
                  title="选择录制存放的实验 ID"
                  className="text-[10px] text-slate-400 font-mono bg-slate-800/80 border border-slate-600/40 rounded px-1 py-0.5 max-w-[160px] focus:outline-none focus:ring-1 focus:ring-evo-accent/50 truncate"
                >
                  {/* 当前实验 ID（若不在 sessions 中也保留） */}
                  {experimentInfo.experiment_id &&
                    !replay.sessions.some((s) => s.session_id === experimentInfo.experiment_id) && (
                      <option value={experimentInfo.experiment_id}>
                        {experimentInfo.experiment_id}
                      </option>
                    )}
                  {replay.sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.session_id}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className="text-[10px] text-slate-600 font-mono truncate max-w-[160px]"
                  title={experimentInfo.experiment_id ?? ""}
                >
                  {experimentInfo.experiment_id ?? "—"}
                </span>
              )}
            </div>
            {tokenUsage && tokenUsage.total_tokens > 0 && (
              <p className="text-[10px] text-slate-500" title={`输入 ${tokenUsage.prompt_tokens.toLocaleString()} / 输出 ${tokenUsage.completion_tokens.toLocaleString()}`}>
                Token: {(tokenUsage.total_tokens / 1000).toFixed(1)}K
              </p>
            )}
            {/* 录制控制 */}
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${replay.activeSession?.active ? "bg-red-500 animate-pulse" : "bg-slate-600"}`} />
              {replay.activeSession?.active && (
                <>
                  <span
                    className="text-[10px] text-red-400/80 font-mono truncate max-w-[90px]"
                    title={replay.activeSession.session_id ?? ""}
                  >
                    {replay.activeSession.session_id}
                  </span>
                  <button
                    onClick={replay.stopSession}
                    disabled={replay.recordingBusy}
                    className="text-[10px] text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors shrink-0"
                  >
                    ■ 停止
                  </button>
                </>
              )}
              <button
                onClick={async () => {
                  if (replay.activeSession?.active) await replay.stopSession();
                  // 不传 session_id → 后端自动生成时间戳文件名（每次都是新文件）
                  replay.startNewSession(undefined, true);
                }}
                disabled={replay.recordingBusy}
                className="text-[10px] text-slate-500 hover:text-red-400 disabled:opacity-40 transition-colors shrink-0"
                title="新建录制文件（后端自动生成时间戳文件名）"
              >
                {replay.recordingBusy ? "…" : "● 新建录制"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab 栏：6 个 Tab，排名 Tab 内含回放+动态 */}
      <div className="flex border-b border-slate-600/50 shrink-0">
        {[
          { id: "leaderboard" as TabId, label: "排名" },
          { id: "arena" as TabId, label: "竞技" },
          { id: "agents" as TabId, label: "智能体" },
          { id: "graveyard" as TabId, label: "墓园" },
          { id: "metrics" as TabId, label: "EGL" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-1 text-[10px] sm:text-[11px] font-medium transition-colors whitespace-nowrap ${
              tab === t.id
                ? "text-evo-accent border-b-2 border-evo-accent"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
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
                        <span className="truncate min-w-0">
                          {a.display_name ? `${a.display_name}(${a.id})` : a.id}
                        </span>
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

        {tab === "leaderboard" && (
          <div className="space-y-4">
            {/* 1. 排行榜 */}
            <Leaderboard />

            {/* 2. 回放控制 */}
            <div className="border-t border-slate-700/50 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">⏮ 回放</h3>
                <button
                  onClick={() => { replay.fetchSessions(); replay.fetchActiveSession(); }}
                  className="text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded border border-slate-600/40"
                >刷新</button>
              </div>

              {replay.sessions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">暂无录制，运行中自动录制</p>
              ) : (
                <select
                  value={replay.sessionId ?? ""}
                  onChange={(e) => e.target.value && replay.load(e.target.value)}
                  className="w-full py-1.5 px-2 rounded-lg bg-slate-800/60 border border-slate-600/40 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-evo-accent/50"
                >
                  <option value="">— 选择录制 —</option>
                  {replay.sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.session_id} ({(s.size_bytes / 1024).toFixed(1)} KB)
                    </option>
                  ))}
                </select>
              )}

              {replay.replayState !== "idle" && (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                      <span>{replay.currentIndex}/{replay.total}</span>
                      <span className={replay.replayState === "playing" ? "text-emerald-400" : replay.replayState === "done" ? "text-amber-400" : "text-slate-400"}>
                        {replay.replayState === "loading" ? "加载中…" : replay.replayState === "ready" ? "就绪" : replay.replayState === "playing" ? "▶ 播放中" : replay.replayState === "paused" ? "⏸ 已暂停" : "✓ 完成"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-evo-accent rounded-full transition-all" style={{ width: `${replay.progress * 100}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 4, 8].map((x) => (
                      <button key={x} onClick={() => replay.setSpeed(x)}
                        className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${replay.speed === x ? "border-evo-accent text-evo-accent" : "border-slate-600/40 text-slate-500 hover:text-slate-300"}`}>
                        {x}x
                      </button>
                    ))}
                    <span className="flex-1" />
                    {(replay.replayState === "ready" || replay.replayState === "paused") && (
                      <button onClick={replay.play} className="px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-medium">▶</button>
                    )}
                    {replay.replayState === "playing" && (
                      <button onClick={replay.pause} className="px-2.5 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-white text-[11px] font-medium">⏸</button>
                    )}
                    <button onClick={replay.reset} className="px-2 py-1 rounded border border-slate-600/40 text-slate-400 hover:text-slate-200 text-[11px]">↺</button>
                  </div>
                </div>
              )}
            </div>

            {/* 4. 进化时间线 */}
            <div className="border-t border-slate-700/50 pt-3">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">📈 时间线</h3>
              <EvolutionTimeline
                agents={agents}
                onSelectAgent={(agentId, evoTab) => {
                  setSelectedAgent(agentId);
                  setAgentDetailInitialTab(evoTab === "evolution" ? "evolution" : undefined);
                }}
              />
            </div>
          </div>
        )}
        {tab === "arena" && <ArenaControl />}
        {tab === "graveyard" && <AgentGraveyard />}

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
