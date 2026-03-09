import { useEffect, useRef, useState, useCallback } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";
import { useChronicleStore } from "../store/chronicleStore";

const WS_URL = import.meta.env.DEV
  ? "ws://localhost:5174/ws"
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const LOG = import.meta.env.DEV;

/** 重连配置 */
const RECONNECT_CONFIG = {
  /** 最大重试次数 */
  maxRetries: 10,
  /** 初始重连延迟（毫秒） */
  initialDelay: 1000,
  /** 最大重连延迟（毫秒） */
  maxDelay: 30000,
  /** 退避乘数 */
  backoffMultiplier: 2,
};

function log(msg: string, ...args: unknown[]) {
  if (LOG) console.info(`[evotown:ws] ${msg}`, ...args);
}

function logError(msg: string, err: unknown) {
  console.warn(`[evotown:ws] ${msg}`, err);
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  /** 重试计数 */
  const retryCountRef = useRef(0);
  /** 当前重连延迟（毫秒） */
  const currentDelayRef = useRef(RECONNECT_CONFIG.initialDelay);

  /** 计算下一次重连延迟（指数退避） */
  const getNextDelay = useCallback(() => {
    const delay = currentDelayRef.current;
    currentDelayRef.current = Math.min(
      currentDelayRef.current * RECONNECT_CONFIG.backoffMultiplier,
      RECONNECT_CONFIG.maxDelay
    );
    return delay;
  }, []);

  /** 请求全量状态同步 */
  const requestSync = useCallback(() => {
    evotownEvents.emit("request_sync", {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      // 检查是否超过最大重试次数
      if (retryCountRef.current >= RECONNECT_CONFIG.maxRetries) {
        log(`max retries (${RECONNECT_CONFIG.maxRetries}) reached, stopping reconnection`);
        return;
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        // 重连成功后重置重试计数和延迟
        const isReconnect = retryCountRef.current > 0;
        if (isReconnect) {
          log(`reconnected after ${retryCountRef.current} retries`);
          retryCountRef.current = 0;
          currentDelayRef.current = RECONNECT_CONFIG.initialDelay;
          // 重连成功后主动请求全量状态同步
          requestSync();
        }
        setConnected(true);
        log("connected");
      };

      ws.onclose = (event) => {
        if (cancelled) return;

        setConnected(false);
        wsRef.current = null;

        // 清除 pong 超时定时器
        // 注意：这里会在重连成功后请求全量状态同步

        // 非正常关闭（code != 1000 normal close）才重连
        if (event.code !== 1000) {
          retryCountRef.current++;
          const delay = getNextDelay();
          log(`disconnected (code=${event.code}), reconnecting in ${delay}ms (retry ${retryCountRef.current}/${RECONNECT_CONFIG.maxRetries})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          log("WebSocket closed normally");
        }
      };

      ws.onerror = () => {
        logError("WebSocket error", null);
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
        const store = useEvotownStore.getState();
        // 回放模式下忽略实时 WS 事件，避免覆盖回放状态
        if (store.replayMode) return;
        try {
          const msg = JSON.parse(e.data) as Record<string, unknown>;
          const type = msg.type as string | undefined;

          if (type === "state_snapshot") {
            const agentList = (msg.agents ?? []) as {
              agent_id: string;
              display_name?: string;
              balance: number;
              in_task: boolean;
              team_id?: string;
              team_name?: string;
            }[];
            // 先更新 store（setAgents 内部会将英文名转为三国中文名，并保留已有队伍信息）
            const previousAgents = store.agents; // 保存同步前的 agent 列表
            store.setAgents(agentList.map((a) => ({
              id: a.agent_id,
              display_name: a.display_name,
              balance: a.balance,
              in_task: a.in_task,
              team_id: a.team_id,
              team_name: a.team_name,
            })));
            const agents = useEvotownStore.getState().agents;
            agents.forEach((a) => {
              const isNew = !previousAgents.some((p) => p.id === a.id);
              // 只在新 agent 首次创建时触发入阵事件
              if (isNew) {
                evotownEvents.emit("agent_created", {
                  agent_id: a.id,
                  balance: a.balance,
                  display_name: a.display_name,
                });
              }
              evotownEvents.emit("sprite_move", {
                agent_id: a.id,
                from: "",
                to: a.in_task ? "任务中心" : "广场",
                reason: "snapshot",
              });
            });
            // 同步队伍信息到 Phaser
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
          } else if (type === "sprite_move") {
            evotownEvents.emit("sprite_move", {
              agent_id: String(msg.agent_id ?? ""),
              from: String(msg.from ?? ""),
              to: String(msg.to ?? ""),
              reason: String(msg.reason ?? ""),
            });
          } else if (type === "task_complete") {
            const agentId = String(msg.agent_id ?? "");
            const balance = Number(msg.balance ?? 0);
            const success = Boolean(msg.success);
            evotownEvents.emit("task_complete", {
              agent_id: agentId,
              success,
              balance,
            });
            store.setAgents(store.agents.map((a) =>
              a.id === agentId ? { ...a, balance, in_task: false } : a
            ));
            store.pushTaskRecord({
              agent_id: agentId,
              task: (msg.task as string) ?? "",
              success,
              judge: msg.judge as never,
              ts: new Date().toISOString(),
              difficulty: (msg.difficulty as string) ?? undefined,
            });
          } else if (type === "task_available") {
            const taskId = String(msg.task_id ?? "");
            const task = String(msg.task ?? "");
            const difficulty = String(msg.difficulty ?? "medium");
            const createdAt = String(msg.created_at ?? "");
            store.addAvailableTask({ task_id: taskId, task, difficulty, created_at: createdAt });
            evotownEvents.emit("task_available", { task_id: taskId, task, difficulty });
          } else if (type === "task_taken") {
            const taskId = String(msg.task_id ?? "");
            const agentId = String(msg.agent_id ?? "");
            const task = String(msg.task ?? "");
            store.removeAvailableTask(taskId);
            evotownEvents.emit("task_taken", { task_id: taskId, agent_id: agentId, task });
          } else if (type === "task_expired") {
            const taskId = String(msg.task_id ?? "");
            const task = String(msg.task ?? "");
            store.removeAvailableTask(taskId);
            evotownEvents.emit("task_expired", { task_id: taskId, task });
          } else if (type === "task_dispatched") {
            const agentId = String(msg.agent_id ?? "");
            evotownEvents.emit("sprite_move", {
              agent_id: agentId,
              from: "广场",
              to: "任务中心",
              reason: "auto_dispatch",
            });
            evotownEvents.emit("request_sync", {});
            if (store.agents.some((a) => a.id === agentId)) {
              store.setAgents(store.agents.map((a) =>
                a.id === agentId ? { ...a, in_task: true } : a
              ));
            } else {
              store.addAgent({ id: agentId, balance: 100, in_task: true });
            }
          } else if (type === "agent_eliminated") {
            evotownEvents.emit("agent_eliminated", {
              agent_id: String(msg.agent_id ?? ""),
              reason: String(msg.reason ?? ""),
            });
            store.removeAgent(String(msg.agent_id ?? ""));
          } else if (type === "agent_created") {
            const agentId = String(msg.agent_id ?? "");
            const balance = Number(msg.balance ?? 100);
            const displayName = String(msg.display_name ?? agentId);
            if (!store.agents.some((a) => a.id === agentId)) {
              store.addAgent({ id: agentId, display_name: displayName, balance });
              evotownEvents.emit("agent_created", { agent_id: agentId, balance, display_name: displayName });
            }
          } else if (type === "chronicle_published") {
            useChronicleStore.getState().setLatestPublished({
              date: String(msg.date ?? ""),
              preview: String(msg.preview ?? ""),
            });
          } else if (type === "agent_message") {
            const smsg = {
              from_id: String(msg.from_id ?? ""),
              from_name: String(msg.from_name ?? ""),
              to_id: String(msg.to_id ?? ""),
              to_name: String(msg.to_name ?? ""),
              content: String(msg.content ?? ""),
              msg_type: String(msg.msg_type ?? "chat"),
              ts: String(msg.ts ?? new Date().toISOString()),
            };
            store.pushSocialMessage(smsg);
            evotownEvents.emit("agent_message", smsg);
          } else if (type === "agent_decision") {
            const dec = {
              agent_id: String(msg.agent_id ?? ""),
              display_name: String(msg.display_name ?? ""),
              solo_preference: Boolean(msg.solo_preference),
              evolution_focus: String(msg.evolution_focus ?? ""),
              prev_evolution_focus: String(msg.prev_evolution_focus ?? ""),
              reason: String(msg.reason ?? ""),
              ts: String(msg.ts ?? new Date().toISOString()),
            };
            store.pushAgentDecision(dec);
            evotownEvents.emit("agent_decision", dec);
          } else if (type === "team_formed") {
            // 结阵：批量更新 store 中 agent 的队伍归属 + 通知 Phaser 更新旗帜颜色
            const teams = (msg.teams ?? []) as {
              team_id: string;
              name: string;
              members: { agent_id: string; display_name: string }[];
            }[];
            store.setAgentTeams(teams);
            evotownEvents.emit("team_formed", { teams });
          } else if (type === "rescue_event") {
            // 救援：emit 到 Phaser，播放施救动画
            evotownEvents.emit("rescue_event", {
              donor_id: String(msg.donor_id ?? ""),
              donor_display_name: String(msg.donor_display_name ?? ""),
              target_id: String(msg.target_id ?? ""),
              target_display_name: String(msg.target_display_name ?? ""),
              amount: Number(msg.amount ?? 0),
              team_id: String(msg.team_id ?? ""),
              team_name: String(msg.team_name ?? ""),
            });
            // 同时更新双方余额
            const donorId = String(msg.donor_id ?? "");
            const targetId = String(msg.target_id ?? "");
            if (msg.donor_balance != null) store.updateAgentBalance(donorId, Number(msg.donor_balance));
            if (msg.target_balance != null) store.updateAgentBalance(targetId, Number(msg.target_balance));
          } else if (type === "agent_last_stand") {
            // 最后一战：更新 store 余额 + emit 到 Phaser 播放红色脉冲特效
            const agentId = String(msg.agent_id ?? "");
            const balance = Number(msg.balance ?? 0);
            store.updateAgentBalance(agentId, balance);
            evotownEvents.emit("agent_last_stand", {
              agent_id: agentId,
              display_name: String(msg.display_name ?? agentId),
              balance,
            });
          } else if (type === "subtitle_broadcast") {
            // 直播大字幕：emit 到 Phaser 显示底部字幕条
            evotownEvents.emit("subtitle_broadcast", {
              text: String(msg.text ?? ""),
              level: String(msg.level ?? "info"),
            });
          } else if (type === "agent_defected") {
            // 叛逃事件：emit 到 Phaser 播放叛逃动画
            evotownEvents.emit("agent_defected", {
              agent_id: String(msg.agent_id ?? ""),
              display_name: String(msg.display_name ?? msg.agent_id ?? ""),
              old_team_id: String(msg.old_team_id ?? ""),
              old_team_name: String(msg.old_team_name ?? ""),
              new_team_id: String(msg.new_team_id ?? ""),
              new_team_name: String(msg.new_team_name ?? "流民"),
            });
          } else if (type === "team_creed_generated") {
            // 军团宗旨生成：emit 到 Phaser（目前仅日志，后续可展示 tooltip）
            evotownEvents.emit("team_creed_generated", {
              team_id: String(msg.team_id ?? ""),
              team_name: String(msg.team_name ?? ""),
              creed: String(msg.creed ?? ""),
            });
          } else if (type === "task_log") {
            // 任务执行日志：实时广播 tool_call 和 tool_result
            evotownEvents.emit("task_log", {
              agent_id: String(msg.agent_id ?? ""),
              agent_name: String(msg.agent_name ?? msg.agent_id ?? ""),
              event: (msg.event === "tool_call" || msg.event === "tool_result") ? msg.event : "tool_call",
              tool_name: String(msg.tool_name ?? ""),
              arguments: String(msg.arguments ?? ""),
              result: String(msg.result ?? ""),
              is_error: Boolean(msg.is_error ?? false),
              task: String(msg.task ?? ""),
            });
          } else if (type === "evolution_event") {
            const agentId = String(msg.agent_id ?? "");
            const balance = msg.balance as number | undefined;
            evotownEvents.emit("evolution_event", {
              ...msg,
              agent_id: agentId,
            });
            if (balance != null && store.agents.some((a) => a.id === agentId)) {
              store.setAgents(store.agents.map((a) =>
                a.id === agentId ? { ...a, balance } : a
              ));
              // 从 store 取中文名一起传给 Phaser，避免 label 被重置为英文
              // 注意：这里不触发 agent_created 事件，避免重复显示"入阵"
              const displayName = useEvotownStore.getState().agents.find((a) => a.id === agentId)?.display_name;
              if (displayName) {
                evotownEvents.emit("sprite_move", { agent_id: agentId, from: "", to: "广场", reason: "evolution" });
              }
            }
            store.pushEvolutionEvent({
              agent_id: agentId,
              ts: (msg.timestamp ?? msg.ts ?? new Date().toISOString()) as string,
              type: (msg.event_type ?? msg.type ?? "evolution") as string,
              target_id: msg.target_id as string | undefined,
              reason: msg.reason as string | undefined,
              version: msg.version as string | undefined,
            });
          } else if (type === "server_ping") {
            // 收到服务端心跳请求，立即响应 pong
            ws.send(JSON.stringify({ type: "pong" }));
          } else if (type === "pong") {
            // 收到服务端 pong 响应（备用，可能服务端自己也会处理）
            log("received pong from server");
          }
        } catch (err) {
          logError("parse message failed", err);
        }
      };
      wsRef.current = ws;
    };
    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimeoutRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws?.readyState === WebSocket.OPEN) ws.close();
    };
  }, [getNextDelay, requestSync]);

  return { connected };
}
