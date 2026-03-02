import Phaser from "phaser";
import { evotownEvents } from "./events";

const PIXEL = 4; // 像素块大小，营造复古感

/** 建筑配置 - 森林小镇风格 */
const BUILDINGS = {
  square: { x: 400, y: 280, label: "中央广场", w: 9, h: 6, roof: "deck" as const, color: 0x8b7355 },
  task: { x: 400, y: 420, label: "任务中心", w: 5, h: 4, roof: "thatched" as const, color: 0x6b5344 },
  library: { x: 180, y: 140, label: "图书馆", w: 4, h: 5, roof: "thatched" as const, color: 0x5c4033 },
  workshop: { x: 400, y: 140, label: "技能工坊", w: 5, h: 4, roof: "gable" as const, color: 0x6b5344 },
  temple: { x: 620, y: 140, label: "进化神殿", w: 5, h: 5, roof: "mushroom" as const, color: 0x4a6741 },
  archive: { x: 180, y: 420, label: "档案馆", w: 4, h: 4, roof: "thatched" as const, color: 0x5c4033 },
  memory: { x: 620, y: 420, label: "记忆仓库", w: 4, h: 4, roof: "gable" as const, color: 0x6b5344 },
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
  const spacing = 28;
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

  constructor() {
    super({ key: "TownScene" });
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

    // 像素小人（白色底，用 setTint 上色）
    const charCanvas = document.createElement("canvas");
    charCanvas.width = 48;
    charCanvas.height = 28;
    const cCtx = charCanvas.getContext("2d")!;
    const px = 4;
    const rows = [
      "....3333....",
      "...333333...",
      "....3333....",
      "...333333...",
      "....3333....",
      "..3333.3333..",
      "..3333.3333..",
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
    lightCanvas.width = 800;
    lightCanvas.height = 560;
    const lCtx2 = lightCanvas.getContext("2d")!;
    const lightGrad = lCtx2.createLinearGradient(0, 0, 0, 560);
    lightGrad.addColorStop(0, "rgba(255, 248, 240, 0.06)");   // 上方略亮
    lightGrad.addColorStop(0.5, "rgba(255, 245, 235, 0.02)");
    lightGrad.addColorStop(1, "rgba(0, 0, 0, 0.04)");         // 下方略暗
    lCtx2.fillStyle = lightGrad;
    lCtx2.fillRect(0, 0, 800, 560);
    this.textures.addCanvas("lightOverlay", lightCanvas);

    // 极淡暗角（仅四角微微收边）
    const vignetteCanvas = document.createElement("canvas");
    vignetteCanvas.width = 800;
    vignetteCanvas.height = 560;
    const vCtx = vignetteCanvas.getContext("2d")!;
    const vigGrad = vCtx.createRadialGradient(400, 280, 200, 400, 280, 550);
    vigGrad.addColorStop(0.6, "rgba(0, 0, 0, 0)");
    vigGrad.addColorStop(0.9, "rgba(0, 0, 0, 0.06)");
    vigGrad.addColorStop(1, "rgba(0, 0, 0, 0.12)");
    vCtx.fillStyle = vigGrad;
    vCtx.fillRect(0, 0, 800, 560);
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

    // 地面细节：小花、石头、蘑菇（草地和路边）
    const groundDetails = [
      { tex: "flower", x: 100, y: 230, scale: 0.8 }, { tex: "flower2", x: 700, y: 210, scale: 0.9 },
      { tex: "flower3", x: 110, y: 470, scale: 0.7 }, { tex: "flower", x: 690, y: 465, scale: 0.75 },
      { tex: "flower2", x: 270, y: 100, scale: 0.8 }, { tex: "flower3", x: 530, y: 95, scale: 0.85 },
      { tex: "flower", x: 265, y: 510, scale: 0.7 }, { tex: "flower2", x: 535, y: 515, scale: 0.8 },
      { tex: "stone", x: 320, y: 250, scale: 1 }, { tex: "stone", x: 480, y: 350, scale: 0.9 },
      { tex: "stone", x: 250, y: 300, scale: 0.85 }, { tex: "stone", x: 550, y: 280, scale: 0.95 },
      { tex: "mushroom", x: 140, y: 350, scale: 0.9 }, { tex: "mushroom", x: 660, y: 320, scale: 0.85 },
      { tex: "mushroom", x: 350, y: 450, scale: 0.8 }, { tex: "mushroom", x: 450, y: 150, scale: 0.9 },
    ];
    groundDetails.forEach(({ tex, x, y, scale }) => {
      const detail = this.add.image(x, y, tex);
      detail.setScale(scale);
      detail.setAlpha(0.9);
    });

    // 装饰：树木（带轻微晃动）
    const treePositions = [
      { x: 120, y: 200 }, { x: 680, y: 200 }, { x: 120, y: 480 }, { x: 680, y: 480 },
      { x: 280, y: 80 }, { x: 520, y: 80 }, { x: 280, y: 520 }, { x: 520, y: 520 },
    ];
    treePositions.forEach(({ x, y }, i) => {
      const tree = this.add.image(x, y + 16, "tree");
      tree.setScale(0.9);
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
      { x: 300, y: 248 }, { x: 500, y: 248 }, { x: 300, y: 328 }, { x: 500, y: 328 },
    ];
    lampPositions.forEach(({ x, y }) => {
      const lamp = this.add.image(x, y, "lamp");
      lamp.setScale(1);
      lamp.setOrigin(0.5, 1);
      lamp.setAlpha(0.95);
    });

    // 烟囱烟（有屋顶的建筑）
    const chimneyPositions = [
      { x: 400, y: 395 }, { x: 180, y: 110 }, { x: 400, y: 110 },
      { x: 180, y: 395 }, { x: 620, y: 395 },
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

    // 建筑（带阴影）
    Object.entries(BUILDINGS).forEach(([key, b]) => {
      const container = this.add.container(b.x, b.y);
      const s = PIXEL * 4;
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
      labelBg.fillRoundedRect(-bw / 2 - 4, bh / 2 + 2, bw + 8, 20, 4);
      labelBg.lineStyle(1, 0x6b5344, 0.7);
      labelBg.strokeRoundedRect(-bw / 2 - 4, bh / 2 + 2, bw + 8, 20, 4);
      container.add(labelBg);

      const label = this.add.text(0, bh / 2 + 12, b.label, {
        fontSize: "11px",
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

    // 精致标题栏
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x1e293b, 0.96);
    titleBg.fillRoundedRect(0, 0, w, 40, 0);
    titleBg.lineStyle(1, 0x334155, 0.6);
    titleBg.lineBetween(0, 40, w, 40);
    this.add.text(w / 2, 20, "◇ EVOTOWN 进化小镇  ·  智能体进化沙盒", {
      fontSize: "14px",
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

    // 订阅事件
    evotownEvents.on("sprite_move", (d) => this.onSpriteMove(d));
    evotownEvents.on("task_complete", (d) => this.onTaskComplete(d));
    evotownEvents.on("agent_eliminated", (d) => this.onAgentEliminated(d));
    evotownEvents.on("agent_created", (d) => this.onAgentCreated(d));
    evotownEvents.on("evolution_event", (d) => this.onEvolutionEvent(d));
  }

  /** 游戏风格道路：正交网格，横竖路网 + 路口 */
  private drawPaths() {
    const g = this.add.graphics();
    const STEP = 40; // 道路网格步长
    const drawn = new Set<string>();
    const key = (x: number, y: number) => `${Math.round(x / STEP) * STEP},${Math.round(y / STEP) * STEP}`;
    const drawTile = (x: number, y: number) => {
      const k = key(x, y);
      if (drawn.has(k)) return;
      drawn.add(k);
      g.fillStyle(0x5c4033, 0.95);
      g.fillRect(x - 16, y - 16, 32, 32);
      g.fillStyle(0x6b5244, 0.5);
      g.fillRect(x - 14, y - 14, 4, 4);
      g.fillRect(x + 6, y + 6, 4, 4);
    };
    /** 沿水平或垂直线段绘制道路瓦片（正交） */
    const drawSegment = (x1: number, y1: number, x2: number, y2: number) => {
      const isHorizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
      const xMin = Math.min(x1, x2);
      const xMax = Math.max(x1, x2);
      const yMin = Math.min(y1, y2);
      const yMax = Math.max(y1, y2);
      if (isHorizontal) {
        const y = Math.round((y1 + y2) / 2 / STEP) * STEP;
        for (let x = Math.floor(xMin / STEP) * STEP; x <= xMax; x += STEP) {
          drawTile(x, y);
        }
        drawTile(xMax, y); // 确保端点
      } else {
        const x = Math.round((x1 + x2) / 2 / STEP) * STEP;
        for (let y = Math.floor(yMin / STEP) * STEP; y <= yMax; y += STEP) {
          drawTile(x, y);
        }
        drawTile(x, yMax); // 确保端点
      }
    };

    // 道路网格布局（正交，类似游戏城镇）
    // 上排横路 y=200：连接 图书馆-工坊-神殿
    drawSegment(140, 200, 660, 200);
    // 下排横路 y=380：连接 档案馆-任务中心-记忆仓库
    drawSegment(140, 380, 660, 380);
    // 中央纵路 x=400：主脊，贯穿上下
    drawSegment(400, 160, 400, 460);
    // 左侧纵路 x=240：连接上排与下排左侧
    drawSegment(240, 200, 240, 380);
    // 右侧纵路 x=560：连接上排与下排右侧
    drawSegment(560, 200, 560, 380);
    // 广场横路 y=280：中央广场前的短横路
    drawSegment(360, 280, 440, 280);
    // 建筑入口支路：从主路到建筑门口
    drawSegment(180, 200, 180, 170); // 图书馆
    drawSegment(620, 200, 620, 170); // 神殿
    drawSegment(180, 380, 180, 420); // 档案馆
    drawSegment(620, 380, 620, 420); // 记忆仓库

    // 路口装饰（交叉点加深）
    const junctions = [
      [240, 200], [400, 200], [560, 200],
      [240, 280], [400, 280], [560, 280],
      [240, 380], [400, 380], [560, 380],
    ];
    junctions.forEach(([jx, jy]) => {
      drawTile(jx, jy);
      g.fillStyle(0x4a3728, 0.5);
      g.fillRect(jx - 18, jy - 18, 4, 4);
      g.fillRect(jx + 12, jy + 12, 4, 4);
    });

    // 道路边缘描边
    g.lineStyle(1, 0x3d2e24, 0.6);
    const segments: Array<[number, number, number, number]> = [
      [140, 200, 660, 200], [140, 380, 660, 380],
      [400, 160, 400, 460], [240, 200, 240, 380], [560, 200, 560, 380],
      [360, 280, 440, 280],
      [180, 170, 180, 200], [620, 170, 620, 200],
      [180, 380, 180, 420], [620, 380, 620, 420],
    ];
    segments.forEach(([x1, y1, x2, y2]) => g.lineBetween(x1, y1, x2, y2));
  }

  /** 右下角：河流蜿蜒流入水池 */
  private drawRiverAndPond() {
    const g = this.add.graphics();

    // 河流（从右边缘蜿蜒流入，用折线模拟曲线）
    g.fillStyle(0x2d6b5a, 0.95);
    g.beginPath();
    g.moveTo(800, 250);
    g.lineTo(790, 320);
    g.lineTo(770, 400);
    g.lineTo(720, 470);
    g.lineTo(650, 520);
    g.lineTo(600, 560);
    g.lineTo(800, 560);
    g.lineTo(800, 250);
    g.closePath();
    g.fill();

    // 河流中层（略浅，形成河岸感）
    g.fillStyle(0x3d8270, 0.9);
    g.beginPath();
    g.moveTo(800, 280);
    g.lineTo(785, 350);
    g.lineTo(755, 430);
    g.lineTo(710, 480);
    g.lineTo(670, 510);
    g.lineTo(800, 510);
    g.lineTo(800, 280);
    g.closePath();
    g.fill();

    // 河流中心（高光水流）
    g.fillStyle(0x4a9c8a, 0.6);
    g.beginPath();
    g.moveTo(800, 320);
    g.lineTo(780, 390);
    g.lineTo(745, 455);
    g.lineTo(700, 495);
    g.lineTo(800, 495);
    g.lineTo(800, 320);
    g.closePath();
    g.fill();

    // 水池（右下角，河流汇入）
    g.fillStyle(0x2d6b5a, 0.95);
    g.fillEllipse(680, 520, 160, 100);
    g.fillStyle(0x3d8270, 0.9);
    g.fillEllipse(670, 510, 120, 75);
    g.fillStyle(0x4a9c8a, 0.5);
    g.fillEllipse(655, 505, 70, 45);
    g.fillStyle(0xffffff, 0.15);
    g.fillEllipse(640, 500, 30, 15);
  }

  /** 森林小镇风格建筑 */
  private drawPixelBuilding(g: Phaser.GameObjects.Graphics, w: number, h: number, roof: string, _color: number) {
    const s = PIXEL * 4;
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
      sprite.setScale(1.3);

      const label = this.add.text(spawn.x, spawn.y + 24, agentId, {
        fontSize: "10px",
        color: "#e2e8f0",
        fontStyle: "bold",
      }).setOrigin(0.5).setPadding(4, 2);

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
        agent.label.y = agent.sprite.y + 24;
      }
    });
  }
}
