import { useEffect, useRef, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";

const WS_URL = import.meta.env.DEV ? "ws://localhost:5174/ws" : `ws://${location.host}/ws`;
const LOG = import.meta.env.DEV;

function log(msg: string, ...args: unknown[]) {
  if (LOG) console.info(`[evotown:ws] ${msg}`, ...args);
}

function logError(msg: string, err: unknown) {
  console.warn(`[evotown:ws] ${msg}`, err);
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        setConnected(true);
        log("connected");
      };
      ws.onclose = () => {
        if (!cancelled) {
          setConnected(false);
          log("disconnected, reconnecting in 3s");
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        logError("WebSocket error", null);
      };
      ws.onmessage = (e) => {
        if (cancelled) return;
        const store = useEvotownStore.getState();
        try {
          const msg = JSON.parse(e.data) as Record<string, unknown>;
          const type = msg.type as string | undefined;

          if (type === "state_snapshot") {
            const agentList = (msg.agents ?? []) as {
              agent_id: string;
              balance: number;
              in_task: boolean;
            }[];
            agentList.forEach((a) => {
              evotownEvents.emit("agent_created", {
                agent_id: a.agent_id,
                balance: a.balance,
              });
              evotownEvents.emit("sprite_move", {
                agent_id: a.agent_id,
                from: "",
                to: a.in_task ? "任务中心" : "广场",
                reason: "snapshot",
              });
            });
            store.setAgents(agentList.map((a) => ({
              id: a.agent_id,
              balance: a.balance,
              in_task: a.in_task,
            })));
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
            if (!store.agents.some((a) => a.id === agentId)) {
              store.addAgent({ id: agentId, balance });
            }
            evotownEvents.emit("agent_created", { agent_id: agentId, balance });
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
              evotownEvents.emit("agent_created", { agent_id: agentId, balance });
            }
            store.pushEvolutionEvent({
              agent_id: agentId,
              ts: (msg.timestamp ?? msg.ts ?? new Date().toISOString()) as string,
              type: (msg.event_type ?? msg.type ?? "evolution") as string,
              target_id: msg.target_id as string | undefined,
              reason: msg.reason as string | undefined,
              version: msg.version as string | undefined,
            });
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
      clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws?.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  return { connected };
}
