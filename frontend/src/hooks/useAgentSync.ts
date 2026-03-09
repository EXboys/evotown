/**
 * 统一 Agent 同步逻辑 — 单一数据源，集中 fetch + store + Phaser 事件
 * 替代 ObserverPanel / TownScene 中分散的同步调用
 */
import { useEffect, useRef } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore, type AgentInfo } from "../store/evotownStore";

const LOG = import.meta.env.DEV;

// 跟踪已同步到 Phaser 的 agent，避免重复触发 agent_created 事件
const _syncedAgents = new Set<string>();

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
    display_name: a.display_name,
    balance: a.balance,
    in_task: a.in_task,
    chat_dir: a.chat_dir,
    status: a.status,
    soul_type: a.soul_type,
    team_id: a.team_id,
    team_name: a.team_name,
  }));
}

/** 将 store 中的 agents 同步到 Phaser（emit 事件） */
function syncStoreToPhaser(agents: AgentInfo[]) {
  agents.forEach((a) => {
    // 只在新 agent 首次同步时触发"入阵"事件
    if (!_syncedAgents.has(a.id)) {
      _syncedAgents.add(a.id);
      evotownEvents.emit("agent_created", { agent_id: a.id, balance: a.balance, display_name: a.display_name });
    }
    evotownEvents.emit("sprite_move", {
      agent_id: a.id,
      from: "",
      to: a.in_task ? "任务中心" : "广场",
      reason: "sync",
    });
  });
  // 同步队伍信息：store 中有 team_id 时，emit team_formed 让 Phaser 显示旗帜和标签
  const teamsMap: Record<string, { team_id: string; name: string; members: { agent_id: string; display_name: string }[] }> = {};
  agents.forEach((a) => {
    if (a.team_id) {
      if (!teamsMap[a.team_id])
        teamsMap[a.team_id] = { team_id: a.team_id, name: a.team_name ?? a.team_id, members: [] };
      teamsMap[a.team_id].members.push({ agent_id: a.id, display_name: a.display_name ?? a.id });
    }
  });
  const teams = Object.values(teamsMap);
  if (teams.length > 0) evotownEvents.emit("team_formed", { teams });
}

/** 完整同步：fetch → 更新 store → 同步到 Phaser */
async function doFullSync(
  setAgents: (a: AgentInfo[]) => void,
): Promise<void> {
  // 回放模式下跳过，避免实时数据覆盖回放状态
  if (useEvotownStore.getState().replayMode) return;
  try {
    const list = await fetchAgents();
    // 先更新 store（setAgents 内部会将英文名转为三国中文名）
    setAgents(list);
    // 取 store 中已转换的中文名列表同步给 Phaser，而非原始 API 列表
    syncStoreToPhaser(useEvotownStore.getState().agents);
    log("synced", list.length, "agents");
  } catch (err) {
    logError("sync failed", err);
  }
}

/** 仅从 store 同步到 Phaser（不 fetch） */
function syncFromStoreToPhaser(
  getAgents: () => AgentInfo[],
): void {
  // 回放模式下跳过
  if (useEvotownStore.getState().replayMode) return;
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

  // 2. phaser_ready：清空已同步集合后重新同步到 Phaser
  //    修复竞态：初始 fetch 可能在 TownScene 注册 listener 之前完成，
  //    导致 agent_created 事件丢失；phaser_ready 时重置确保重新发出
  useEffect(() => {
    const handler = () => {
      _syncedAgents.clear();
      syncFromStoreToPhaser(() => useEvotownStore.getState().agents);
    };
    evotownEvents.on("phaser_ready", handler);
    return () => evotownEvents.off("phaser_ready", handler);
  }, []);

  // 3. request_sync：手动触发（如注入任务后）— 完整 fetch + 同步
  useEffect(() => {
    const handler = () => doFullSync(setAgents);
    evotownEvents.on("request_sync", handler);
    return () => evotownEvents.off("request_sync", handler);
  }, [setAgents]);

  // 4. agents 变化时同步到 Phaser（兜底：store 有数据但 Phaser 可能刚就绪，含队伍变化）
  useEffect(() => {
    if (agents.length > 0)
      syncFromStoreToPhaser(() => useEvotownStore.getState().agents);
  }, [agents.length, agents.map((a) => `${a.id}:${a.team_id ?? ""}`).join(",")]);

  // 5. 15s 兜底轮询（WS 未连接或时序异常时）
  useEffect(() => {
    const id = setInterval(
      () => doFullSync(setAgents),
      SYNC_FALLBACK_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [setAgents]);
}
