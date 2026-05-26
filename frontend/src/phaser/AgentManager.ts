import Phaser from "phaser";
import { CharFacing, setCharFacing } from "./characterAssets";
import { getRandomWanderPoint } from "./taskNpc";
import {
  buildOfficePath,
  clampToOfficeWalkable,
  isOfficeWalkable,
  type WorkstationFacing,
} from "./officeFloorPlan";

export type TaskPhase = "idle" | "accept" | "execute" | "deliver";

export interface AgentState {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Sprite;
  helmet: Phaser.GameObjects.Sprite;
  target: { x: number; y: number };
  pathQueue: { x: number; y: number }[];
  label: Phaser.GameObjects.Text;
  displayName: string;
  color: number;
  avatarId: string;
  phaseOffset: number;
  taskPhase: TaskPhase;
  wanderTimer: number;
  facing: CharFacing;
  /** 到达后保持的朝向（执行任务时面向显示器 = back） */
  restFacing: CharFacing | null;
  pendingBalance: number | null;
  /** 本次交付的胜负，在 onDeliverComplete 时用于播放胜负过场 */
  pendingSuccess: boolean | null;
  eliminating: boolean;
  rescueTarget?: { x: number; y: number };
  teamId?: string;
  teamName?: string;
}

const AGENT_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x3b82f6,
  0x8b5cf6, 0xd946ef, 0xec4899, 0xf43f5e, 0x14b8a6, 0x84cc16,
];

export interface AgentManagerConfig {
  scene: Phaser.Scene;
  worldInner: Phaser.GameObjects.Container;
  getCx: () => number;
  getCy: () => number;
  getWanderSpeed: () => number;
  getTaskSpeed: () => number;
  getMoveThreshold: () => number;
  onAgentCreated?: (agent: AgentState) => void;
}

export class AgentManager {
  private agents: Map<string, AgentState> = new Map();
  private scene: Phaser.Scene;
  private worldInner: Phaser.GameObjects.Container;
  private getCx: () => number;
  private getCy: () => number;
  private getWanderSpeed: () => number;
  private getTaskSpeed: () => number;
  private getMoveThreshold: () => number;
  private onAgentCreated?: (agent: AgentState) => void;

  constructor(config: AgentManagerConfig) {
    this.scene = config.scene;
    this.worldInner = config.worldInner;
    this.getCx = config.getCx;
    this.getCy = config.getCy;
    this.getWanderSpeed = config.getWanderSpeed;
    this.getTaskSpeed = config.getTaskSpeed;
    this.getMoveThreshold = config.getMoveThreshold;
    this.onAgentCreated = config.onAgentCreated;
  }

  get(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  delete(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.container.destroy();
      return this.agents.delete(agentId);
    }
    return false;
  }

  getAll(): Map<string, AgentState> {
    return this.agents;
  }

  getColor(agentId: string): number {
    const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
    return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
  }

  private getFacing(dx: number, dy: number): CharFacing {
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "front" : "back";
    return dx > 0 ? "right" : "left";
  }

  setDestination(
    agent: AgentState,
    worldTarget: { x: number; y: number },
    cx = this.getCx(),
    cy = this.getCy(),
    restFacing: CharFacing | null = null,
  ) {
    // 先把 agent 拉到合法位置，避免起点在墙内导致直线穿墙。
    const worldStart = { x: agent.container.x + cx, y: agent.container.y + cy };
    if (!isOfficeWalkable(worldStart.x, worldStart.y)) {
      const safe = clampToOfficeWalkable(worldStart.x, worldStart.y);
      agent.container.x = safe.x - cx;
      agent.container.y = safe.y - cy;
      worldStart.x = safe.x;
      worldStart.y = safe.y;
    }
    const safeTarget = isOfficeWalkable(worldTarget.x, worldTarget.y)
      ? worldTarget
      : clampToOfficeWalkable(worldTarget.x, worldTarget.y);
    const path = buildOfficePath(worldStart, safeTarget);
    const localPath = path.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    agent.pathQueue = localPath.slice(1);
    agent.target = localPath[0] ?? { x: safeTarget.x - cx, y: safeTarget.y - cy };
    agent.restFacing = restFacing;
  }

  /** 工作位朝向 → CharFacing（保留语义一致）。 */
  static restFacingFromWorkstation(facing: WorkstationFacing): CharFacing {
    return facing;
  }

  update(time: number, delta: number) {
    const cx = this.getCx();
    const cy = this.getCy();
    const speedWander = this.getWanderSpeed();
    const speedTask = this.getTaskSpeed();
    const moveThreshold = this.getMoveThreshold();

    this.agents.forEach((agent, agentId) => {
      // 每帧位置纠错 — 任何情况下都不能停留在墙内
      const worldX = agent.container.x + cx;
      const worldY = agent.container.y + cy;
      if (!isOfficeWalkable(worldX, worldY)) {
        const safe = clampToOfficeWalkable(worldX, worldY);
        agent.container.x = safe.x - cx;
        agent.container.y = safe.y - cy;
      }

      const speed = agent.taskPhase === "idle" ? speedWander : speedTask;
      const dx = agent.target.x - agent.container.x;
      const dy = agent.target.y - agent.container.y;
      const isMoving = Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold;

      if (isMoving) {
        agent.facing = this.getFacing(dx, dy);
        const walkFrame = Math.floor((time + agent.phaseOffset) * 0.004) % 2;
        setCharFacing(agent.base, agent.helmet, agent.facing, walkFrame);
        const stepX = Phaser.Math.Clamp(dx, -speed, speed);
        const stepY = Phaser.Math.Clamp(dy, -speed, speed);
        const nextWorldX = worldX + stepX;
        const nextWorldY = worldY + stepY;
        // 只有走到合法位置才迈步，否则该帧停在原地（防穿墙最后一道关卡）
        if (isOfficeWalkable(nextWorldX, nextWorldY)) {
          agent.container.x += stepX;
          agent.container.y += stepY;
        } else if (agent.pathQueue.length > 0) {
          agent.target = agent.pathQueue.shift()!;
        }
      } else {
        // 已到达：到达工作位时朝向显示器
        const rest = agent.restFacing ?? agent.facing;
        setCharFacing(agent.base, agent.helmet, rest, 0);

        if (agent.pathQueue.length > 0) {
          agent.target = agent.pathQueue.shift()!;
          return;
        }

        // Handle delivery completion
        if (agent.taskPhase === "deliver") {
          this.onDeliverComplete?.(agent, cx, cy, agentId);
        }

        // Idle wandering timer
        if (agent.taskPhase === "idle") {
          agent.wanderTimer += delta;
          if (agent.wanderTimer >= 4000) {
            agent.wanderTimer = 0;
            const wander = getRandomWanderPoint();
            this.setDestination(agent, wander, cx, cy);
          }
        }
      }

      // Body breathing animation
      const t = (time + agent.phaseOffset) * 0.001;
      const scaleDelta = isMoving ? Math.sin(t * 8) * 0.006 : Math.sin(t * 2.5) * 0.005;
      agent.body.setScale(1 + scaleDelta);
    });
  }

  onDeliverComplete?: (agent: AgentState, cx: number, cy: number, agentId: string) => void;

  setDeliverCallback(callback: (agent: AgentState, cx: number, cy: number, agentId: string) => void) {
    this.onDeliverComplete = callback;
  }
}
