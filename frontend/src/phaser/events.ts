/** Evotown 事件总线 — React/WS 与 Phaser 通信 */
export type EvotownEventMap = {
  sprite_move: { agent_id: string; from: string; to: string; reason: string };
  task_complete: { agent_id: string; success: boolean; balance: number };
  evolution_event: { agent_id: string; type?: string; [k: string]: unknown };
  agent_eliminated: { agent_id: string; reason: string };
  agent_created: { agent_id: string; balance: number };
  phaser_ready: Record<string, never>; // Phaser 场景就绪，React 可同步 agents
  request_sync: Record<string, never>; // 请求从 API 同步 agent 状态（含 in_task）并刷新 NPC
};

type Listener<T> = (data: T) => void;

class EvotownEventBus {
  private listeners: Map<string, Set<Listener<unknown>>> = new Map();

  on<K extends keyof EvotownEventMap>(event: K, fn: Listener<EvotownEventMap[K]>) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<unknown>);
  }

  off<K extends keyof EvotownEventMap>(event: K, fn: Listener<EvotownEventMap[K]>) {
    this.listeners.get(event)?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof EvotownEventMap>(event: K, data: EvotownEventMap[K]) {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }
}

export const evotownEvents = new EvotownEventBus();
