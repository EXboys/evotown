/**
 * 任务 NPC 模块 — 分散随机走动的任务发布者
 * NPC 与任务一一对应：有任务才出现 NPC，任务数 = NPC 数，任务消失则 NPC 消失
 */
import Phaser from "phaser";
import { createCharacterContainer, setCharFacing, type CharFacing } from "./characterAssets";
import { CHAR_LAYOUT } from "./characterAssets";

/** NPC 生成点 — 分散在四角与边缘（世界坐标，均在可走区域内） */
const SPAWN_ZONES: { x: number; y: number }[] = [
  { x: 140, y: 115 },   // 左上
  { x: 450, y: 115 },   // 右上（避开河流）
  { x: 140, y: 340 },   // 左下
  { x: 450, y: 340 },   // 右下（避开河流）
  { x: 200, y: 95 },    // 上中左
  { x: 400, y: 95 },    // 上中右
  { x: 135, y: 220 },   // 左中
  { x: 450, y: 220 },   // 右中
  { x: 200, y: 345 },   // 下中左
  { x: 400, y: 345 },   // 下中右
  { x: 280, y: 160 },   // 中心偏左上
  { x: 360, y: 290 },   // 中心偏右下
];

/** NPC 之间最小距离（避免扎堆） */
const MIN_NPC_DISTANCE = 80;

/** 可行走区域边界（世界坐标）— 避开屏幕边缘与水域 */
const BOUNDS = {
  xMin: 135,
  xMax: 465,
  yMin: 105,
  yMax: 370,
};

/** 河流左岸线（y 对应 x 边界，x >= 此为水）— 从 sceneAssets 提取 */
function getRiverShoreX(y: number): number {
  const shoreEdge = [
    { x: 640, y: 200 }, { x: 632, y: 256 }, { x: 616, y: 320 },
    { x: 576, y: 376 }, { x: 520, y: 416 }, { x: 480, y: 448 },
  ];
  for (let i = 0; i < shoreEdge.length - 1; i++) {
    const a = shoreEdge[i], b = shoreEdge[i + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return y < 200 ? 640 : 480;
}

/** 水池区域（需避开） */
const POND = { cx: 544, cy: 416, w: 50, h: 25 };

/** 将坐标限制在可走区域内 */
function clampToWalkable(wx: number, wy: number): { x: number; y: number } {
  let x = Phaser.Math.Clamp(wx, BOUNDS.xMin, BOUNDS.xMax);
  let y = Phaser.Math.Clamp(wy, BOUNDS.yMin, BOUNDS.yMax);
  const shoreX = getRiverShoreX(y) - 15;
  if (x >= shoreX) x = shoreX - 1;
  const dx = Math.abs(x - POND.cx), dy = Math.abs(y - POND.cy);
  if (dx < POND.w && dy < POND.h) {
    if (x > POND.cx) x = POND.cx + POND.w;
    else x = POND.cx - POND.w;
  }
  return { x, y };
}

/** Agent 接任务时与 NPC 的偏移距离（避免重合） */
const AGENT_NPC_OFFSET = 22;

/** 在可走区域内随机取一点（供 Agent 闲逛） */
export function getRandomWanderPoint(): { x: number; y: number } {
  const x = BOUNDS.xMin + Math.random() * (BOUNDS.xMax - BOUNDS.xMin);
  const y = BOUNDS.yMin + Math.random() * (BOUNDS.yMax - BOUNDS.yMin);
  return clampToWalkable(x, y);
}

/** NPC 行走半径范围（像素）— 随机，偏大以延长单次走动 */
const WALK_RADIUS_MIN = 50;
const WALK_RADIUS_MAX = 120;

/** NPC 更换目标间隔范围（毫秒）— 随机，偏长 */
const TARGET_INTERVAL_MIN = 8000;
const TARGET_INTERVAL_MAX = 20000;

/** NPC 行走速度 — 慢速 */
const WALK_SPEED = 0.5;

/** 任务 NPC 颜色（与 Agent 区分，偏黄/橙） */
const NPC_COLORS = [0xe8a317, 0xd97706, 0xb45309, 0xf59e0b];

/** 任务 NPC 名字池 */
const NPC_NAMES = ["任务使", "信使", "委托人", "使者", "任务官", "猎头", "管事", "差役"];

let npcIdCounter = 0;

export interface TaskNpcState {
  id: string;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Sprite;
  helmet: Phaser.GameObjects.Sprite;
  target: { x: number; y: number };
  centerWorld: { x: number; y: number };
  assignedAgentId: string | null;
  targetTimer: number;
  phaseOffset: number;
  facing: CharFacing;
}

export interface TaskNpcManagerConfig {
  scene: Phaser.Scene;
  parent: Phaser.GameObjects.Container;
  originX: number;
  originY: number;
}

/**
 * 任务 NPC 管理器 — 负责生成、随机行走、分配、销毁
 */
export class TaskNpcManager {
  private scene: Phaser.Scene;
  private parent: Phaser.GameObjects.Container;
  private originX: number;
  private originY: number;
  private npcs: Map<string, TaskNpcState> = new Map();
  private agentToNpc: Map<string, string> = new Map();

  constructor(config: TaskNpcManagerConfig) {
    this.scene = config.scene;
    this.parent = config.parent;
    this.originX = config.originX;
    this.originY = config.originY;
    // 不再预生成 NPC，按任务动态生成
  }

  /** 世界坐标转容器内坐标 */
  private worldToLocal(wx: number, wy: number): { x: number; y: number } {
    return { x: wx - this.originX, y: wy - this.originY };
  }

  /** 容器内坐标转世界坐标 */
  private localToWorld(lx: number, ly: number): { x: number; y: number } {
    return { x: lx + this.originX, y: ly + this.originY };
  }

  /** 检查与现有 NPC 的最小距离 */
  private isTooCloseToOthers(wx: number, wy: number): boolean {
    for (const npc of this.npcs.values()) {
      const lw = this.localToWorld(npc.container.x, npc.container.y);
      const dx = lw.x - wx;
      const dy = lw.y - wy;
      if (dx * dx + dy * dy < MIN_NPC_DISTANCE * MIN_NPC_DISTANCE) return true;
    }
    return false;
  }

  /** 在分散的生成点生成一个 NPC（保证与其它 NPC 保持距离） */
  spawnOne(): TaskNpcState | null {
    const shuffled = [...SPAWN_ZONES].sort(() => Math.random() - 0.5);
    for (const zone of shuffled) {
      const jitter = (Math.random() - 0.5) * 24;
      let wx = zone.x + jitter;
      let wy = zone.y + (Math.random() - 0.5) * 24;
      const clamped = clampToWalkable(wx, wy);
      wx = clamped.x;
      wy = clamped.y;
      if (this.isTooCloseToOthers(wx, wy)) continue;

      const local = this.worldToLocal(wx, wy);

      const id = `npc_${++npcIdCounter}`;
      const color = NPC_COLORS[npcIdCounter % NPC_COLORS.length];
      const name = NPC_NAMES[npcIdCounter % NPC_NAMES.length];
      const { container, body, base, helmet } = createCharacterContainer(
        this.scene,
        local.x,
        local.y,
        color,
        name,
      );
      this.parent.add(container);
      container.setDepth(CHAR_LAYOUT.depth - 10);

      const target = this.pickRandomTargetInRadius(wx, wy);
      const nextInterval = TARGET_INTERVAL_MIN + Math.random() * (TARGET_INTERVAL_MAX - TARGET_INTERVAL_MIN);
      const state: TaskNpcState = {
        id,
        container,
        body,
        base,
        helmet,
        target: this.worldToLocal(target.x, target.y),
        centerWorld: { x: wx, y: wy },
        assignedAgentId: null,
        targetTimer: nextInterval,
        phaseOffset: Math.random() * Math.PI * 2,
        facing: "front",
      };
      this.npcs.set(id, state);
      return state;
    }
    return null;
  }

  /** 在中心点半径内随机选一个目标点（半径随机，偏大），限制在可走区域内 */
  private pickRandomTargetInRadius(cx: number, cy: number): { x: number; y: number } {
    const angle = Math.random() * Math.PI * 2;
    const r = WALK_RADIUS_MIN + Math.random() * (WALK_RADIUS_MAX - WALK_RADIUS_MIN);
    const wx = cx + Math.cos(angle) * r;
    const wy = cy + Math.sin(angle) * r;
    return clampToWalkable(wx, wy);
  }

  /** 随机生成下一次更换目标的间隔 */
  private randomTargetInterval(): number {
    return TARGET_INTERVAL_MIN + Math.random() * (TARGET_INTERVAL_MAX - TARGET_INTERVAL_MIN);
  }

  /** 为 agent 生成并分配一个 NPC（任务与 NPC 一一对应），返回 agent 应站的世界坐标（NPC 旁偏移，避免重合） */
  assignToAgent(agentId: string): { x: number; y: number } | null {
    const existingNpcId = this.agentToNpc.get(agentId);
    let npcWorld: { x: number; y: number } | null;
    if (existingNpcId) {
      npcWorld = this.getNpcWorldPosition(existingNpcId);
    } else {
      const npc = this.spawnOne();
      if (!npc) return null;
      npc.assignedAgentId = agentId;
      this.agentToNpc.set(agentId, npc.id);
      npcWorld = this.localToWorld(npc.container.x, npc.container.y);
    }
    if (!npcWorld) return null;
    const angle = Math.random() * Math.PI * 2;
    return {
      x: npcWorld.x + Math.cos(angle) * AGENT_NPC_OFFSET,
      y: npcWorld.y + Math.sin(angle) * AGENT_NPC_OFFSET,
    };
  }

  /** 任务完成，销毁该 agent 对应的 NPC */
  despawnByAgent(agentId: string): void {
    const npcId = this.agentToNpc.get(agentId);
    this.agentToNpc.delete(agentId);
    if (npcId) this.despawn(npcId);
  }

  /** 销毁指定 NPC */
  despawn(npcId: string): void {
    const npc = this.npcs.get(npcId);
    if (npc) {
      npc.container.destroy();
      this.npcs.delete(npcId);
      if (npc.assignedAgentId) this.agentToNpc.delete(npc.assignedAgentId);
    }
  }

  /** 获取 NPC 当前世界坐标（用于 agent 寻路） */
  getNpcWorldPosition(npcId: string): { x: number; y: number } | null {
    const npc = this.npcs.get(npcId);
    if (!npc) return null;
    return this.localToWorld(npc.container.x, npc.container.y);
  }

  /** 获取 agent 所分配 NPC 的当前世界坐标 */
  getAssignedNpcPosition(agentId: string): { x: number; y: number } | null {
    const npcId = this.agentToNpc.get(agentId);
    if (!npcId) return null;
    return this.getNpcWorldPosition(npcId);
  }

  /** 根据 dx,dy 计算朝向 */
  private getFacing(dx: number, dy: number): CharFacing {
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "front" : "back";
    return dx > 0 ? "right" : "left";
  }

  /** 每帧更新 — 随机行走 + 朝向 + 身体浮动/脚步动画 */
  update(time: number, delta: number): void {
    const moveThreshold = 0.8;
    this.npcs.forEach((npc) => {
      const isMoving = !npc.assignedAgentId;
      if (isMoving) {
        const dx = npc.target.x - npc.container.x;
        const dy = npc.target.y - npc.container.y;
        if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
          npc.facing = this.getFacing(dx, dy);
          const walkFrame = Math.floor((time + npc.phaseOffset) * 0.003) % 2;
          setCharFacing(npc.base, npc.helmet, npc.facing, walkFrame);
          npc.container.x += Phaser.Math.Clamp(dx, -WALK_SPEED, WALK_SPEED);
          npc.container.y += Phaser.Math.Clamp(dy, -WALK_SPEED, WALK_SPEED);
        }

        const world = this.localToWorld(npc.container.x, npc.container.y);
        const clamped = clampToWalkable(world.x, world.y);
        npc.container.x = clamped.x - this.originX;
        npc.container.y = clamped.y - this.originY;

        npc.targetTimer -= delta;
        if (npc.targetTimer <= 0) {
          npc.targetTimer = this.randomTargetInterval();
          const curWorld = this.localToWorld(npc.container.x, npc.container.y);
          const newTarget = this.pickRandomTargetInRadius(curWorld.x, curWorld.y);
          npc.target = this.worldToLocal(newTarget.x, newTarget.y);
        }
      }

      if (!isMoving) setCharFacing(npc.base, npc.helmet, npc.facing, 0);
      const t = (time + npc.phaseOffset) * 0.001;
      const scaleDelta = isMoving ? Math.sin(t * 8) * 0.006 : Math.sin(t * 2.5) * 0.005;
      npc.body.setScale(1 + scaleDelta);
    });
  }

  /** 设置场景中心（用于坐标转换，如窗口 resize） */
  setOrigin(ox: number, oy: number): void {
    this.originX = ox;
    this.originY = oy;
  }
}
