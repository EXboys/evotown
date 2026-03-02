import { useEffect, useRef, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";

const WS_URL = import.meta.env.DEV ? "ws://localhost:5174/ws" : `ws://${location.host}/ws`;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const pushEvolutionEvent = useEvotownStore((s) => s.pushEvolutionEvent);
  const updateAgentBalance = useEvotownStore((s) => s.updateAgentBalance);
  const removeAgent = useEvotownStore((s) => s.removeAgent);
  const addAgent = useEvotownStore((s) => s.addAgent);
  const pushTaskRecord = useEvotownStore((s) => s.pushTaskRecord);

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
      };
      ws.onclose = () => {
        if (!cancelled) {
          setConnected(false);
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "state_snapshot") {
            // 重连后后端推送的状态快照，恢复 sprite 位置
            const agentList: { agent_id: string; balance: number; in_task: boolean }[] =
              msg.agents ?? [];
            agentList.forEach((a) => {
              evotownEvents.emit("agent_created", { agent_id: a.agent_id, balance: a.balance });
              evotownEvents.emit("sprite_move", {
                agent_id: a.agent_id,
                from: "",
                to: a.in_task ? "任务中心" : "广场",
                reason: "snapshot",
              });
              if (!useEvotownStore.getState().agents.some((s) => s.id === a.agent_id)) {
                addAgent({ id: a.agent_id, balance: a.balance });
              }
            });
          } else if (msg.type === "sprite_move") evotownEvents.emit("sprite_move", msg);
          else if (msg.type === "task_complete") {
            evotownEvents.emit("task_complete", msg);
            if (msg.balance != null) updateAgentBalance(msg.agent_id, msg.balance);
            pushTaskRecord({
              agent_id: msg.agent_id,
              task: msg.task ?? "",
              success: msg.success ?? false,
              judge: msg.judge,
              ts: new Date().toISOString(),
            });
            evotownEvents.emit("sprite_move", {
              agent_id: msg.agent_id,
              from: "任务中心",
              to: "广场",
              reason: "task_complete",
            });
          } else if (msg.type === "task_dispatched") {
            evotownEvents.emit("sprite_move", {
              agent_id: msg.agent_id,
              from: "广场",
              to: "任务中心",
              reason: "auto_dispatch",
            });
          } else if (msg.type === "agent_eliminated") {
            evotownEvents.emit("agent_eliminated", msg);
            removeAgent(msg.agent_id);
          } else if (msg.type === "agent_created") {
            const agents = useEvotownStore.getState().agents;
            if (!agents.some((a) => a.id === msg.agent_id)) {
              addAgent({ id: msg.agent_id, balance: msg.balance ?? 100 });
            }
            evotownEvents.emit("agent_created", { agent_id: msg.agent_id, balance: msg.balance ?? 100 });
          } else if (msg.type === "evolution_event") {
            evotownEvents.emit("evolution_event", msg);
            pushEvolutionEvent({
              agent_id: msg.agent_id,
              ts: msg.timestamp ?? msg.ts ?? new Date().toISOString(),
              type: msg.event_type ?? msg.type ?? "evolution",
              target_id: msg.target_id,
              reason: msg.reason,
              version: msg.version,
            });
          }
        } catch {}
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
  }, [pushEvolutionEvent, updateAgentBalance, removeAgent, addAgent, pushTaskRecord]);

  return { connected };
}
