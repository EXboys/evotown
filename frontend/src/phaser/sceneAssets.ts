/**
 * 场景资产 — 企业办公园区像素俯视地图（NES 受限调色板）
 * 所有纹理程序化生成；禁止渐变、半透明、抗锯齿、圆角
 */
import Phaser from "phaser";
import { NES, NES_HEX } from "./nesColors";
import { OFFICE_BUILDINGS } from "./officeFloorPlan";

const PIXEL = 2;

/** 建筑配置 — 与室内平面图房间对齐 */
export const BUILDINGS = OFFICE_BUILDINGS;

export const TO_LABEL: Record<string, string> = {
  广场: "square", 城池: "square", 中央广场: "square", 开放办公区: "square", 开放工位: "square", 办公区: "square",
  任务中心: "task", 任务看板: "task", 工单台: "task",
  知识图书馆: "library", 图书馆: "library", 知识库: "library",
  技能工坊: "workshop", 工坊: "workshop", "Skill 工坊": "workshop", 研发室: "workshop", 项目室: "workshop",
  进化神殿: "temple", 神殿: "temple", 升级中心: "temple",
  决策档案馆: "archive", 档案馆: "archive", 归档室: "archive",
  记忆仓库: "memory", 记忆仓: "memory", 资料室: "memory", 数据资料室: "memory",
};

export const LABEL_TO_XY: Record<string, { x: number; y: number }> = {
  square: BUILDINGS.square, task: BUILDINGS.task, library: BUILDINGS.library,
  workshop: BUILDINGS.workshop, temple: BUILDINGS.temple, archive: BUILDINGS.archive, memory: BUILDINGS.memory,
};

/** 室内平面图 — 正俯视，不做伪 3D 压扁 */
export const VIEW_SCALE_Y = 1;
export const VIEW_FILL_SCALE = 1;

// ── 像素绘制工具函数 ──────────────────────────────────────────

/** NES 风格尖三角山峰 (Canvas 2D) */
function drawPixelMountainPeak(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  height: number,
  maxHW: number,
) {
  for (let r = 0; r < height; r++) {
    const y = baseY - height + r;
    const progress = r / height;
    const hw = Math.max(1, Math.floor(maxHW * progress));

    if (r < 3) {
      ctx.fillStyle = NES_HEX.MTN_PEAK;
      ctx.fillRect(cx - hw, y, hw * 2, 1);
    } else if (r < height * 0.45) {
      ctx.fillStyle = NES_HEX.MTN_MID;
      ctx.fillRect(cx - hw, y, hw, 1);
      ctx.fillStyle = NES_HEX.MTN_LIGHT;
      ctx.fillRect(cx, y, hw, 1);
    } else {
      ctx.fillStyle = NES_HEX.MTN_DARK;
      ctx.fillRect(cx - hw, y, hw, 1);
      ctx.fillStyle = NES_HEX.MTN_MID;
      ctx.fillRect(cx, y, hw, 1);
    }

    ctx.fillStyle = NES_HEX.OUTLINE;
    ctx.fillRect(cx - hw - 1, y, 1, 1);
    ctx.fillRect(cx + hw, y, 1, 1);
  }
  const finalHW = Math.max(1, Math.floor(maxHW));
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.fillRect(cx - finalHW - 1, baseY, finalHW * 2 + 2, 1);
}

/** NES 风格圆顶岩石 (Canvas 2D) */
function drawPixelRock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.fillRect(x + 2, y, 4, 1);
  ctx.fillRect(x + 1, y + 1, 1, 1);
  ctx.fillRect(x + 6, y + 1, 1, 1);
  ctx.fillRect(x, y + 2, 1, 2);
  ctx.fillRect(x + 7, y + 2, 1, 2);
  ctx.fillRect(x + 1, y + 4, 1, 1);
  ctx.fillRect(x + 6, y + 4, 1, 1);
  ctx.fillRect(x + 2, y + 5, 4, 1);

  ctx.fillStyle = NES_HEX.ROCK_BROWN;
  ctx.fillRect(x + 2, y + 1, 4, 1);
  ctx.fillRect(x + 1, y + 2, 6, 2);
  ctx.fillRect(x + 2, y + 4, 4, 1);

  ctx.fillStyle = NES_HEX.ROCK_HIGHLIGHT;
  ctx.fillRect(x + 2, y + 1, 2, 1);
  ctx.fillRect(x + 1, y + 2, 3, 1);
}

/** NES 风格窄锥形树木 (Canvas 2D, 分层锥) */
function drawPixelTree(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  height: number,
  maxHW: number,
  tiers: number,
) {
  const trunkH = 2;
  const canopyH = height - trunkH;
  const tierH = Math.floor(canopyH / tiers);

  for (let t = 0; t < tiers; t++) {
    const startY = baseY - height + t * tierH;
    for (let r = 0; r < tierH; r++) {
      const y = startY + r;
      const progress = r / tierH;
      const hw = Math.max(1, Math.floor(1 + (maxHW - 1) * progress));

      ctx.fillStyle = NES_HEX.TREE_DARK;
      ctx.fillRect(cx - hw, y, hw, 1);
      ctx.fillStyle = NES_HEX.TREE_LIGHT;
      ctx.fillRect(cx, y, hw, 1);

      ctx.fillStyle = NES_HEX.OUTLINE;
      ctx.fillRect(cx - hw - 1, y, 1, 1);
      ctx.fillRect(cx + hw, y, 1, 1);
    }
  }

  // 顶部轮廓点
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.fillRect(cx - 1, baseY - height - 1, 2, 1);

  // 树干
  ctx.fillStyle = NES_HEX.TREE_TRUNK;
  ctx.fillRect(cx - 1, baseY - trunkH, 2, trunkH);
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.fillRect(cx - 2, baseY - trunkH, 1, trunkH);
  ctx.fillRect(cx + 1, baseY - trunkH, 1, trunkH);
}

// ── 纹理注册 ──────────────────────────────────────────────────

export function registerSceneTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  // 草地 — NES 有序抖动 16×16
  const grassCanvas = document.createElement("canvas");
  grassCanvas.width = 16;
  grassCanvas.height = 16;
  const gCtx = grassCanvas.getContext("2d")!;
  gCtx.fillStyle = NES_HEX.GRASS_BASE;
  gCtx.fillRect(0, 0, 16, 16);
  gCtx.fillStyle = NES_HEX.GRASS_DOT;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      if ((i + j) % 3 === 0) gCtx.fillRect(i, j, 1, 1);
    }
  }
  textures.addCanvas("grass", grassCanvas);

  // 走廊地面 — 16×16
  const roadCanvas = document.createElement("canvas");
  roadCanvas.width = 16;
  roadCanvas.height = 16;
  const rCtx = roadCanvas.getContext("2d")!;
  rCtx.fillStyle = NES_HEX.ROAD_BASE;
  rCtx.fillRect(0, 0, 16, 16);
  rCtx.fillStyle = NES_HEX.ROAD_DOT;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      if ((i + j) % 3 === 0) rCtx.fillRect(i, j, 1, 1);
    }
  }
  textures.addCanvas("road", roadCanvas);

  // 机柜 — 数据中心装饰
  const rackCanvas = document.createElement("canvas");
  rackCanvas.width = 12;
  rackCanvas.height = 16;
  drawPixelServerRack(rackCanvas.getContext("2d")!, 6, 15);
  textures.addCanvas("mountainPeak", rackCanvas);

  // 工位隔板
  const rockCanvas = document.createElement("canvas");
  rockCanvas.width = 10;
  rockCanvas.height = 8;
  drawPixelCubicleDivider(rockCanvas.getContext("2d")!, 5, 7);
  textures.addCanvas("mountainRock", rockCanvas);

  // 盆栽（密集）
  const denseTreeCanvas = document.createElement("canvas");
  denseTreeCanvas.width = 10;
  denseTreeCanvas.height = 14;
  drawPixelOfficePlant(denseTreeCanvas.getContext("2d")!, 5, 13, 10);
  textures.addCanvas("forestTree", denseTreeCanvas);

  // 盆栽（稀疏）
  const sparseTreeCanvas = document.createElement("canvas");
  sparseTreeCanvas.width = 8;
  sparseTreeCanvas.height = 12;
  drawPixelOfficePlant(sparseTreeCanvas.getContext("2d")!, 4, 11, 8);
  textures.addCanvas("sparseTree", sparseTreeCanvas);

  // 工位椅 — 小装饰
  const stoneCanvas = document.createElement("canvas");
  stoneCanvas.width = 8;
  stoneCanvas.height = 8;
  drawPixelDeskChair(stoneCanvas.getContext("2d")!, 4, 7);
  textures.addCanvas("stone", stoneCanvas);
}

/** 办公盆栽 */
function drawPixelOfficePlant(ctx: CanvasRenderingContext2D, cx: number, baseY: number, height: number) {
  ctx.fillStyle = NES_HEX.TREE_TRUNK;
  ctx.fillRect(cx - 2, baseY - 3, 4, 3);
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.fillRect(cx - 3, baseY - 2, 6, 2);
  const h = Math.max(4, height - 4);
  for (let r = 0; r < h; r++) {
    const hw = Math.max(1, Math.floor((r + 1) * 0.45));
    ctx.fillStyle = r < h * 0.4 ? NES_HEX.TREE_LIGHT : NES_HEX.TREE_DARK;
    ctx.fillRect(cx - hw, baseY - 3 - r, hw * 2, 1);
  }
}

/** 机柜 */
function drawPixelServerRack(ctx: CanvasRenderingContext2D, cx: number, baseY: number) {
  ctx.fillStyle = "#485868";
  ctx.fillRect(cx - 5, baseY - 14, 10, 14);
  ctx.fillStyle = "#687888";
  for (let row = 0; row < 4; row++) {
    ctx.fillRect(cx - 4, baseY - 13 + row * 3, 8, 2);
    ctx.fillStyle = "#38BDF8";
    ctx.fillRect(cx - 2, baseY - 12 + row * 3, 2, 1);
    ctx.fillStyle = "#687888";
  }
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.strokeRect(cx - 5, baseY - 14, 10, 14);
}

/** 工位隔板 */
function drawPixelCubicleDivider(ctx: CanvasRenderingContext2D, cx: number, baseY: number) {
  ctx.fillStyle = "#A8B0BC";
  ctx.fillRect(cx - 4, baseY - 6, 8, 6);
  ctx.fillStyle = "#8898A8";
  ctx.fillRect(cx - 3, baseY - 5, 6, 1);
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.strokeRect(cx - 4, baseY - 6, 8, 6);
}

/** 工位椅 */
function drawPixelDeskChair(ctx: CanvasRenderingContext2D, cx: number, baseY: number) {
  ctx.fillStyle = "#5C6674";
  ctx.fillRect(cx - 3, baseY - 2, 6, 2);
  ctx.fillStyle = "#4A90D8";
  ctx.fillRect(cx - 2, baseY - 5, 4, 3);
  ctx.fillStyle = NES_HEX.OUTLINE;
  ctx.fillRect(cx - 2, baseY - 6, 4, 1);
}

// ── 建筑绘制 ──────────────────────────────────────────────────

/** NES 风格建筑 — 白墙棕顶、深色门洞、1px 黑轮廓 */
function drawPixelBuilding(g: Phaser.GameObjects.Graphics, w: number, h: number) {
  const s = PIXEL * 3;
  const bw = w * s;
  const bh = h * s;
  const d = 10;

  // 地基 — 棕色基座
  g.fillStyle(NES.ROOF_BROWN, 1);
  g.fillRect(-d - 2, bh + 2, bw + d * 2 + 4, s + 4);
  g.fillStyle(NES.ROOF_DARK, 1);
  g.fillRect(-d - 2, bh + 2, d + 2, s + 4);
  g.fillRect(bw, bh + 2, d + 2, s + 4);

  // 左侧面
  g.fillStyle(0xa08050, 1);
  g.beginPath();
  g.moveTo(-d, bh);
  g.lineTo(0, bh);
  g.lineTo(0, 0);
  g.lineTo(-d, 0);
  g.closePath();
  g.fillPath();
  for (let j = 0; j < h; j++) {
    const base = j % 2 ? 0x907040 : 0x806830;
    g.fillStyle(base, 1);
    g.fillRect(-d + 1, j * s + 1, d - 2, s - 1);
  }

  // 右侧面
  g.fillStyle(0x907040, 1);
  g.beginPath();
  g.moveTo(bw, bh);
  g.lineTo(bw + d, bh);
  g.lineTo(bw + d, 0);
  g.lineTo(bw, 0);
  g.closePath();
  g.fillPath();
  for (let j = 0; j < h; j++) {
    const base = j % 2 ? 0x806830 : 0x705820;
    g.fillStyle(base, 1);
    g.fillRect(bw + 1, j * s + 1, d - 2, s - 1);
  }

  // 正面墙体 — 白墙
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      g.fillStyle(edge ? NES.WALL_EDGE : NES.WALL_WHITE, 1);
      g.fillRect(i * s, j * s, s, s);
    }
  }

  // 玻璃窗格
  const drawWindow = (x: number, y: number) => {
    g.fillStyle(NES.ROOF_DARK, 1);
    g.fillRect(x - 1, y - 1, s + 2, s + 2);
    g.fillStyle(NES.WINDOW_GLASS, 1);
    g.fillRect(x, y, s, s);
    g.fillStyle(NES.WINDOW_GLASS_LIGHT, 1);
    g.fillRect(x, y, Math.max(1, s - 2), 1);
  };
  for (let wi = 1; wi < w - 1; wi++) {
    for (let wj = 1; wj < h - 1; wj++) {
      if ((wi + wj) % 2 === 0) drawWindow(wi * s + 1, wj * s + 1);
    }
  }

  // 门 — 深色矩形门洞
  const doorX = (w / 2 - 0.5) * s;
  const doorY = (h - 1) * s;
  g.fillStyle(NES.DOOR_DARK, 1);
  g.fillRect(doorX, doorY, s, s);

  // 平顶 + 机房凸起
  const roofThick = 4;
  const eave = 4;
  g.fillStyle(NES.ROOF_BROWN, 1);
  g.fillRect(-d - eave, -roofThick, bw + (d + eave) * 2, roofThick);
  g.fillStyle(NES.ROOF_DARK, 1);
  g.fillRect(bw / 2 - 6, -roofThick - 4, 12, 4);
  g.fillStyle(NES.WALL_EDGE, 1);
  g.fillRect(bw / 2 - 4, -roofThick - 3, 2, 2);
  g.fillRect(bw / 2 + 2, -roofThick - 3, 2, 2);

  // 1px 黑色轮廓 — 正面边框
  g.lineStyle(1, NES.BLACK, 1);
  g.strokeRect(0, 0, bw, bh);
}

const BUILDING_DEPTH = 10;

/** 创建单个建筑容器 */
export function createBuilding(
  scene: Phaser.Scene,
  _key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  _roof: string,
  label: string,
  _color: number = NES.ROOF_BROWN,
  showLabel = true,
): Phaser.GameObjects.Container {
  const s = PIXEL * 3;
  const bw = w * s;
  const bh = h * s;
  const totalW = bw + BUILDING_DEPTH * 2;
  const container = scene.add.container(x, y);

  const g = scene.add.graphics();
  drawPixelBuilding(g, w, h);
  g.setPosition(-totalW / 2, -bh / 2);
  container.add(g);

  if (showLabel) {
    const labelBg = scene.add.graphics();
    labelBg.fillStyle(NES.BLACK, 1);
    labelBg.fillRect(-totalW / 2 - 4, bh / 2 + 1, totalW + 8, 14);
    labelBg.lineStyle(1, NES.WHITE, 1);
    labelBg.strokeRect(-totalW / 2 - 4, bh / 2 + 1, totalW + 8, 14);
    container.add(labelBg);
    const labelText = scene.add.text(0, bh / 2 + 8, label, {
      fontSize: "10px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    container.add(labelText);
  }

  g.setInteractive(
    new Phaser.Geom.Rectangle(-BUILDING_DEPTH, 0, totalW, bh),
    Phaser.Geom.Rectangle.Contains,
  );

  return container;
}

// ── 主楼绘制 ────────────────────────────────────────────────

/** 主办公楼 — 玻璃幕墙 + 旋转门入口 */
function drawPixelOfficeHub(g: Phaser.GameObjects.Graphics) {
  const wallW = 82;
  const wallH = 30;
  const halfWall = wallW / 2;
  const gateW = 16;
  const gateH = 14;
  const halfGate = gateW / 2;

  g.fillStyle(NES.CASTLE_WALL, 1);
  g.fillRect(-halfWall, -wallH, wallW, wallH);

  g.fillStyle(NES.CASTLE_WALL_LINE, 1);
  for (let row = 0; row < wallH; row += 6) {
    g.fillRect(-halfWall, -wallH + row, wallW, 1);
  }

  // 玻璃幕墙
  const winW = 8;
  const winH = 6;
  for (let col = -halfWall + 6; col < halfWall - 6; col += 10) {
    for (let row = -wallH + 6; row < -gateH - 2; row += 8) {
      g.fillStyle(NES.CASTLE_WALL_LINE, 1);
      g.fillRect(col - 1, row - 1, winW + 2, winH + 2);
      g.fillStyle(NES.WINDOW_GLASS, 1);
      g.fillRect(col, row, winW, winH);
      g.fillStyle(NES.WINDOW_GLASS_LIGHT, 1);
      g.fillRect(col, row, winW, 1);
    }
  }

  // 旋转门入口
  g.fillStyle(NES.CASTLE_GATE, 1);
  g.fillRect(-halfGate, -gateH, gateW, gateH);
  g.fillStyle(NES.WINDOW_GLASS_LIGHT, 1);
  g.fillRect(-2, -gateH + 2, 4, gateH - 4);

  // 平顶 + Logo 灯牌
  const roofY = -wallH - 6;
  g.fillStyle(NES.CASTLE_ROOF, 1);
  g.fillRect(-halfWall - 4, roofY, wallW + 8, 6);
  g.fillStyle(NES.WINDOW_GLASS, 1);
  g.fillRect(-14, roofY + 1, 28, 4);

  g.lineStyle(1, NES.BLACK, 1);
  g.strokeRect(-halfWall, -wallH, wallW, wallH);
  g.strokeRect(-halfGate, -gateH, gateW, gateH);
}

/** 创建主楼容器 — 开放办公区地标 */
export function createCastle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  showLabel = true,
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const g = scene.add.graphics();

  const offsetY = 27;
  g.setPosition(0, offsetY);
  drawPixelOfficeHub(g);
  container.add(g);

  g.setInteractive(
    new Phaser.Geom.Rectangle(-41, -53, 82, 53),
    Phaser.Geom.Rectangle.Contains,
  );

  if (showLabel) {
    const labelW = 50;
    const labelBg = scene.add.graphics();
    labelBg.fillStyle(NES.BLACK, 1);
    labelBg.fillRect(-labelW / 2, offsetY + 2, labelW, 14);
    labelBg.lineStyle(1, NES.WHITE, 1);
    labelBg.strokeRect(-labelW / 2, offsetY + 2, labelW, 14);
    container.add(labelBg);
    const labelText = scene.add.text(0, offsetY + 9, label, {
      fontSize: "10px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    container.add(labelText);
  }

  return container;
}

// ── 森林/山脉/道路/河流 ──────────────────────────────────────

/** 绘制办公区绿植簇 */
export function drawForestClusters(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  originX: number,
  originY: number,
): void {
  const cx = originX;
  const cy = originY;
  const clusters = [
    { x: 55, y: 75, cols: 10, rows: 8 },
    { x: 575, y: 75, cols: 8, rows: 7 },
    { x: 55, y: 395, cols: 10, rows: 6 },
    { x: 195, y: 45, cols: 6, rows: 4 },
    { x: 435, y: 45, cols: 6, rows: 4 },
    { x: 195, y: 418, cols: 6, rows: 3 },
    { x: 400, y: 418, cols: 5, rows: 3 },
  ];
  const spacing = 7;
  clusters.forEach(({ x, y, cols, rows }) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = x - cx + c * spacing + (r % 2) * 3;
        const ty = y - cy + r * (spacing + 1);
        const tree = scene.add.image(tx, ty, "forestTree");
        tree.setOrigin(0.5, 1);
        parent.add(tree);
      }
    }
  });

  const edgeTrees = [
    { x: 140, y: 110 }, { x: 150, y: 130 }, { x: 135, y: 155 },
    { x: 530, y: 110 }, { x: 520, y: 135 },
    { x: 140, y: 370 }, { x: 150, y: 360 },
    { x: 490, y: 365 }, { x: 480, y: 378 },
    { x: 240, y: 56 }, { x: 410, y: 56 },
    { x: 240, y: 412 }, { x: 410, y: 412 },
  ];
  edgeTrees.forEach(({ x, y }) => {
    const tree = scene.add.image(x - cx, y - cy, "sparseTree");
    tree.setOrigin(0.5, 1);
    parent.add(tree);
  });
}

/** 绘制机房/工位装饰簇（机柜 + 隔板） */
export function drawMountainClusters(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  originX: number,
  originY: number,
): void {
  const cx = originX;
  const cy = originY;

  const peakGroups = [
    { peaks: [
      { x: 540, y: 130 }, { x: 550, y: 140 }, { x: 560, y: 128 },
      { x: 548, y: 148 }, { x: 536, y: 145 }, { x: 556, y: 155 },
    ]},
    { peaks: [
      { x: 85, y: 132 }, { x: 95, y: 142 }, { x: 78, y: 148 },
      { x: 90, y: 155 }, { x: 100, y: 150 },
    ]},
    { peaks: [
      { x: 318, y: 56 }, { x: 330, y: 62 }, { x: 325, y: 50 },
    ]},
    { peaks: [
      { x: 510, y: 370 }, { x: 500, y: 378 },
    ]},
    { peaks: [
      { x: 85, y: 368 }, { x: 72, y: 378 }, { x: 94, y: 380 },
    ]},
  ];

  peakGroups.forEach(({ peaks }) => {
    peaks.forEach(({ x, y }) => {
      const scale = 0.8 + Math.random() * 0.5;
      const peak = scene.add.image(x - cx, y - cy, "mountainPeak");
      peak.setScale(scale);
      peak.setOrigin(0.5, 1);
      parent.add(peak);
    });
  });

  const rockPositions = [
    { x: 530, y: 160 }, { x: 555, y: 162 }, { x: 545, y: 166 },
    { x: 75, y: 160 }, { x: 95, y: 163 }, { x: 85, y: 168 },
    { x: 315, y: 68 }, { x: 332, y: 72 },
    { x: 500, y: 390 },
    { x: 78, y: 388 }, { x: 92, y: 392 },
    { x: 128, y: 100 }, { x: 520, y: 100 },
    { x: 128, y: 385 }, { x: 480, y: 388 },
  ];
  rockPositions.forEach(({ x, y }) => {
    const rock = scene.add.image(x - cx, y - cy, "mountainRock");
    rock.setOrigin(0.5, 1);
    parent.add(rock);
  });
}

/** 绘制道路 — NES 风格纯色方块铺路 */
export function drawPaths(
  scene: Phaser.Scene,
  parent?: Phaser.GameObjects.Container,
  originX = 0,
  originY = 0,
): void {
  const g = scene.add.graphics();
  if (parent) parent.add(g);
  const ox = originX;
  const oy = originY;
  const STEP = 24;
  const TILE = 14;
  const drawn = new Set<string>();
  const key = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`;

  const drawTile = (x: number, y: number) => {
    const k = key(x, y);
    if (drawn.has(k)) return;
    drawn.add(k);
    const tx = x - ox;
    const ty = y - oy;
    g.fillStyle(NES.ROAD_BASE, 1);
    g.fillRect(tx - TILE / 2, ty - TILE / 2, TILE, TILE);
    // 几个抖动点模拟 NES 纹理
    g.fillStyle(NES.ROAD_DOT, 1);
    g.fillRect(tx - 3, ty - 3, 1, 1);
    g.fillRect(tx + 2, ty + 1, 1, 1);
    g.fillRect(tx - 1, ty + 3, 1, 1);
    g.fillRect(tx + 4, ty - 1, 1, 1);
  };

  const quadPoints = (x0: number, y0: number, cxp: number, cyp: number, x2: number, y2: number, n: number) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      pts.push({
        x: mt * mt * x0 + 2 * mt * t * cxp + t * t * x2,
        y: mt * mt * y0 + 2 * mt * t * cyp + t * t * y2,
      });
    }
    return pts;
  };

  const drawCurvedPath = (x0: number, y0: number, cxp: number, cyp: number, x2: number, y2: number) => {
    const pts = quadPoints(x0, y0, cxp, cyp, x2, y2, 20);
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

  const drawPolyPath = (points: { x: number; y: number }[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const perpX = -(b.y - a.y), perpY = b.x - a.x;
      const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
      const bend = (i % 2 === 0 ? 1 : -1) * 15;
      const cp = { x: midX + (perpX / len) * bend, y: midY + (perpY / len) * bend };
      drawCurvedPath(a.x, a.y, cp.x, cp.y, b.x, b.y);
    }
  };

  drawPolyPath([{ x: 120, y: 115 }, { x: 210, y: 95 }, { x: 300, y: 100 }, { x: 400, y: 92 }, { x: 500, y: 105 }]);
  drawPolyPath([{ x: 110, y: 355 }, { x: 225, y: 345 }, { x: 340, y: 350 }, { x: 420, y: 342 }, { x: 500, y: 338 }]);
  drawPolyPath([{ x: 135, y: 115 }, { x: 125, y: 200 }, { x: 118, y: 280 }, { x: 110, y: 355 }]);
  drawPolyPath([{ x: 500, y: 105 }, { x: 510, y: 200 }, { x: 505, y: 270 }, { x: 500, y: 338 }]);
  drawPolyPath([{ x: 320, y: 92 }, { x: 330, y: 160 }, { x: 315, y: 224 }, { x: 335, y: 290 }, { x: 340, y: 350 }]);
  drawCurvedPath(280, 224, 320, 210, 360, 224);
  drawCurvedPath(120, 115, 118, 100, 120, 85);
  drawCurvedPath(500, 105, 505, 88, 500, 75);
  drawCurvedPath(110, 355, 105, 365, 110, 375);
  drawCurvedPath(500, 338, 508, 348, 500, 358);
}

/** 绘制员工休息区（原河道区域改为地毯休息角） */
export function drawRiverAndPond(
  scene: Phaser.Scene,
  parent?: Phaser.GameObjects.Container,
  originX = 0,
  originY = 0,
): void {
  const g = scene.add.graphics();
  if (parent) parent.add(g);
  const ox = originX;
  const oy = originY;

  g.lineStyle(2, NES.BLACK, 1);
  g.fillStyle(NES.LOUNGE_BASE, 1);
  g.beginPath();
  g.moveTo(640 - ox, 200 - oy);
  g.lineTo(632 - ox, 256 - oy);
  g.lineTo(616 - ox, 320 - oy);
  g.lineTo(576 - ox, 376 - oy);
  g.lineTo(520 - ox, 416 - oy);
  g.lineTo(480 - ox, 448 - oy);
  g.lineTo(640 - ox, 448 - oy);
  g.closePath();
  g.fillPath();
  g.strokePath();

  g.fillStyle(NES.LOUNGE_ACCENT, 1);
  for (let wy = 210; wy < 440; wy += 12) {
    for (let wx = 500; wx < 630; wx += 14) {
      if ((wx + wy) % 24 === 0) g.fillRect(wx - ox, wy - oy, 4, 4);
    }
  }

  const pcx = 544 - ox;
  const pcy = 416 - oy;
  g.fillStyle(NES.LOUNGE_ACCENT, 1);
  g.fillRect(pcx - 44, pcy - 18, 88, 36);
  g.fillStyle(0x8898B0, 1);
  g.fillRect(pcx - 20, pcy - 8, 40, 12);
  g.fillStyle(0x687888, 1);
  g.fillRect(pcx - 8, pcy - 14, 16, 6);

  const label = scene.add.text(pcx, pcy - 28, "休息区", {
    fontSize: "9px",
    color: "#E2E8F0",
    fontStyle: "bold",
    backgroundColor: "#1E293B",
    padding: { x: 3, y: 1 },
  }).setOrigin(0.5).setResolution(2);
  if (parent) parent.add(label);
}
