import Phaser from "phaser";
import { evotownEvents } from "./events";

const PIXEL = 3; // 像素块大小（缩小）

/** 建筑配置 - 错落有致的森林小镇 */
const BUILDINGS = {
  square: { x: 320, y: 224, label: "中央广场", w: 7, h: 5, roof: "deck" as const, color: 0x8b7355 },
  task: { x: 340, y: 340, label: "任务中心", w: 4, h: 3, roof: "thatched" as const, color: 0x6b5344 },
  library: { x: 120, y: 90, label: "图书馆", w: 3, h: 4, roof: "thatched" as const, color: 0x5c4033 },
  workshop: { x: 300, y: 85, label: "技能工坊", w: 4, h: 3, roof: "gable" as const, color: 0x6b5344 },
  temple: { x: 500, y: 100, label: "进化神殿", w: 4, h: 4, roof: "mushroom" as const, color: 0x4a6741 },
  archive: { x: 110, y: 340, label: "档案馆", w: 3, h: 3, roof: "thatched" as const, color: 0x5c4033 },
  memory: { x: 500, y: 335, label: "记忆仓库", w: 3, h: 3, roof: "gable" as const, color: 0x6b5344 },
} as const;

const TO_LABEL: Record<string, string> = {
  广场: "square", 任务中心: "task", 知识图书馆: "library", 图书馆: "library",
  技能工坊: "workshop", 工坊: "workshop", 进化神殿: "temple", 神殿: "temple",
  决策档案馆: "archive", 档案馆: "archive", 记忆仓库: "memory",
};

const LABEL_TO_XY: Record<string, { x: number; y: number }> = {
  square: BUILDINGS.square, task: BUILDINGS.task, library: BUILDINGS.library,
  workshop: BUILDINGS.workshop, temple: BUILDINGS.temple, archive: BUILDINGS.archive, memory: BUILDINGS.memory,
};

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
  sprite: Phaser.GameObjects.Sprite;
  target: { x: number; y: number };
  label: Phaser.GameObjects.Text;
  color: number;
}

export default class TownScene extends Phaser.Scene {
  private agents: Map<string, AgentState> = new Map();
  private agentColors: number[] = [0x3b82f6, 0x10b981, 0xf59e0b, 0xef4444, 0x8b5cf6, 0xec4899];
  private buildingRects: Map<string, Phaser.GameObjects.Container> = new Map();
  private eventHandlers: Array<{ ev: "sprite_move" | "task_complete" | "agent_eliminated" | "agent_created" | "evolution_event"; fn: (d: unknown) => void }> = [];

  constructor() {
    super({ key: "TownScene" });
  }

  shutdown() {
    this.eventHandlers.forEach(({ ev, fn }) => evotownEvents.off(ev, fn as never));
    this.eventHandlers = [];
  }

  preload() {
    // 程序化生成草地瓦片 - 更丰富的层次感
    const grassCanvas = document.createElement("canvas");
    grassCanvas.width = 64;
    grassCanvas.height = 64;
    const ctx = grassCanvas.getContext("2d")!;
    const shades = ["#1e3d0f", "#2d5016", "#3d6b1a", "#4a7c22"];
    for (let i = 0; i < 64; i += 4) {
      for (let j = 0; j < 64; j += 4) {
        const idx = ((i >> 2) + (j >> 2)) % 4;
        const noise = ((i * 7 + j * 13) % 5) === 0 ? 1 : 0;
        ctx.fillStyle = shades[(idx + noise) % shades.length];
        ctx.fillRect(i, j, 4, 4);
      }
    }
    this.textures.addCanvas("grass", grassCanvas);

    // 道路瓦片 - 石砖质感
    const pathCanvas = document.createElement("canvas");
    pathCanvas.width = 32;
    pathCanvas.height = 32;
    const pCtx = pathCanvas.getContext("2d")!;
    pCtx.fillStyle = "#3d2e24";
    pCtx.fillRect(0, 0, 32, 32);
    pCtx.fillStyle = "#5c4033";
    for (let i = 2; i < 30; i += 8) {
      for (let j = 2; j < 30; j += 8) {
        const v = ((i + j) / 8) % 2 ? "#6b5244" : "#4a3728";
        pCtx.fillStyle = v;
        pCtx.fillRect(i, j, 6, 6);
      }
    }
    pCtx.strokeStyle = "#2d2018";
    pCtx.lineWidth = 1;
    pCtx.strokeRect(0, 0, 32, 32);
    this.textures.addCanvas("path", pathCanvas);

    // 像素小人（白色底，用 setTint 上色，缩小版）
    const charCanvas = document.createElement("canvas");
    charCanvas.width = 36;
    charCanvas.height = 21;
    const cCtx = charCanvas.getContext("2d")!;
    const px = 3;
    const rows = [
      "...3333....",
      "..333333...",
      "...3333....",
      "..333333...",
      "...3333....",
      "..333.333..",
      "..333.333..",
    ];
    cCtx.fillStyle = "#ffffff";
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== ".") cCtx.fillRect(i * px, j * px, px, px);
      }
    });
    this.textures.addCanvas("char", charCanvas);

    // 粒子用的小圆点 - 更柔和
    const dotCanvas = document.createElement("canvas");
    dotCanvas.width = 12;
    dotCanvas.height = 12;
    const dCtx = dotCanvas.getContext("2d")!;
    const grad = dCtx.createRadialGradient(6, 6, 0, 6, 6, 5);
    grad.addColorStop(0, "rgba(148, 163, 184, 0.8)");
    grad.addColorStop(1, "rgba(148, 163, 184, 0)");
    dCtx.fillStyle = grad;
    dCtx.fillRect(0, 0, 12, 12);
    this.textures.addCanvas("particle", dotCanvas);

    // 小树装饰
    const treeCanvas = document.createElement("canvas");
    treeCanvas.width = 24;
    treeCanvas.height = 32;
    const tCtx = treeCanvas.getContext("2d")!;
    tCtx.fillStyle = "#2d1810";
    tCtx.fillRect(10, 20, 4, 12);
    tCtx.fillStyle = "#1e4d1e";
    tCtx.beginPath();
    tCtx.moveTo(12, 8);
    tCtx.lineTo(4, 24);
    tCtx.lineTo(20, 24);
    tCtx.closePath();
    tCtx.fill();
    tCtx.fillStyle = "#2d6b2d";
    tCtx.beginPath();
    tCtx.moveTo(12, 4);
    tCtx.lineTo(6, 20);
    tCtx.lineTo(18, 20);
    tCtx.closePath();
    tCtx.fill();
    this.textures.addCanvas("tree", treeCanvas);

    // 木杆提灯（森林风格）
    const lampCanvas = document.createElement("canvas");
    lampCanvas.width = 16;
    lampCanvas.height = 36;
    const lCtx = lampCanvas.getContext("2d")!;
    lCtx.fillStyle = "#6b5344";
    lCtx.fillRect(6, 8, 4, 24);
    lCtx.fillStyle = "#4a3728";
    lCtx.fillRect(6, 28, 4, 4);
    lCtx.fillStyle = "#5c4033";
    lCtx.fillRect(5, 6, 6, 4);
    lCtx.fillStyle = "#fbbf24";
    lCtx.beginPath();
    lCtx.arc(8, 4, 4, 0, Math.PI * 2);
    lCtx.fill();
    lCtx.fillStyle = "rgba(255, 220, 150, 0.6)";
    lCtx.beginPath();
    lCtx.arc(8, 4, 3, 0, Math.PI * 2);
    lCtx.fill();
    this.textures.addCanvas("lamp", lampCanvas);

    // 地面细节：小花
    const flowerCanvas = document.createElement("canvas");
    flowerCanvas.width = 12;
    flowerCanvas.height = 12;
    const flCtx = flowerCanvas.getContext("2d")!;
    flCtx.fillStyle = "#e879f9";
    flCtx.beginPath();
    flCtx.arc(6, 6, 3, 0, Math.PI * 2);
    flCtx.fill();
    flCtx.fillStyle = "#fbbf24";
    flCtx.beginPath();
    flCtx.arc(6, 6, 1.5, 0, Math.PI * 2);
    flCtx.fill();
    this.textures.addCanvas("flower", flowerCanvas);

    const flower2Canvas = document.createElement("canvas");
    flower2Canvas.width = 10;
    flower2Canvas.height = 10;
    const fl2Ctx = flower2Canvas.getContext("2d")!;
    fl2Ctx.fillStyle = "#f472b6";
    fl2Ctx.beginPath();
    fl2Ctx.arc(5, 5, 2.5, 0, Math.PI * 2);
    fl2Ctx.fill();
    this.textures.addCanvas("flower2", flower2Canvas);

    const flower3Canvas = document.createElement("canvas");
    flower3Canvas.width = 8;
    flower3Canvas.height = 8;
    const fl3Ctx = flower3Canvas.getContext("2d")!;
    fl3Ctx.fillStyle = "#fde047";
    fl3Ctx.beginPath();
    fl3Ctx.arc(4, 4, 2, 0, Math.PI * 2);
    fl3Ctx.fill();
    this.textures.addCanvas("flower3", flower3Canvas);

    // 地面细节：小石头
    const stoneCanvas = document.createElement("canvas");
    stoneCanvas.width = 10;
    stoneCanvas.height = 8;
    const stCtx = stoneCanvas.getContext("2d")!;
    stCtx.fillStyle = "#78716c";
    stCtx.beginPath();
    stCtx.ellipse(5, 4, 4, 3, 0.2, 0, Math.PI * 2);
    stCtx.fill();
    stCtx.fillStyle = "#a8a29e";
    stCtx.beginPath();
    stCtx.ellipse(4, 3, 2, 1.5, 0.2, 0, Math.PI * 2);
    stCtx.fill();
    this.textures.addCanvas("stone", stoneCanvas);

    // 地面细节：小蘑菇
    const mushroomCanvas = document.createElement("canvas");
    mushroomCanvas.width = 12;
    mushroomCanvas.height = 14;
    const mushCtx = mushroomCanvas.getContext("2d")!;
    mushCtx.fillStyle = "#6b4423";
    mushCtx.fillRect(5, 6, 2, 8);
    mushCtx.fillStyle = "#dc2626";
    mushCtx.beginPath();
    mushCtx.ellipse(6, 4, 4, 3, 0, 0, Math.PI * 2);
    mushCtx.fill();
    mushCtx.fillStyle = "#fef3c7";
    mushCtx.beginPath();
    mushCtx.arc(5, 3, 1, 0, Math.PI * 2);
    mushCtx.fill();
    mushCtx.beginPath();
    mushCtx.arc(7, 4, 1, 0, Math.PI * 2);
    mushCtx.fill();
    this.textures.addCanvas("mushroom", mushroomCanvas);

    // 烟雾纹理（柔和灰白圆）
    const smokeCanvas = document.createElement("canvas");
    smokeCanvas.width = 24;
    smokeCanvas.height = 24;
    const smCtx = smokeCanvas.getContext("2d")!;
    const smGrad = smCtx.createRadialGradient(12, 12, 0, 12, 12, 12);
    smGrad.addColorStop(0, "rgba(220, 220, 220, 0.6)");
    smGrad.addColorStop(0.5, "rgba(200, 200, 200, 0.25)");
    smGrad.addColorStop(1, "rgba(180, 180, 180, 0)");
    smCtx.fillStyle = smGrad;
    smCtx.fillRect(0, 0, 24, 24);
    this.textures.addCanvas("smoke", smokeCanvas);

    // 萤火虫纹理（暖黄光点）
    const fireflyCanvas = document.createElement("canvas");
    fireflyCanvas.width = 16;
    fireflyCanvas.height = 16;
    const ffCtx = fireflyCanvas.getContext("2d")!;
    const ffGrad = ffCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
    ffGrad.addColorStop(0, "rgba(255, 255, 200, 0.95)");
    ffGrad.addColorStop(0.4, "rgba(255, 240, 150, 0.5)");
    ffGrad.addColorStop(1, "rgba(255, 220, 100, 0)");
    ffCtx.fillStyle = ffGrad;
    ffCtx.fillRect(0, 0, 16, 16);
    this.textures.addCanvas("firefly", fireflyCanvas);

    // 小鸟纹理（像素风 V 形剪影）
    const birdCanvas = document.createElement("canvas");
    birdCanvas.width = 20;
    birdCanvas.height = 10;
    const birdCtx = birdCanvas.getContext("2d")!;
    birdCtx.fillStyle = "#334155";
    birdCtx.beginPath();
    birdCtx.moveTo(2, 5);
    birdCtx.lineTo(8, 2);
    birdCtx.lineTo(14, 5);
    birdCtx.lineTo(18, 4);
    birdCtx.lineTo(14, 6);
    birdCtx.lineTo(8, 8);
    birdCtx.closePath();
    birdCtx.fill();
    this.textures.addCanvas("bird", birdCanvas);

    // 云朵纹理（柔和白灰）
    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.width = 48;
    cloudCanvas.height = 24;
    const cloudCtx = cloudCanvas.getContext("2d")!;
    const cloudGrad = cloudCtx.createRadialGradient(24, 12, 0, 24, 12, 24);
    cloudGrad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    cloudGrad.addColorStop(0.5, "rgba(240, 245, 255, 0.6)");
    cloudGrad.addColorStop(1, "rgba(220, 230, 240, 0)");
    cloudCtx.fillStyle = cloudGrad;
    cloudCtx.beginPath();
    cloudCtx.ellipse(12, 16, 10, 6, 0, 0, Math.PI * 2);
    cloudCtx.ellipse(24, 12, 12, 8, 0, 0, Math.PI * 2);
    cloudCtx.ellipse(36, 16, 10, 6, 0, 0, Math.PI * 2);
    cloudCtx.fill();
    this.textures.addCanvas("cloud", cloudCanvas);

    // 落叶纹理（小叶片）
    const leafCanvas = document.createElement("canvas");
    leafCanvas.width = 8;
    leafCanvas.height = 12;
    const leafCtx = leafCanvas.getContext("2d")!;
    leafCtx.fillStyle = "rgba(139, 90, 43, 0.8)";
    leafCtx.beginPath();
    leafCtx.ellipse(4, 6, 3, 5, 0, 0, Math.PI * 2);
    leafCtx.fill();
    this.textures.addCanvas("leaf", leafCanvas);

    // 自然光照：上亮下暗（天空光）+ 极淡暖色
    const lightCanvas = document.createElement("canvas");
    lightCanvas.width = 640;
    lightCanvas.height = 448;
    const lCtx2 = lightCanvas.getContext("2d")!;
    const lightGrad = lCtx2.createLinearGradient(0, 0, 0, 448);
    lightGrad.addColorStop(0, "rgba(255, 248, 240, 0.06)");   // 上方略亮
    lightGrad.addColorStop(0.5, "rgba(255, 245, 235, 0.02)");
    lightGrad.addColorStop(1, "rgba(0, 0, 0, 0.04)");         // 下方略暗
    lCtx2.fillStyle = lightGrad;
    lCtx2.fillRect(0, 0, 640, 448);
    this.textures.addCanvas("lightOverlay", lightCanvas);

    // 极淡暗角（仅四角微微收边）
    const vignetteCanvas = document.createElement("canvas");
    vignetteCanvas.width = 640;
    vignetteCanvas.height = 448;
    const vCtx = vignetteCanvas.getContext("2d")!;
    const vigGrad = vCtx.createRadialGradient(320, 224, 160, 320, 224, 440);
    vigGrad.addColorStop(0.6, "rgba(0, 0, 0, 0)");
    vigGrad.addColorStop(0.9, "rgba(0, 0, 0, 0.06)");
    vigGrad.addColorStop(1, "rgba(0, 0, 0, 0.12)");
    vCtx.fillStyle = vigGrad;
    vCtx.fillRect(0, 0, 640, 448);
    this.textures.addCanvas("vignette", vignetteCanvas);

  }


  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // 草地背景
    const grass = this.add.tileSprite(w / 2, h / 2, w + 64, h + 64, "grass");
    grass.setTileScale(1);

    // 道路（连接建筑）
    this.drawPaths();

    // 右下角：河流 + 水池
    this.drawRiverAndPond();

    // 地面细节：小花、石头、蘑菇（草地和路边，缩小布局）
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
      const detail = this.add.image(x, y, tex);
      detail.setScale(scale);
      detail.setAlpha(0.9);
    });

    // 装饰：树木（带轻微晃动，错落分布）
    const treePositions = [
      { x: 95, y: 160 }, { x: 545, y: 160 }, { x: 95, y: 384 }, { x: 545, y: 384 },
      { x: 224, y: 64 }, { x: 416, y: 64 }, { x: 224, y: 416 }, { x: 416, y: 416 },
    ];
    treePositions.forEach(({ x, y }, i) => {
      const tree = this.add.image(x, y + 12, "tree");
      tree.setScale(0.7);
      tree.setAlpha(0.85);
      tree.setOrigin(0.5, 1);
      this.tweens.add({
        targets: tree,
        angle: (i % 2 ? 1.2 : -1.2),
        duration: 2200 + i * 180,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    });
    // 装饰：木杆提灯（广场四角外）
    const lampPositions = [
      { x: 240, y: 198 }, { x: 400, y: 198 }, { x: 240, y: 262 }, { x: 400, y: 262 },
    ];
    lampPositions.forEach(({ x, y }) => {
      const lamp = this.add.image(x, y, "lamp");
      lamp.setScale(1);
      lamp.setOrigin(0.5, 1);
      lamp.setAlpha(0.95);
    });

    // 烟囱烟（有屋顶的建筑）
    const chimneyPositions = [
      { x: 340, y: 316 }, { x: 120, y: 88 }, { x: 300, y: 88 },
      { x: 110, y: 316 }, { x: 500, y: 316 },
    ];
    chimneyPositions.forEach(({ x, y }) => {
      this.add.particles(x, y, "smoke", {
        speedY: { min: -18, max: -12 },
        speedX: { min: -8, max: 8 },
        scale: { start: 0.4, end: 0.8 },
        alpha: { start: 0.5, end: 0 },
        lifespan: 2500,
        frequency: 600,
        quantity: 1,
      });
    });

    // 建筑（带阴影，缩小）
    Object.entries(BUILDINGS).forEach(([key, b]) => {
      const container = this.add.container(b.x, b.y);
      const s = PIXEL * 3;
      const bw = b.w * s;
      const bh = b.h * s;

      // 建筑阴影
      const shadow = this.add.graphics();
      shadow.fillStyle(0x0a0a0a, 0.35);
      shadow.fillRoundedRect(-bw / 2 + 4, -bh / 2 + 4, bw, bh, 2);
      container.add(shadow);

      const g = this.add.graphics();
      this.drawPixelBuilding(g, b.w, b.h, b.roof, b.color);
      g.setPosition(-bw / 2, -bh / 2);
      container.add(g);

      const labelBg = this.add.graphics();
      labelBg.fillStyle(0x2d2018, 0.9);
      labelBg.fillRoundedRect(-bw / 2 - 3, bh / 2 + 1, bw + 6, 16, 3);
      labelBg.lineStyle(1, 0x6b5344, 0.7);
      labelBg.strokeRoundedRect(-bw / 2 - 3, bh / 2 + 1, bw + 6, 16, 3);
      container.add(labelBg);

      const label = this.add.text(0, bh / 2 + 9, b.label, {
        fontSize: "9px",
        color: "#e2e8f0",
        fontStyle: "bold",
      }).setOrigin(0.5);
      container.add(label);

      g.setInteractive(new Phaser.Geom.Rectangle(0, 0, bw, bh), Phaser.Geom.Rectangle.Contains);
      g.on("pointerover", () => { container.setAlpha(0.92); container.y = b.y - 2; });
      g.on("pointerout", () => { container.setAlpha(1); container.y = b.y; });

      this.buildingRects.set(key, container);
    });

    // 萤火虫（缓慢飘动）
    this.add.particles(0, 0, "firefly", {
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

    // 落叶（缓慢飘落）
    this.add.particles(0, -20, "leaf", {
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

    // 云朵飘过（同屏云朵同向，风向每 45-60 秒换一次）
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

    // 精致标题栏（缩小）
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
    this.time.addEvent({ delay: 4000, callback: syncFromApi, loop: true });
  }

  /** 沿曲线绘制道路瓦片：贝塞尔二次曲线，带曲折感 */
  private drawPaths() {
    const g = this.add.graphics();
    const STEP = 24; // 道路瓦片步长（缩小）
    const TILE = 20; // 瓦片半宽
    const drawn = new Set<string>();
    const key = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`;
    const drawTile = (x: number, y: number) => {
      const k = key(x, y);
      if (drawn.has(k)) return;
      drawn.add(k);
      g.fillStyle(0x5c4033, 0.95);
      g.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
      g.fillStyle(0x6b5244, 0.5);
      g.fillRect(x - TILE / 2 + 2, y - TILE / 2 + 2, 3, 3);
      g.fillRect(x + TILE / 2 - 5, y + TILE / 2 - 5, 3, 3);
    };
    /** 二次贝塞尔曲线采样点: P(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2 */
    const quadPoints = (x0: number, y0: number, cx: number, cy: number, x2: number, y2: number, n: number) => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * x0 + 2 * mt * t * cx + t * t * x2,
          y: mt * mt * y0 + 2 * mt * t * cy + t * t * y2,
        });
      }
      return pts;
    };
    /** 沿曲线绘制道路 */
    const drawCurvedPath = (x0: number, y0: number, cx: number, cy: number, x2: number, y2: number) => {
      const pts = quadPoints(x0, y0, cx, cy, x2, y2, 20);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(len / STEP));
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          drawTile(a.x + dx * t, a.y + dy * t);
        }
      }
    };
    /** 折线路径（带弯曲拐点） */
    const drawPolyPath = (points: { x: number; y: number }[]) => {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        const perpX = -(b.y - a.y), perpY = b.x - a.x;
        const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
        const bend = (i % 2 === 0 ? 1 : -1) * 15; // 交替弯曲
        const cx = midX + (perpX / len) * bend;
        const cy = midY + (perpY / len) * bend;
        drawCurvedPath(a.x, a.y, cx, cy, b.x, b.y);
      }
    };

    // 曲折道路布局（错落连接各建筑）
    // 上排蜿蜒路：图书馆 → 工坊 → 神殿
    drawPolyPath([
      { x: 120, y: 115 }, { x: 210, y: 95 }, { x: 300, y: 100 }, { x: 400, y: 92 }, { x: 500, y: 105 },
    ]);
    // 下排蜿蜒路：档案馆 → 任务中心 → 记忆仓库
    drawPolyPath([
      { x: 110, y: 355 }, { x: 225, y: 345 }, { x: 340, y: 350 }, { x: 420, y: 342 }, { x: 500, y: 338 },
    ]);
    // 左侧曲折纵路：图书馆下 → 档案馆上
    drawPolyPath([
      { x: 135, y: 115 }, { x: 125, y: 200 }, { x: 118, y: 280 }, { x: 110, y: 355 },
    ]);
    // 右侧曲折纵路：神殿下 → 记忆仓库上
    drawPolyPath([
      { x: 500, y: 105 }, { x: 510, y: 200 }, { x: 505, y: 270 }, { x: 500, y: 338 },
    ]);
    // 中央 S 形路：连接上下
    drawPolyPath([
      { x: 320, y: 92 }, { x: 330, y: 160 }, { x: 315, y: 224 }, { x: 335, y: 290 }, { x: 340, y: 350 },
    ]);
    // 广场前短弯道
    drawCurvedPath(280, 224, 320, 210, 360, 224);
    // 建筑入口支路（小弯）
    drawCurvedPath(120, 115, 118, 100, 120, 85);   // 图书馆
    drawCurvedPath(500, 105, 505, 88, 500, 75);    // 神殿
    drawCurvedPath(110, 355, 105, 365, 110, 375);  // 档案馆
    drawCurvedPath(500, 338, 508, 348, 500, 358); // 记忆仓库
  }

  /** 右下角：河流蜿蜒流入水池（缩小版） */
  private drawRiverAndPond() {
    const g = this.add.graphics();

    // 河流（从右边缘蜿蜒流入）
    g.fillStyle(0x2d6b5a, 0.95);
    g.beginPath();
    g.moveTo(640, 200);
    g.lineTo(632, 256);
    g.lineTo(616, 320);
    g.lineTo(576, 376);
    g.lineTo(520, 416);
    g.lineTo(480, 448);
    g.lineTo(640, 448);
    g.lineTo(640, 200);
    g.closePath();
    g.fillPath();

    g.fillStyle(0x3d8270, 0.9);
    g.beginPath();
    g.moveTo(640, 224);
    g.lineTo(628, 280);
    g.lineTo(604, 344);
    g.lineTo(568, 384);
    g.lineTo(536, 408);
    g.lineTo(640, 408);
    g.lineTo(640, 224);
    g.closePath();
    g.fillPath();

    g.fillStyle(0x4a9c8a, 0.6);
    g.beginPath();
    g.moveTo(640, 256);
    g.lineTo(624, 312);
    g.lineTo(596, 364);
    g.lineTo(560, 396);
    g.lineTo(640, 396);
    g.lineTo(640, 256);
    g.closePath();
    g.fillPath();

    // 水池（右下角）
    g.fillStyle(0x2d6b5a, 0.95);
    g.fillEllipse(544, 416, 128, 80);
    g.fillStyle(0x3d8270, 0.9);
    g.fillEllipse(536, 408, 96, 60);
    g.fillStyle(0x4a9c8a, 0.5);
    g.fillEllipse(524, 404, 56, 36);
    g.fillStyle(0xffffff, 0.15);
    g.fillEllipse(512, 400, 24, 12);
  }

  /** 森林小镇风格建筑（缩小版） */
  private drawPixelBuilding(g: Phaser.GameObjects.Graphics, w: number, h: number, roof: string, _color: number) {
    const s = PIXEL * 3;
    const bw = w * s;
    const bh = h * s;

    // 森林配色
    const wood = 0x8b7355;      // 原木色
    const woodDark = 0x6b5344;  // 深木
    const woodLight = 0xa08060; // 浅木
    const stone = 0x6b5d52;    // 石
    const stoneDark = 0x4a4038;
    const thatch = 0xc4a574;   // 茅草
    const thatchDark = 0x9a7b4a;
    const mushroom = 0x8b5a3c;  // 蘑菇褐
    const mushroomSpot = 0x4a2c1a;

    // 石基
    g.fillStyle(stoneDark, 1);
    g.fillRect(-4, bh, bw + 8, s + 4);
    g.fillStyle(stone, 0.9);
    g.fillRect(-2, bh + 2, bw + 4, s);

    // 木墙（原木纹理）
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
        const c = edge ? woodDark : ((i + j) % 2 ? wood : woodLight);
        g.fillStyle(c, 1);
        g.fillRect(i * s, j * s, s, s);
      }
    }

    // 木窗
    const drawWindow = (x: number, y: number) => {
      g.fillStyle(woodDark, 1);
      g.fillRect(x, y, s - 2, s - 2);
      g.fillStyle(0x87ceeb, 0.5);
      g.fillRect(x + 3, y + 3, (s - 8) / 2, (s - 8) / 2);
      g.fillRect(x + s / 2, y + 3, (s - 8) / 2, (s - 8) / 2);
      g.fillRect(x + 3, y + s / 2, (s - 8) / 2, (s - 8) / 2);
      g.fillRect(x + s / 2, y + s / 2, (s - 8) / 2, (s - 8) / 2);
    };
    if (w >= 4) drawWindow(s + 1, s + 1);
    if (w >= 5) drawWindow((w - 2) * s + 1, s + 1);

    // 木门
    const doorX = (w / 2 - 0.5) * s;
    const doorY = (h - 1) * s;
    g.fillStyle(woodDark, 1);
    g.fillRect(doorX - 2, doorY - 2, s + 4, s + 4);
    g.fillStyle(wood, 1);
    g.fillRect(doorX, doorY, s, s);
    g.fillStyle(woodLight, 0.6);
    g.fillRect(doorX + 2, doorY + 2, s - 4, s - 4);

    // 屋顶
    if (roof === "thatched") {
      // 茅草屋顶
      g.fillStyle(thatchDark, 1);
      for (let i = 0; i < w; i++) {
        for (let r = 0; r < 3; r++) {
          g.fillRect(i * s, -s - r * (s / 2), s, s / 2);
        }
      }
      g.fillStyle(thatch, 0.9);
      for (let i = 0; i < w; i++) {
        g.fillRect(i * s + 2, -s - 2, s - 4, s / 2);
      }
    } else if (roof === "gable") {
      // 三角木屋顶
      g.fillStyle(woodDark, 1);
      for (let i = 0; i < w; i++) {
        g.fillRect(i * s, -s, s, s);
      }
      g.fillStyle(wood, 1);
      g.fillRect((w / 2 - 0.5) * s, -s * 1.5, s, s);
      g.fillStyle(woodLight, 0.5);
      g.fillRect((w / 2 - 0.5) * s + 2, -s * 1.5 + 2, s - 4, s - 4);
    } else if (roof === "mushroom") {
      // 蘑菇顶（神殿）
      g.fillStyle(mushroom, 1);
      g.fillCircle(bw / 2, -s - 6, s * 1.5);
      g.fillStyle(mushroomSpot, 0.8);
      g.fillCircle(bw / 2 - 8, -s - 8, 4);
      g.fillCircle(bw / 2 + 6, -s - 12, 3);
      g.fillStyle(0x7a4a2a, 0.8);
      g.fillRect(bw / 2 - 4, -s - 4, 8, s + 4);
    } else {
      // 木平台（广场）
      g.fillStyle(woodDark, 1);
      g.fillRect(-4, -s, bw + 8, s);
      g.fillStyle(wood, 0.9);
      g.fillRect(-2, -s + 2, bw + 4, s - 4);
      for (let i = 0; i < w; i++) {
        g.fillStyle(woodLight, 0.4);
        g.fillRect(i * s + 2, -s + 4, s - 4, 4);
      }
    }
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
      const bubble = this.add.container(agent.sprite.x, agent.sprite.y - 25);
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
      const sprite = this.add.sprite(spawn.x, spawn.y, "char");
      sprite.setTint(color);
      sprite.setScale(0.9);
      sprite.setDepth(400);

      const label = this.add.text(spawn.x, spawn.y + 18, agentId, {
        fontSize: "9px",
        color: "#e2e8f0",
        fontStyle: "bold",
      }).setOrigin(0.5).setPadding(4, 2);
      label.setDepth(401);

      agent = {
        sprite,
        target: { x: spawn.x, y: spawn.y },
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
    const agent = this.getOrCreateAgent(data.agent_id);
    agent.target = { x: pos.x, y: pos.y };
  }

  private onTaskComplete(data: { agent_id: string; success: boolean; balance: number }) {
    const agent = this.agents.get(data.agent_id);
    if (agent) agent.label.setText(`${data.agent_id} · ${data.balance}`);
  }

  private onAgentEliminated(data: { agent_id: string }) {
    const agent = this.agents.get(data.agent_id);
    if (agent) {
      agent.sprite.destroy();
      agent.label.destroy();
      this.agents.delete(data.agent_id);
    }
  }

  update() {
    const speed = 3;
    this.agents.forEach((agent) => {
      const dx = agent.target.x - agent.sprite.x;
      const dy = agent.target.y - agent.sprite.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        agent.sprite.x += Phaser.Math.Clamp(dx, -speed, speed);
        agent.sprite.y += Phaser.Math.Clamp(dy, -speed, speed);
        agent.label.x = agent.sprite.x;
        agent.label.y = agent.sprite.y + 18;
      }
    });
  }
}
