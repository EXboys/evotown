import Phaser from "phaser";
import { evotownEvents } from "./events";
import { createCharacterContainer, setCharFacing, type CharFacing } from "./characterAssets";
import { TaskNpcManager, getRandomWanderPoint } from "./taskNpc";
import { NES } from "./nesColors";
import {
  BUILDINGS,
  createBuilding,
  createCastle,
  drawPaths,
  drawRiverAndPond,
  drawForestClusters,
  drawMountainClusters,
  VIEW_SCALE_Y,
  VIEW_FILL_SCALE,
  LABEL_TO_XY,
  TO_LABEL,
} from "./sceneAssets";

type TaskPhase = "idle" | "accept" | "execute" | "deliver";

interface AgentState {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Sprite;
  helmet: Phaser.GameObjects.Sprite;
  target: { x: number; y: number };
  label: Phaser.GameObjects.Text;
  color: number;
  phaseOffset: number;
  taskPhase: TaskPhase;
  wanderTimer: number;
  facing: CharFacing;
  pendingBalance: number | null;
}

export default class TownScene extends Phaser.Scene {
  private agents: Map<string, AgentState> = new Map();
  /** 12 色高区分度调色板：红/橙/黄/绿/青/蓝/紫/品红/粉，按 agentId 哈希稳定分配 */
  private agentColors: number[] = [
    0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x3b82f6,
    0x8b5cf6, 0xd946ef, 0xec4899, 0xf43f5e, 0x14b8a6, 0x84cc16,
  ];
  private buildingRects: Map<string, Phaser.GameObjects.Container> = new Map();
  private worldContainer!: Phaser.GameObjects.Container;
  private worldInner!: Phaser.GameObjects.Container;
  private taskNpcManager!: TaskNpcManager;
  private eventHandlers: Array<{ ev: "sprite_move" | "task_complete" | "agent_eliminated" | "agent_created" | "evolution_event"; fn: (d: unknown) => void }> = [];

  constructor() {
    super({ key: "TownScene" });
  }

  shutdown() {
    this.eventHandlers.forEach(({ ev, fn }) => evotownEvents.off(ev, fn as never));
    this.eventHandlers = [];
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // 世界容器 — 45° 俯视 Y 轴压缩
    this.worldInner = this.add.container(0, 0);
    this.worldInner.setScale(1, VIEW_SCALE_Y);
    this.worldContainer = this.add.container(w / 2, h / 2);
    this.worldContainer.setScale(1, VIEW_FILL_SCALE);
    this.worldContainer.add(this.worldInner);

    const cx = w / 2;
    const cy = h / 2;

    // 1. 地形层 — NES 草地
    const grass = this.add.tileSprite(0, 0, w + 64, h + 64, "grass");
    grass.setTileScale(1);
    this.worldInner.add(grass);

    // 2. 道路层
    drawPaths(this, this.worldInner, cx, cy);

    // 3. 河流
    drawRiverAndPond(this, this.worldInner, cx, cy);

    // 4. 装饰层 — 散落小石头
    const stonePositions = [
      { x: 255, y: 200 }, { x: 385, y: 280 },
      { x: 200, y: 240 }, { x: 440, y: 224 },
      { x: 280, y: 360 }, { x: 360, y: 120 },
      { x: 170, y: 300 }, { x: 460, y: 290 },
    ];
    stonePositions.forEach(({ x, y }) => {
      const stone = this.add.image(x - cx, y - cy, "stone");
      this.worldInner.add(stone);
    });

    // 5. 森林/山脉层 — 前后层叠
    drawForestClusters(this, this.worldInner, cx, cy);
    drawMountainClusters(this, this.worldInner, cx, cy);

    // 6. 建筑层（跳过任务中心，由分散 NPC 替代）
    Object.entries(BUILDINGS).forEach(([key, b]) => {
      if (key === "task") return;
      const container = key === "square"
        ? createCastle(this, b.x - cx, b.y - cy, b.label)
        : createBuilding(this, key, b.x - cx, b.y - cy, b.w, b.h, b.roof, b.label, b.color);
      this.worldInner.add(container);
      this.buildingRects.set(key, container);
    });

    // 6b. 任务 NPC 层 — 有任务才出现，任务数 = NPC 数，一一对应
    this.taskNpcManager = new TaskNpcManager({
      scene: this,
      parent: this.worldInner,
      originX: cx,
      originY: cy,
    });

    // 7. UI 覆盖层 — NES 黑底白边标题栏
    const titleBg = this.add.graphics();
    titleBg.fillStyle(NES.BLACK, 1);
    titleBg.fillRect(0, 0, w, 24);
    titleBg.lineStyle(1, NES.WHITE, 1);
    titleBg.strokeRect(0, 0, w, 24);
    titleBg.setDepth(900);
    titleBg.setScrollFactor(0);
    const titleText = this.add.text(w / 2, 12, "EVOTOWN", {
      fontSize: "14px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    titleText.setDepth(901);
    titleText.setScrollFactor(0);

    // 事件订阅
    const h1 = (d: { agent_id: string; from: string; to: string; reason: string }) => this.onSpriteMove(d);
    const h2 = (d: { agent_id: string; success: boolean; balance: number }) => this.onTaskComplete(d);
    const h3 = (d: { agent_id: string; reason: string }) => this.onAgentEliminated(d);
    const h4 = (d: { agent_id: string; balance: number }) => this.onAgentCreated(d);
    const h5 = (d: { agent_id: string; type?: string; [k: string]: unknown }) => this.onEvolutionEvent(d);
    evotownEvents.on("sprite_move", h1);
    evotownEvents.on("task_complete", h2);
    evotownEvents.on("agent_eliminated", h3);
    evotownEvents.on("agent_created", h4);
    evotownEvents.on("evolution_event", h5);
    this.eventHandlers = [
      { ev: "sprite_move" as const, fn: h1 as (d: unknown) => void },
      { ev: "task_complete" as const, fn: h2 as (d: unknown) => void },
      { ev: "agent_eliminated" as const, fn: h3 as (d: unknown) => void },
      { ev: "agent_created" as const, fn: h4 as (d: unknown) => void },
      { ev: "evolution_event" as const, fn: h5 as (d: unknown) => void },
    ];

    this.time.delayedCall(150, () => evotownEvents.emit("phaser_ready", {}));
  }

  private onEvolutionEvent(data: { agent_id: string; event_type?: string; [k: string]: unknown }) {
    const container = this.buildingRects.get("temple");
    if (container) {
      this.tweens.add({
        targets: container,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 150,
        yoyo: true,
        ease: "Power2",
      });
    }
    this.cameras.main.flash(200, 255, 251, 191);

    const agent = this.agents.get(data.agent_id);
    if (agent) {
      const et = data.event_type as string;
      const msg = et === "rule_added" ? "学到了新规则" : et === "skill_generated" ? "生成了新技能" : "进化完成";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      const bubble = this.add.container(
        cx + agent.container.x,
        cy + agent.container.y * VIEW_SCALE_Y - 25,
      );
      // NES 风格气泡 — 黑底白边，无圆角
      const bg = this.add.graphics();
      bg.fillStyle(NES.BLACK, 1);
      bg.fillRect(-55, -10, 110, 20);
      bg.lineStyle(1, NES.GOLD, 1);
      bg.strokeRect(-55, -10, 110, 20);
      const txt = this.add.text(0, 0, msg, { fontSize: "12px", color: "#FBBF24" }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      bubble.setDepth(800);
      this.tweens.add({
        targets: bubble,
        y: bubble.y - 15,
        duration: 500,
        ease: "Stepped",
      });
      this.time.delayedCall(3500, () => bubble.destroy());
    }
  }

  private onAgentCreated(data: { agent_id: string; balance: number }) {
    const agent = this.getOrCreateAgent(data.agent_id);
    agent.label.setText(String(data.balance));
  }

  private getOrCreateAgent(agentId: string): AgentState {
    let agent = this.agents.get(agentId);
    if (!agent) {
      const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
      const color = this.agentColors[Math.abs(hash) % this.agentColors.length];
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      // 无任务时到处闲逛：出生点随机分布在地图各处，不聚集在城池
      const spawn = getRandomWanderPoint();
      const { container, label, body, base, helmet } = createCharacterContainer(
        this,
        spawn.x - cx,
        spawn.y - cy,
        color,
        "0",
      );
      this.worldInner.add(container);
      const wander = getRandomWanderPoint();
      agent = {
        container,
        body,
        base,
        helmet,
        target: { x: wander.x - cx, y: wander.y - cy },
        label,
        color,
        phaseOffset: Math.random() * Math.PI * 2,
        taskPhase: "idle",
        wanderTimer: 0,
        facing: "front",
        pendingBalance: null,
      };
      this.agents.set(agentId, agent);
    }
    return agent;
  }

  private onSpriteMove(data: { agent_id: string; from: string; to: string; reason: string }) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const agent = this.getOrCreateAgent(data.agent_id);

    // deliver 阶段不响应新的 sprite_move（正在回 NPC 交付）
    if (agent.taskPhase === "deliver") return;

    // 去任务中心 → accept 阶段：生成 NPC，agent 走向 NPC
    if (data.to === "任务中心") {
      agent.taskPhase = "accept";
      const npcPos = this.taskNpcManager.assignToAgent(data.agent_id);
      if (npcPos) {
        agent.target = { x: npcPos.x - cx, y: npcPos.y - cy };
      } else {
        agent.taskPhase = "idle";
        const wander = getRandomWanderPoint();
        agent.target = { x: wander.x - cx, y: wander.y - cy };
      }
      return;
    }

    // 广场/城池 = 闲逛
    if (["广场", "城池", "中央广场"].includes(data.to)) {
      agent.taskPhase = "idle";
      const wander = getRandomWanderPoint();
      agent.target = { x: wander.x - cx, y: wander.y - cy };
      return;
    }

    // 任务建筑（图书馆/工坊/档案馆/记忆仓库）→ execute 阶段
    const key = TO_LABEL[data.to];
    const taskBuildings = ["library", "workshop", "archive", "memory"];
    if (key && LABEL_TO_XY[key] && taskBuildings.includes(key)) {
      agent.taskPhase = "execute";
      this.taskNpcManager.assignToAgent(data.agent_id);
      const pos = LABEL_TO_XY[key];
      agent.target = { x: pos.x - cx, y: pos.y - cy + 12 };
      return;
    }

    // 进化神殿等其它建筑
    if (key && LABEL_TO_XY[key]) {
      agent.taskPhase = "execute";
      const pos = LABEL_TO_XY[key];
      agent.target = { x: pos.x - cx, y: pos.y - cy + 12 };
      return;
    }

    // 兜底：闲逛
    agent.taskPhase = "idle";
    const wander = getRandomWanderPoint();
    agent.target = { x: wander.x - cx, y: wander.y - cy };
  }

  private onTaskComplete(data: { agent_id: string; success: boolean; balance: number }) {
    const agent = this.agents.get(data.agent_id);
    if (!agent) {
      this.taskNpcManager.despawnByAgent(data.agent_id);
      return;
    }

    // deliver 阶段：先存余额，走回 NPC 交付后再更新显示
    agent.pendingBalance = data.balance;
    const npcPos = this.taskNpcManager.getAssignedNpcPosition(data.agent_id);
    if (npcPos) {
      agent.taskPhase = "deliver";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      agent.target = { x: npcPos.x - cx, y: npcPos.y - cy };
    } else {
      // 没有 NPC（边界情况）直接完成
      agent.label.setText(String(data.balance));
      agent.pendingBalance = null;
      agent.taskPhase = "idle";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      const wander = getRandomWanderPoint();
      agent.target = { x: wander.x - cx, y: wander.y - cy };
      this.taskNpcManager.despawnByAgent(data.agent_id);
    }
  }

  private onAgentEliminated(data: { agent_id: string }) {
    const agent = this.agents.get(data.agent_id);
    if (agent) {
      agent.container.destroy();
      this.agents.delete(data.agent_id);
    }
  }

  private getFacing(dx: number, dy: number): CharFacing {
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "front" : "back";
    return dx > 0 ? "right" : "left";
  }

  update(time: number, delta: number) {
    this.taskNpcManager.update(time, delta);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const speedWander = 0.6;
    const speedTask = 1.8;
    const moveThreshold = 1.5;
    this.agents.forEach((agent, agentId) => {
      const speed = agent.taskPhase === "idle" ? speedWander : speedTask;
      const dx = agent.target.x - agent.container.x;
      const dy = agent.target.y - agent.container.y;
      const isMoving = Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold;

      if (isMoving) {
        agent.facing = this.getFacing(dx, dy);
        const walkFrame = Math.floor((time + agent.phaseOffset) * 0.004) % 2;
        setCharFacing(agent.base, agent.helmet, agent.facing, walkFrame);
        agent.container.x += Phaser.Math.Clamp(dx, -speed, speed);
        agent.container.y += Phaser.Math.Clamp(dy, -speed, speed);
      } else {
        setCharFacing(agent.base, agent.helmet, agent.facing, 0);

        // deliver 到达 NPC：更新余额、销毁 NPC、切换 idle 闲逛
        if (agent.taskPhase === "deliver") {
          if (agent.pendingBalance !== null) {
            agent.label.setText(String(agent.pendingBalance));
            agent.pendingBalance = null;
          }
          this.taskNpcManager.despawnByAgent(agentId);
          agent.taskPhase = "idle";
          agent.wanderTimer = 0;
          const wander = getRandomWanderPoint();
          agent.target = { x: wander.x - cx, y: wander.y - cy };
        }

        // idle 定时换闲逛目标
        if (agent.taskPhase === "idle") {
          agent.wanderTimer += delta;
          if (agent.wanderTimer >= 4000) {
            agent.wanderTimer = 0;
            const wander = getRandomWanderPoint();
            agent.target = { x: wander.x - cx, y: wander.y - cy };
          }
        }
      }

      const t = (time + agent.phaseOffset) * 0.001;
      const scaleDelta = isMoving ? Math.sin(t * 8) * 0.006 : Math.sin(t * 2.5) * 0.005;
      agent.body.setScale(1 + scaleDelta);
    });
  }
}
