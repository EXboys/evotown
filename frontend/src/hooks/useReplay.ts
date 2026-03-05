/**
 * useReplay — 从录制 JSONL 回放 WS 事件
 *
 * 使用方式：
 *   const { sessions, load, play, pause, reset, state, speed, setSpeed } = useReplay();
 *   load(sessionId)   // 拉取事件列表
 *   play()            // 开始/继续回放
 *   pause()           // 暂停
 *   reset()           // 重置到开头
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";

export interface ReplaySession {
  session_id: string;
  size_bytes: number;
  modified_at: string;
}

export type ReplayState = "idle" | "loading" | "ready" | "playing" | "paused" | "done";

const API_BASE = import.meta.env.DEV ? "http://localhost:5174" : "";

/** 把单条 WS 事件分发给 evotownEvents + evotownStore（与 useWebSocket 逻辑一致） */
function dispatchEvent(msg: Record<string, unknown>) {
  const store = useEvotownStore.getState();
  const type = msg.type as string | undefined;

  if (type === "state_snapshot") {
    const agentList = (msg.agents ?? []) as { agent_id: string; display_name?: string; balance: number; in_task: boolean }[];
    agentList.forEach((a) => {
      evotownEvents.emit("agent_created", { agent_id: a.agent_id, balance: a.balance, display_name: a.display_name });
      evotownEvents.emit("sprite_move", { agent_id: a.agent_id, from: "", to: a.in_task ? "任务中心" : "广场", reason: "snapshot" });
    });
    store.setAgents(agentList.map((a) => ({ id: a.agent_id, display_name: a.display_name, balance: a.balance, in_task: a.in_task })));
  } else if (type === "sprite_move") {
    evotownEvents.emit("sprite_move", { agent_id: String(msg.agent_id ?? ""), from: String(msg.from ?? ""), to: String(msg.to ?? ""), reason: String(msg.reason ?? "") });
  } else if (type === "task_complete") {
    const agentId = String(msg.agent_id ?? "");
    const balance = Number(msg.balance ?? 0);
    const success = Boolean(msg.success);
    evotownEvents.emit("task_complete", { agent_id: agentId, success, balance });
    store.setAgents(store.agents.map((a) => a.id === agentId ? { ...a, balance, in_task: false } : a));
    store.pushTaskRecord({ agent_id: agentId, task: (msg.task as string) ?? "", success, judge: msg.judge as never, ts: new Date().toISOString(), difficulty: (msg.difficulty as string) ?? undefined });
  } else if (type === "task_available") {
    evotownEvents.emit("task_available", { task_id: String(msg.task_id ?? ""), task: String(msg.task ?? ""), difficulty: String(msg.difficulty ?? "medium") });
    store.addAvailableTask({ task_id: String(msg.task_id ?? ""), task: String(msg.task ?? ""), difficulty: String(msg.difficulty ?? "medium"), created_at: String(msg.created_at ?? "") });
  } else if (type === "task_taken") {
    store.removeAvailableTask(String(msg.task_id ?? ""));
    evotownEvents.emit("task_taken", { task_id: String(msg.task_id ?? ""), agent_id: String(msg.agent_id ?? ""), task: String(msg.task ?? "") });
  } else if (type === "task_expired") {
    store.removeAvailableTask(String(msg.task_id ?? ""));
    evotownEvents.emit("task_expired", { task_id: String(msg.task_id ?? ""), task: String(msg.task ?? "") });
  } else if (type === "task_dispatched") {
    evotownEvents.emit("sprite_move", { agent_id: String(msg.agent_id ?? ""), from: "广场", to: "任务中心", reason: "auto_dispatch" });
    store.setAgents(store.agents.map((a) => a.id === String(msg.agent_id ?? "") ? { ...a, in_task: true } : a));
  } else if (type === "agent_eliminated") {
    evotownEvents.emit("agent_eliminated", { agent_id: String(msg.agent_id ?? ""), reason: String(msg.reason ?? "") });
    store.removeAgent(String(msg.agent_id ?? ""));
  } else if (type === "agent_created") {
    const agentId = String(msg.agent_id ?? "");
    const balance = Number(msg.balance ?? 100);
    const displayName = String(msg.display_name ?? agentId);
    store.addAgent({ id: agentId, display_name: displayName, balance });
    evotownEvents.emit("agent_created", { agent_id: agentId, balance, display_name: displayName });
  } else if (type === "evolution_event") {
    const agentId = String(msg.agent_id ?? "");
    evotownEvents.emit("evolution_event", { ...msg, agent_id: agentId });
    const balance = msg.balance as number | undefined;
    if (balance != null) store.setAgents(store.agents.map((a) => a.id === agentId ? { ...a, balance } : a));
    store.pushEvolutionEvent({ agent_id: agentId, ts: (msg.timestamp ?? msg.ts ?? new Date().toISOString()) as string, type: (msg.event_type ?? msg.type ?? "evolution") as string, target_id: msg.target_id as string | undefined, reason: msg.reason as string | undefined, version: msg.version as string | undefined });
  }
}

export function useReplay() {
  const [sessions, setSessions] = useState<ReplaySession[]>([]);
  const [replayState, setReplayState] = useState<ReplayState>("idle");
  const [speed, setSpeed] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const eventsRef = useRef<Record<string, unknown>[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const indexRef = useRef(0);
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/replay/sessions`);
      if (!r.ok) return;
      const data = await r.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async (sid: string) => {
    setReplayState("loading");
    setSessionId(sid);
    try {
      const r = await fetch(`${API_BASE}/replay/sessions/${sid}`);
      const events = await r.json() as Record<string, unknown>[];
      eventsRef.current = events.sort((a, b) => (Number(a.replay_ts ?? 0)) - (Number(b.replay_ts ?? 0)));
      indexRef.current = 0;
      setCurrentIndex(0);
      setReplayState("ready");
    } catch {
      setReplayState("idle");
    }
  }, []);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const scheduleNext = useCallback((idx: number) => {
    const events = eventsRef.current;
    if (idx >= events.length) { setReplayState("done"); return; }
    const current = events[idx];
    const next = events[idx + 1];
    dispatchEvent(current);
    indexRef.current = idx + 1;
    setCurrentIndex(idx + 1);
    if (!next) { setReplayState("done"); return; }
    const delay = Math.max(0, ((Number(next.replay_ts ?? 0)) - (Number(current.replay_ts ?? 0))) * 1000 / speedRef.current);
    timerRef.current = setTimeout(() => { if (!pausedRef.current) scheduleNext(idx + 1); }, delay);
  }, []);

  /** 进入回放模式：清理现有状态，屏蔽实时数据源 */
  const enterReplayMode = useCallback(() => {
    const store = useEvotownStore.getState();
    if (!store.replayMode) {
      store.setReplayMode(true);
      // 清除当前场景中的所有 agent（让 Phaser 销毁精灵）
      store.agents.forEach((a) => {
        evotownEvents.emit("agent_eliminated", { agent_id: a.id, reason: "replay_clear" });
      });
      store.setAgents([]);
      store.setAvailableTasks([]);
    }
  }, []);

  /** 退出回放模式：恢复实时数据源 */
  const exitReplayMode = useCallback(() => {
    const store = useEvotownStore.getState();
    if (store.replayMode) {
      // 清除回放残留的 agent
      store.agents.forEach((a) => {
        evotownEvents.emit("agent_eliminated", { agent_id: a.id, reason: "replay_end" });
      });
      store.setAgents([]);
      store.setAvailableTasks([]);
      store.setReplayMode(false);
      // 触发重新同步实时数据
      evotownEvents.emit("request_sync", {});
    }
  }, []);

  const play = useCallback(() => {
    if (replayState === "done" || replayState === "idle") return;
    enterReplayMode();
    pausedRef.current = false;
    setReplayState("playing");
    scheduleNext(indexRef.current);
  }, [replayState, scheduleNext, enterReplayMode]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimer();
    setReplayState("paused");
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    pausedRef.current = false;
    indexRef.current = 0;
    setCurrentIndex(0);
    exitReplayMode();
    setReplayState(eventsRef.current.length > 0 ? "ready" : "idle");
  }, [exitReplayMode]);

  useEffect(() => () => {
    clearTimer();
    // 组件卸载时退出回放模式
    const store = useEvotownStore.getState();
    if (store.replayMode) {
      store.setReplayMode(false);
      evotownEvents.emit("request_sync", {});
    }
  }, []);

  const total = eventsRef.current.length;
  const progress = total > 0 ? currentIndex / total : 0;

  return { sessions, fetchSessions, load, play, pause, reset, replayState, speed, setSpeed, currentIndex, total, progress, sessionId };
}

