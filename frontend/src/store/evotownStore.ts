/** Evotown 全局状态 — 进化事件、Agent 列表、裁判评分、分发器 */
import { create } from "zustand";
import { WARRIORS, type WarriorId } from "../phaser/warriorPortraits";

/** 武将 ID 池 */
const WARRIOR_IDS: WarriorId[] = ["kongming", "zhaoyun", "simayi", "zhouyu", "guanyu", "zhangfei", "liubei", "caocao", "sunquan", "zhangliao", "guojia", "huanggai", "lusu"];

/** 根据 agentId 哈希分配一个三国武将显示名，避开 usedNames 中已占用的名字 */
function autoWarriorName(agentId: string, usedNames: Set<string> = new Set()): string {
  const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  const start = Math.abs(hash) % WARRIOR_IDS.length;
  // 从哈希位置开始，找第一个未被占用的武将
  for (let i = 0; i < WARRIOR_IDS.length; i++) {
    const name = WARRIORS[WARRIOR_IDS[(start + i) % WARRIOR_IDS.length]].name;
    if (!usedNames.has(name)) return name;
  }
  // 全部占满时加序号区分
  return WARRIORS[WARRIOR_IDS[start]].name + `·${agentId.slice(-2)}`;
}

export interface AgentInfo {
  id: string;
  display_name?: string;
  balance: number;
  chat_dir?: string;
  status?: string;
  in_task?: boolean;
  soul_type?: string;
  task_count?: number;
  success_count?: number;
  evolution_count?: number;
  evolution_success_count?: number;
  /** 队伍信息（结阵后由 team_formed WS 事件填充） */
  team_id?: string;
  team_name?: string;
}

export interface EvolutionEventItem {
  agent_id: string;
  ts: string;
  type: string;
  target_id?: string;
  reason?: string;
  version?: string;
  event_type?: string;
}

export interface MetricsPoint {
  date: string;
  egl?: number;
  first_success_rate?: number;
  avg_replans?: number;
}

export interface JudgeScore {
  completion: number;
  quality: number;
  efficiency: number;
  total_score: number;
  reward: number;
  reason: string;
  skipped?: boolean;
}

export interface TaskRecord {
  agent_id: string;
  task: string;
  success: boolean;
  judge?: JudgeScore;
  ts: string;
  difficulty?: string;
}

export interface AvailableTask {
  task_id: string;
  task: string;
  difficulty: string;
  created_at: string;
}

export interface DispatcherState {
  running: boolean;
  pool_size: number;
  interval: number;
}

export interface ExperimentInfo {
  experiment_id: string | null;
  config: Record<string, unknown> | null;
}

export interface SocialMessage {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  content: string;
  msg_type: string;
  ts: string;
}

export interface AgentDecision {
  agent_id: string;
  display_name: string;
  solo_preference: boolean;
  evolution_focus: string;
  prev_evolution_focus: string;
  reason: string;
  ts: string;
}

interface EvotownState {
  agents: AgentInfo[];
  availableTasks: AvailableTask[];
  evolutionEvents: EvolutionEventItem[];
  selectedAgentId: string | null;
  metricsCache: Record<string, MetricsPoint[]>;
  evolutionLogCache: Record<string, EvolutionEventItem[]>;
  taskRecords: TaskRecord[];
  dispatcherState: DispatcherState;
  experimentInfo: ExperimentInfo;
  /** 回放模式 — true 时 WebSocket / AgentSync 不分发事件 */
  replayMode: boolean;
  /** Agent 间社交消息（最多 60 条，FIFO） */
  socialMessages: SocialMessage[];
  /** Agent 自主决策记录（最多 60 条，FIFO） */
  agentDecisions: AgentDecision[];

  setReplayMode: (mode: boolean) => void;
  setAgents: (agents: AgentInfo[]) => void;
  addAgent: (agent: AgentInfo) => void;
  updateAgentBalance: (agentId: string, balance: number) => void;
  removeAgent: (agentId: string) => void;
  /** 结阵后批量更新队伍归属，teams = [{team_id, name, members:[agent_id]}] */
  setAgentTeams: (teams: { team_id: string; name: string; members: { agent_id: string }[] }[]) => void;

  addAvailableTask: (task: AvailableTask) => void;
  removeAvailableTask: (taskId: string) => void;
  setAvailableTasks: (tasks: AvailableTask[]) => void;

  pushEvolutionEvent: (ev: EvolutionEventItem) => void;
  setEvolutionLog: (agentId: string, log: EvolutionEventItem[]) => void;
  getEvolutionLog: (agentId: string) => EvolutionEventItem[];

  setSelectedAgent: (id: string | null) => void;
  setMetricsCache: (agentId: string, data: MetricsPoint[]) => void;
  getMetrics: (agentId: string) => MetricsPoint[];

  pushTaskRecord: (record: TaskRecord) => void;
  /** 从持久化 task_history 恢复裁判评分（后台重启后调用） */
  hydrateTaskRecords: (records: TaskRecord[]) => void;
  setDispatcherState: (state: Partial<DispatcherState>) => void;
  setExperimentInfo: (info: ExperimentInfo) => void;
  pushSocialMessage: (msg: SocialMessage) => void;
  pushAgentDecision: (dec: AgentDecision) => void;
}

export const useEvotownStore = create<EvotownState>((set, get) => ({
  agents: [],
  availableTasks: [],
  evolutionEvents: [],
  selectedAgentId: null,
  metricsCache: {},
  evolutionLogCache: {},
  taskRecords: [],
  dispatcherState: { running: false, pool_size: 0, interval: 30 },
  experimentInfo: { experiment_id: null, config: null },
  replayMode: false,
  socialMessages: [],
  agentDecisions: [],

  setReplayMode: (mode) => set({ replayMode: mode }),
  setAgentTeams: (teams) =>
    set((s) => {
      // 构建 agent_id -> {team_id, team_name} 映射
      const map: Record<string, { team_id: string; team_name: string }> = {};
      teams.forEach((t) => {
        t.members.forEach((m) => {
          map[m.agent_id] = { team_id: t.team_id, team_name: t.name };
        });
      });
      return {
        agents: s.agents.map((a) =>
          map[a.id] ? { ...a, team_id: map[a.id].team_id, team_name: map[a.id].team_name } : a
        ),
      };
    }),
  setAgents: (agents) => {
    // 批量分配：始终用三国武将名覆盖后端英文名，逐个去重
    const usedNames = new Set<string>();
    const result = agents.map((a) => {
      // 已经是三国武将名（包含中文）则保留，否则强制分配
      const isChinese = a.display_name && /[\u4e00-\u9fff]/.test(a.display_name);
      if (isChinese && !usedNames.has(a.display_name!)) {
        usedNames.add(a.display_name!);
        return a;
      }
      const name = autoWarriorName(a.id, usedNames);
      usedNames.add(name);
      return { ...a, display_name: name };
    });
    set({ agents: result });
  },
  addAgent: (agent) =>
    set((s) => {
      const usedNames = new Set(s.agents.map((a) => a.display_name).filter(Boolean) as string[]);
      // 已经是中文且未重复则保留，否则强制分配三国武将名
      const isChinese = agent.display_name && /[\u4e00-\u9fff]/.test(agent.display_name);
      const withName = (isChinese && !usedNames.has(agent.display_name!))
        ? agent
        : { ...agent, display_name: autoWarriorName(agent.id, usedNames) };
      const exists = s.agents.some((a) => a.id === agent.id);
      if (exists) {
        return {
          agents: s.agents.map((a) =>
            a.id === agent.id
              ? { ...a, display_name: withName.display_name }
              : a
          ),
        };
      }
      return { agents: [...s.agents, withName] };
    }),
  updateAgentBalance: (agentId, balance) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, balance } : a)),
    })),
  removeAgent: (agentId) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== agentId),
      selectedAgentId: s.selectedAgentId === agentId ? null : s.selectedAgentId,
    })),

  addAvailableTask: (task) =>
    set((s) => ({
      availableTasks: [...s.availableTasks.filter((t) => t.task_id !== task.task_id), task],
    })),
  removeAvailableTask: (taskId) =>
    set((s) => ({
      availableTasks: s.availableTasks.filter((t) => t.task_id !== taskId),
    })),
  setAvailableTasks: (tasks) => set({ availableTasks: tasks }),

  pushEvolutionEvent: (ev) =>
    set((s) => ({
      evolutionEvents: [...s.evolutionEvents, ev].slice(-200),
    })),

  setEvolutionLog: (agentId, log) =>
    set((s) => ({
      evolutionLogCache: { ...s.evolutionLogCache, [agentId]: log },
    })),

  getEvolutionLog: (agentId) => get().evolutionLogCache[agentId] ?? [],

  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  setMetricsCache: (agentId, data) =>
    set((s) => ({
      metricsCache: { ...s.metricsCache, [agentId]: data },
    })),
  getMetrics: (agentId) => get().metricsCache[agentId] ?? [],

  pushTaskRecord: (record) =>
    set((s) => ({
      taskRecords: [...s.taskRecords, record].slice(-100),
    })),

  hydrateTaskRecords: (records) =>
    set({ taskRecords: records.slice(-100) }),

  setDispatcherState: (partial) =>
    set((s) => ({
      dispatcherState: { ...s.dispatcherState, ...partial },
    })),
  setExperimentInfo: (info) => set({ experimentInfo: info }),
  pushSocialMessage: (msg) =>
    set((s) => ({
      socialMessages: [...s.socialMessages, msg].slice(-60),
    })),
  pushAgentDecision: (dec) =>
    set((s) => ({
      agentDecisions: [...s.agentDecisions, dec].slice(-60),
    })),
}));
