import Phaser from "phaser";
import { evotownEvents } from "./events";
import { registerCharacterTextures, createCharacterContainer } from "./characterAssets";
import {
  BUILDINGS,
  TO_LABEL,
  LABEL_TO_XY,
  registerSceneTextures,
  createBuilding,
  drawPaths,
  drawRiverAndPond,
  VIEW_SCALE_Y,
  VIEW_FILL_SCALE,
} from "./sceneAssets";

/** 广场内分散站位：根据 agent_id 哈希到固定格子，避免重叠 */
function getSquareSpreadPos(agentId: string): { x: number; y: number } {
  const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  const idx = Math.abs(hash) % 16;
  const col = idx % 4;
  const row = Math.floor(idx / 4);
  const spacing = 20;
  return {
    x: BUILDINGS.square.x + (col - 1.5) * spacing,
    y: BUILDINGS.square.y + (row - 1.5) * spacing,
  };
}

interface AgentState {
  container: Phaser.GameObjects.Container;
  target: { x: number; y: number };
  label: Phaser.GameObjects.Text;
  color: number;
}

export default class TownScene extends Phaser.Scene {
  private agents: Map<string, AgentState> = new Map();
  private agentColors: number[] = [0x3b82f6, 0x10b981, 0xf59e0b, 0xef4444, 0x8b5cf6, 0xec4899];
  private buildingRects: Map<string, Phaser.GameObjects.Container> = new Map();
  private worldContainer!: Phaser.GameObjects.Container;
  private worldInner!: Phaser.GameObjects.Container;
  private eventHandlers: Array<{ ev: "sprite_move" | "task_complete" | "agent_eliminated" | "agent_created" | "evolution_event"; fn: (d: unknown) => void }> = [];

  constructor() {
    super({ key: "TownScene" });
  }

  shutdown() {
    this.eventHandlers.forEach(({ ev, fn }) => evotownEvents.off(ev, fn as never));
    this.eventHandlers = [];
  }

  preload() {
    registerSceneTextures(this);
    registerCharacterTextures(this);
  }


  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // 世界容器 — 45 度天空俯视（Y 轴压缩）+ 补偿缩放撑满屏幕
    this.worldInner = this.add.container(0, 0);
    this.worldInner.setScale(1, VIEW_SCALE_Y);
    this.worldContainer = this.add.container(w / 2, h / 2);
    this.worldContainer.setScale(1, VIEW_FILL_SCALE);
    this.worldContainer.add(this.worldInner);

    // 草地背景
    const grass = this.add.tileSprite(0, 0, w + 64, h + 64, "grass");
    grass.setTileScale(1);
    this.worldInner.add(grass);

    const cx = w / 2;
    const cy = h / 2;

    drawPaths(this, this.worldInner, cx, cy);
    drawRiverAndPond(this, this.worldInner, cx, cy);

    // 地面细节：小花、石头、蘑菇
    const groundDetails = [
      { tex: "flower", x: 80, y: 180, scale: 0.6 }, { tex: "flower2", x: 560, y: 165, scale: 0.7 },
      { tex: "flower3", x: 90, y: 375, scale: 0.55 }, { tex: "flower", x: 550, y: 370, scale: 0.6 },
      { tex: "flower2", x: 215, y: 75, scale: 0.6 }, { tex: "flower3", x: 425, y: 72, scale: 0.65 },
      { tex: "flower", x: 210, y: 408, scale: 0.55 }, { tex: "flower2", x: 428, y: 412, scale: 0.6 },
      { tex: "stone", x: 255, y: 200, scale: 0.8 }, { tex: "stone", x: 385, y: 280, scale: 0.7 },
      { tex: "stone", x: 200, y: 240, scale: 0.65 }, { tex: "stone", x: 440, y: 224, scale: 0.75 },
      { tex: "mushroom", x: 110, y: 280, scale: 0.7 }, { tex: "mushroom", x: 528, y: 256, scale: 0.65 },
      { tex: "mushroom", x: 280, y: 360, scale: 0.6 }, { tex: "mushroom", x: 360, y: 120, scale: 0.7 },
    ];
    groundDetails.forEach(({ tex, x, y, scale }) => {
      const detail = this.add.image(x - w / 2, y - h / 2, tex);
      detail.setScale(scale);
      detail.setAlpha(0.9);
      this.worldInner.add(detail);
    });

    const treePositions = [
      { x: 95, y: 160 }, { x: 545, y: 160 }, { x: 95, y: 384 }, { x: 545, y: 384 },
      { x: 224, y: 64 }, { x: 416, y: 64 }, { x: 224, y: 416 }, { x: 416, y: 416 },
    ];
    treePositions.forEach(({ x, y }, i) => {
      const tree = this.add.image(x - cx, y - cy + 12, "tree");
      tree.setScale(0.7);
      tree.setAlpha(0.85);
      tree.setOrigin(0.5, 1);
      this.worldInner.add(tree);
      this.tweens.add({
        targets: tree,
        angle: (i % 2 ? 1.2 : -1.2),
        duration: 2200 + i * 180,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    });
    const lampPositions = [
      { x: 240, y: 198 }, { x: 400, y: 198 }, { x: 240, y: 262 }, { x: 400, y: 262 },
    ];
    lampPositions.forEach(({ x, y }) => {
      const lamp = this.add.image(x - cx, y - cy, "lamp");
      lamp.setScale(1);
      lamp.setOrigin(0.5, 1);
      lamp.setAlpha(0.95);
      this.worldInner.add(lamp);
    });

    const chimneyPositions = [
      { x: 340, y: 316 }, { x: 120, y: 88 }, { x: 300, y: 88 },
      { x: 110, y: 316 }, { x: 500, y: 316 },
    ];
    chimneyPositions.forEach(({ x, y }) => {
      const particles = this.add.particles(x - cx, y - cy, "smoke", {
        speedY: { min: -18, max: -12 },
        speedX: { min: -8, max: 8 },
        scale: { start: 0.4, end: 0.8 },
        alpha: { start: 0.5, end: 0 },
        lifespan: 2500,
        frequency: 600,
        quantity: 1,
      });
      this.worldInner.add(particles);
    });

    Object.entries(BUILDINGS).forEach(([key, b]) => {
      const container = createBuilding(this, key, b.x - cx, b.y - cy, b.w, b.h, b.roof, b.label, b.color);
      this.worldInner.add(container);
      this.buildingRects.set(key, container);
    });

    const fireflies = this.add.particles(-cx, -cy, "firefly", {
      x: { min: 80, max: w - 80 },
      y: { min: 120, max: h - 80 },
      lifespan: 6000,
      speedY: { min: -15, max: 15 },
      speedX: { min: -20, max: 20 },
      scale: { start: 0.5, end: 0.3 },
      alpha: { start: 0.7, end: 0.2 },
      quantity: 0.15,
      frequency: 1200,
    });
    this.worldInner.add(fireflies);

    const leaves = this.add.particles(-cx, -20 - cy, "leaf", {
      x: { min: 0, max: w },
      lifespan: 8000,
      speedY: { min: 15, max: 35 },
      speedX: { min: -25, max: 25 },
      scale: { start: 0.6, end: 0.4 },
      alpha: { start: 0.6, end: 0.2 },
      angle: { min: 0, max: 360 },
      rotate: { min: -30, max: 30 },
      quantity: 0.08,
      frequency: 1500,
    });
    this.worldInner.add(leaves);

    // 云朵飘过
    let windFromLeft = Math.random() > 0.5;
    this.time.addEvent({
      delay: 45000 + Math.random() * 15000,
      callback: () => { windFromLeft = Math.random() > 0.5; },
      loop: true,
    });
    const spawnCloudBatch = () => {
      const count = 1 + Math.floor(Math.random() * 2); // 1-2 朵
      for (let i = 0; i < count; i++) {
        this.time.delayedCall(i * 4000, () => {
          const y = 45 + Math.random() * 70;
          const scale = 0.5 + Math.random() * 0.4;
          const cloud = this.add.image(windFromLeft ? -40 : w + 40, y, "cloud");
          cloud.setScale(scale);
          cloud.setAlpha(0.65);
          cloud.setDepth(500);
          cloud.setScrollFactor(0);
          this.tweens.add({
            targets: cloud,
            x: windFromLeft ? w + 60 : -60,
            duration: 14000 + Math.random() * 6000,
            ease: "Linear",
            onComplete: () => cloud.destroy(),
          });
        });
      }
    };
    spawnCloudBatch();
    this.time.addEvent({ delay: 30000 + Math.random() * 20000, callback: spawnCloudBatch, loop: true });

    // 小鸟飞过（偶尔出现，有时 2-3 只结伴）
    const spawnBirdBatch = () => {
      const fromLeft = Math.random() > 0.5;
      const count = Math.random() < 0.4 ? 1 : 2 + Math.floor(Math.random() * 2); // 40% 单只，60% 2-3 只
      for (let i = 0; i < count; i++) {
        this.time.delayedCall(i * 400, () => {
          const y = 55 + Math.random() * 100;
          const bird = this.add.image(fromLeft ? -25 : w + 25, y, "bird");
          bird.setScale(0.7 + Math.random() * 0.3);
          bird.setAlpha(0.8);
          bird.setDepth(600);
          bird.setScrollFactor(0);
          if (!fromLeft) bird.setFlipX(true);
          this.tweens.add({
            targets: bird,
            x: fromLeft ? w + 35 : -35,
            duration: 2800 + Math.random() * 1200,
            ease: "Linear",
            onComplete: () => bird.destroy(),
          });
          this.tweens.add({
            targets: bird,
            y: bird.y + (Math.random() - 0.5) * 30,
            duration: 1400,
            yoyo: true,
            repeat: 1,
            ease: "Sine.easeInOut",
          });
        });
      }
    };
    this.time.addEvent({ delay: 18000 + Math.random() * 12000, callback: spawnBirdBatch, loop: true });

    // 精致标题栏
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x1e293b, 0.96);
    titleBg.fillRoundedRect(0, 0, w, 32, 0);
    titleBg.lineStyle(1, 0x334155, 0.6);
    titleBg.lineBetween(0, 32, w, 32);
    this.add.text(w / 2, 16, "◇ EVOTOWN 进化小镇  ·  智能体进化沙盒", {
      fontSize: "12px",
      color: "#cbd5e1",
      fontStyle: "bold",
    }).setOrigin(0.5);

    // 光照氛围层：上亮下暗 + 极淡暗角
    const lightOverlay = this.add.image(w / 2, h / 2, "lightOverlay").setDepth(999);
    lightOverlay.setDisplaySize(w, h);
    lightOverlay.setScrollFactor(0);

    const vignetteOverlay = this.add.image(w / 2, h / 2, "vignette").setDepth(1000);
    vignetteOverlay.setDisplaySize(w, h);
    vignetteOverlay.setScrollFactor(0);

    // 订阅事件（保存引用以便 shutdown 时移除）
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
    // 延迟发出，确保 React 已订阅 phaser_ready
    this.time.delayedCall(150, () => evotownEvents.emit("phaser_ready", {}));
    // 直接从 API 拉取 agents（刷新后恢复人物）
    const sceneKey = "TownScene";
    const syncFromApi = () => {
      if (!this.scene.isActive(sceneKey)) return;
      fetch("/agents")
        .then((r) => r.json())
        .then((list: { id: string; balance: number; in_task?: boolean }[]) => {
          if (this.scene.isActive(sceneKey) && Array.isArray(list) && list.length > 0) {
            list.forEach((a) => {
              this.onAgentCreated({ agent_id: a.id, balance: a.balance });
              // 根据 in_task 恢复 sprite 位置（刷新后正确还原）
              this.onSpriteMove({
                agent_id: a.id,
                from: "",
                to: a.in_task ? "任务中心" : "广场",
                reason: "sync",
              });
            });
          }
        })
        .catch(() => {});
    };
    syncFromApi();
    this.time.delayedCall(200, syncFromApi);
    this.time.delayedCall(500, syncFromApi);
    this.time.delayedCall(1200, syncFromApi);
    this.time.delayedCall(2500, syncFromApi);
    this.time.addEvent({ delay: 15_000, callback: syncFromApi, loop: true });
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
        cy + agent.container.y * VIEW_SCALE_Y - 25
      );
      const bg = this.add.graphics();
      bg.fillStyle(0x1e293b, 0.95);
      bg.fillRoundedRect(-55, -14, 110, 28, 6);
      bg.lineStyle(2, 0xfbbf24, 1);
      bg.strokeRoundedRect(-55, -14, 110, 28, 6);
      const txt = this.add.text(0, 0, msg, { fontSize: "12px", color: "#fde047" }).setOrigin(0.5);
      bubble.add([bg, txt]);
      this.tweens.add({
        targets: bubble,
        y: bubble.y - 15,
        alpha: 0.8,
        duration: 500,
        ease: "Power2",
      });
      this.time.delayedCall(3500, () => bubble.destroy());
    }
  }

  private onAgentCreated(data: { agent_id: string; balance: number }) {
    const agent = this.getOrCreateAgent(data.agent_id);
    agent.label.setText(`${data.agent_id} · ${data.balance}`);
  }

  private getOrCreateAgent(agentId: string): AgentState {
    let agent = this.agents.get(agentId);
    if (!agent) {
      const color = this.agentColors[this.agents.size % this.agentColors.length];
      const spawn = getSquareSpreadPos(agentId);
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      const { container, label } = createCharacterContainer(
        this,
        spawn.x - cx,
        spawn.y - cy,
        color,
        agentId
      );
      this.worldInner.add(container);
      agent = {
        container,
        target: { x: spawn.x - cx, y: spawn.y - cy },
        label,
        color,
      };
      this.agents.set(agentId, agent);
    }
    return agent;
  }

  private onSpriteMove(data: { agent_id: string; from: string; to: string; reason: string }) {
    const key = TO_LABEL[data.to] || "square";
    const base = LABEL_TO_XY[key] || BUILDINGS.square;
    const pos = key === "square" ? getSquareSpreadPos(data.agent_id) : base;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const agent = this.getOrCreateAgent(data.agent_id);
    agent.target = { x: pos.x - cx, y: pos.y - cy };
  }

  private onTaskComplete(data: { agent_id: string; success: boolean; balance: number }) {
    const agent = this.agents.get(data.agent_id);
    if (agent) agent.label.setText(`${data.agent_id} · ${data.balance}`);
  }

  private onAgentEliminated(data: { agent_id: string }) {
    const agent = this.agents.get(data.agent_id);
    if (agent) {
      agent.container.destroy();
      this.agents.delete(data.agent_id);
    }
  }

  update() {
    const speed = 3;
    this.agents.forEach((agent) => {
      const dx = agent.target.x - agent.container.x;
      const dy = agent.target.y - agent.container.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        agent.container.x += Phaser.Math.Clamp(dx, -speed, speed);
        agent.container.y += Phaser.Math.Clamp(dy, -speed, speed);
      }
    });
  }
}
