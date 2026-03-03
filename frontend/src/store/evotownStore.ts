/** Evotown 全局状态 — 进化事件、Agent 列表、裁判评分、分发器 */
import { create } from "zustand";

export interface AgentInfo {
  id: string;
  balance: number;
  chat_dir?: string;
  status?: string;
  in_task?: boolean;
  soul_type?: string;
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

export interface DispatcherState {
  running: boolean;
  pool_size: number;
  interval: number;
}

export interface ExperimentInfo {
  experiment_id: string | null;
  config: Record<string, unknown> | null;
}

interface EvotownState {
  agents: AgentInfo[];
  evolutionEvents: EvolutionEventItem[];
  selectedAgentId: string | null;
  metricsCache: Record<string, MetricsPoint[]>;
  evolutionLogCache: Record<string, EvolutionEventItem[]>;
  taskRecords: TaskRecord[];
  dispatcherState: DispatcherState;
  experimentInfo: ExperimentInfo;

  setAgents: (agents: AgentInfo[]) => void;
  addAgent: (agent: AgentInfo) => void;
  updateAgentBalance: (agentId: string, balance: number) => void;
  removeAgent: (agentId: string) => void;

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
}

export const useEvotownStore = create<EvotownState>((set, get) => ({
  agents: [],
  evolutionEvents: [],
  selectedAgentId: null,
  metricsCache: {},
  evolutionLogCache: {},
  taskRecords: [],
  dispatcherState: { running: false, pool_size: 0, interval: 30 },
  experimentInfo: { experiment_id: null, config: null },

  setAgents: (agents) => set({ agents }),
  addAgent: (agent) =>
    set((s) => {
      if (s.agents.some((a) => a.id === agent.id)) return s;
      return { agents: [...s.agents, agent] };
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
}));
