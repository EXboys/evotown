/** Evotown 事件总线 — React/WS 与 Phaser 通信 */
export type EvotownEventMap = {
  sprite_move: { agent_id: string; from: string; to: string; reason: string };
  task_complete: { agent_id: string; success: boolean; balance: number };
  task_available: { task_id: string; task: string; difficulty: string };
  task_taken: { task_id: string; agent_id: string; task: string };
  task_expired: { task_id: string; task: string };
  evolution_event: { agent_id: string; type?: string; [k: string]: unknown };
  agent_eliminated: { agent_id: string; reason: string };
  agent_created: { agent_id: string; balance: number; display_name?: string };
  phaser_ready: Record<string, never>; // Phaser 场景就绪，React 可同步 agents
  request_sync: Record<string, never>; // 请求从 API 同步 agent 状态（含 in_task）并刷新 NPC
  /** Agent 间通信事件 */
  agent_message: {
    from_id: string;
    from_name: string;
    to_id: string;
    to_name: string;
    content: string;
    msg_type: string;
    ts: string;
  };
  /** Agent 自主社会决策事件 */
  agent_decision: {
    agent_id: string;
    display_name: string;
    solo_preference: boolean;
    evolution_focus: string;
    prev_evolution_focus: string;
    reason: string;
    ts: string;
  };
  /** 结阵事件：队伍分配完成，Phaser 更新旗帜颜色 */
  team_formed: {
    teams: { team_id: string; name: string; members: { agent_id: string; display_name: string }[] }[];
  };
  /** 救援事件：施救者走向受救者，显示爱心+金币 */
  rescue_event: {
    donor_id: string;
    donor_display_name: string;
    target_id: string;
    target_display_name: string;
    amount: number;
    team_id: string;
    team_name: string;
  };
  /** 最后一战事件：agent 余额首次归零，获得复活机会 */
  agent_last_stand: {
    agent_id: string;
    display_name: string;
    balance: number;
  };
  /** 直播大字幕广播：重要事件文本 */
  subtitle_broadcast: {
    text: string;
    level: string; // "info" | "last_stand" | "elimination" | "defection"
  };
  /** 叛逃事件：agent 忠诚度崩溃，离开原队伍投奔新队伍 */
  agent_defected: {
    agent_id: string;
    display_name: string;
    old_team_id: string;
    old_team_name: string;
    new_team_id: string;
    new_team_name: string;
  };
  /** 军团宗旨生成完成：LLM 返回文言文宗旨 */
  team_creed_generated: {
    team_id: string;
    team_name: string;
    creed: string;
  };
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
