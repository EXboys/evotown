/**
 * 统一 Agent 同步逻辑 — 单一数据源，集中 fetch + store + Phaser 事件
 * 替代 ObserverPanel / TownScene 中分散的同步调用
 */
import { useEffect, useRef } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore, type AgentInfo } from "../store/evotownStore";

const LOG = import.meta.env.DEV;

function log(msg: string, ...args: unknown[]) {
  if (LOG) console.info(`[evotown:sync] ${msg}`, ...args);
}

function logError(msg: string, err: unknown) {
  console.warn(`[evotown:sync] ${msg}`, err);
}

/** 从 API 拉取 agents 并更新 store */
async function fetchAgents(): Promise<AgentInfo[]> {
  const r = await fetch("/agents");
  if (!r.ok) throw new Error(`fetch /agents: ${r.status}`);
  const list = (await r.json()) as AgentInfo[];
  if (!Array.isArray(list)) throw new Error("invalid agents response");
  return list.map((a) => ({
    id: a.id,
    balance: a.balance,
    in_task: a.in_task,
    chat_dir: a.chat_dir,
    status: a.status,
    soul_type: a.soul_type,
  }));
}

/** 将 store 中的 agents 同步到 Phaser（emit 事件） */
function syncStoreToPhaser(agents: AgentInfo[]) {
  agents.forEach((a) => {
    evotownEvents.emit("agent_created", { agent_id: a.id, balance: a.balance });
    evotownEvents.emit("sprite_move", {
      agent_id: a.id,
      from: "",
      to: a.in_task ? "任务中心" : "广场",
      reason: "sync",
    });
  });
}

/** 完整同步：fetch → 更新 store → 同步到 Phaser */
async function doFullSync(
  setAgents: (a: AgentInfo[]) => void,
): Promise<void> {
  try {
    const list = await fetchAgents();
    setAgents(list);
    syncStoreToPhaser(list);
    log("synced", list.length, "agents");
  } catch (err) {
    logError("sync failed", err);
  }
}

/** 仅从 store 同步到 Phaser（不 fetch） */
function syncFromStoreToPhaser(
  getAgents: () => AgentInfo[],
): void {
  const agents = getAgents();
  if (agents.length === 0) return;
  syncStoreToPhaser(agents);
  log("synced from store", agents.length, "agents");
}

const SYNC_FALLBACK_INTERVAL_MS = 15_000;

export function useAgentSync() {
  const setAgents = useEvotownStore((s) => s.setAgents);
  const agents = useEvotownStore((s) => s.agents);
  const didInitialFetch = useRef(false);

  // 1. 挂载时拉取一次
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    doFullSync(setAgents);
  }, [setAgents]);

  // 2. phaser_ready：从 store 同步到 Phaser（Phaser 可能晚于 fetch 就绪）
  useEffect(() => {
    const handler = () =>
      syncFromStoreToPhaser(() => useEvotownStore.getState().agents);
    evotownEvents.on("phaser_ready", handler);
    return () => evotownEvents.off("phaser_ready", handler);
  }, []);

  // 3. request_sync：手动触发（如注入任务后）— 完整 fetch + 同步
  useEffect(() => {
    const handler = () => doFullSync(setAgents);
    evotownEvents.on("request_sync", handler);
    return () => evotownEvents.off("request_sync", handler);
  }, [setAgents]);

  // 4. agents 变化时同步到 Phaser（兜底：store 有数据但 Phaser 可能刚就绪）
  useEffect(() => {
    if (agents.length > 0)
      syncFromStoreToPhaser(() => useEvotownStore.getState().agents);
  }, [agents.length, agents.map((a) => a.id).join(",")]);

  // 5. 15s 兜底轮询（WS 未连接或时序异常时）
  useEffect(() => {
    const id = setInterval(
      () => doFullSync(setAgents),
      SYNC_FALLBACK_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [setAgents]);
}
