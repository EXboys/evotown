import { useEffect, useRef, useState } from "react";
import { evotownEvents } from "../phaser/events";

const WS_URL = import.meta.env.DEV ? "ws://localhost:5174/ws" : `ws://${location.host}/ws`;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "sprite_move") evotownEvents.emit("sprite_move", msg);
          else if (msg.type === "task_complete") evotownEvents.emit("task_complete", msg);
          else if (msg.type === "agent_eliminated") evotownEvents.emit("agent_eliminated", msg);
          else if (msg.type === "evolution_event") evotownEvents.emit("evolution_event", msg);
        } catch {}
      };
      wsRef.current = ws;
    };
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connected };
}
