/**
 * 场景资产 — 严格参考 FC/NES 吞食天地2 大地图风格
 * 所有纹理程序化生成，仅使用 NES 受限调色板
 * 禁止：渐变、半透明、抗锯齿、圆角
 */
import Phaser from "phaser";
import { NES, NES_HEX } from "./nesColors";

const PIXEL = 2;

/** 建筑配置 */
export const BUILDINGS = {
  square: { x: 320, y: 224, label: "城池", w: 7, h: 5, roof: "flat" as const, color: NES.ROOF_BROWN },
  task: { x: 340, y: 340, label: "任务中心", w: 4, h: 3, roof: "flat" as const, color: NES.ROOF_DARK },
  library: { x: 120, y: 90, label: "图书馆", w: 3, h: 4, roof: "flat" as const, color: NES.ROOF_DARK },
  workshop: { x: 300, y: 85, label: "技能工坊", w: 4, h: 3, roof: "flat" as const, color: NES.ROOF_DARK },
  temple: { x: 500, y: 100, label: "进化神殿", w: 4, h: 4, roof: "flat" as const, color: NES.ROOF_BROWN },
  archive: { x: 110, y: 340, label: "档案馆", w: 3, h: 3, roof: "flat" as const, color: NES.ROOF_DARK },
  memory: { x: 500, y: 335, label: "记忆仓库", w: 3, h: 3, roof: "flat" as const, color: NES.ROOF_DARK },
} as const;

export const TO_LABEL: Record<string, string> = {
  广场: "square", 城池: "square", 中央广场: "square", 任务中心: "task", 知识图书馆: "library", 图书馆: "library",
  技能工坊: "workshop", 工坊: "workshop", 进化神殿: "temple", 神殿: "temple",
  决策档案馆: "archive", 档案馆: "archive", 记忆仓库: "memory",
};

export const LABEL_TO_XY: Record<string, { x: number; y: number }> = {
  square: BUILDINGS.square, task: BUILDINGS.task, library: BUILDINGS.library,
  workshop: BUILDINGS.workshop, temple: BUILDINGS.temple, archive: BUILDINGS.archive, memory: BUILDINGS.memory,
};

export const VIEW_SCALE_Y = 0.65;
export const VIEW_FILL_SCALE = 1 / VIEW_SCALE_Y;

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

  // 道路 — NES 有序抖动 16×16
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

  // 山峰 — 单个尖三角 12×16
  const mtnCanvas = document.createElement("canvas");
  mtnCanvas.width = 14;
  mtnCanvas.height = 18;
  const mCtx = mtnCanvas.getContext("2d")!;
  drawPixelMountainPeak(mCtx, 7, 17, 16, 6);
  textures.addCanvas("mountainPeak", mtnCanvas);

  // 山脚岩石 — 圆顶 8×6
  const rockCanvas = document.createElement("canvas");
  rockCanvas.width = 8;
  rockCanvas.height = 6;
  const rkCtx = rockCanvas.getContext("2d")!;
  drawPixelRock(rkCtx, 0, 0);
  textures.addCanvas("mountainRock", rockCanvas);

  // 密集森林树 — 窄锥 10×20, 3 层
  const denseTreeCanvas = document.createElement("canvas");
  denseTreeCanvas.width = 12;
  denseTreeCanvas.height = 22;
  const dtCtx = denseTreeCanvas.getContext("2d")!;
  drawPixelTree(dtCtx, 6, 20, 20, 5, 3);
  textures.addCanvas("forestTree", denseTreeCanvas);

  // 稀疏树 — 窄锥 8×14, 2 层
  const sparseTreeCanvas = document.createElement("canvas");
  sparseTreeCanvas.width = 10;
  sparseTreeCanvas.height = 16;
  const stCtx = sparseTreeCanvas.getContext("2d")!;
  drawPixelTree(stCtx, 5, 14, 14, 4, 2);
  textures.addCanvas("sparseTree", sparseTreeCanvas);

  // 小石头 — 装饰 6×5
  const stoneCanvas = document.createElement("canvas");
  stoneCanvas.width = 6;
  stoneCanvas.height = 5;
  const snCtx = stoneCanvas.getContext("2d")!;
  snCtx.fillStyle = NES_HEX.OUTLINE;
  snCtx.fillRect(1, 0, 4, 1);
  snCtx.fillRect(0, 1, 1, 3);
  snCtx.fillRect(5, 1, 1, 3);
  snCtx.fillRect(1, 4, 4, 1);
  snCtx.fillStyle = '#787878';
  snCtx.fillRect(1, 1, 4, 3);
  snCtx.fillStyle = '#A0A0A0';
  snCtx.fillRect(1, 1, 2, 1);
  textures.addCanvas("stone", stoneCanvas);
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

  // 窗户
  const woodDark = NES.ROOF_DARK;
  const drawWindow = (x: number, y: number) => {
    g.fillStyle(woodDark, 1);
    g.fillRect(x - 1, y - 1, s + 2, s + 2);
    g.fillStyle(0x4070A0, 1);
    g.fillRect(x, y, s, s);
  };
  if (w >= 4) drawWindow(s + 1, s + 1);
  if (w >= 5) drawWindow((w - 2) * s + 1, s + 1);

  // 门 — 深色矩形门洞
  const doorX = (w / 2 - 0.5) * s;
  const doorY = (h - 1) * s;
  g.fillStyle(NES.DOOR_DARK, 1);
  g.fillRect(doorX, doorY, s, s);

  // 屋顶 — 棕瓦
  const roofThick = 5;
  const eave = 5;
  const fl = { x: -d - eave, y: 0 };
  const fr = { x: bw + d + eave, y: 0 };
  const bl = { x: -d - eave + 10, y: -roofThick };
  const br = { x: bw + d + eave - 10, y: -roofThick };
  g.fillStyle(NES.ROOF_BROWN, 1);
  g.beginPath();
  g.moveTo(fl.x, fl.y);
  g.lineTo(fr.x, fr.y);
  g.lineTo(br.x, br.y);
  g.lineTo(bl.x, bl.y);
  g.closePath();
  g.fillPath();
  for (let rx = fl.x + 2; rx < fr.x - 2; rx += 4) {
    g.fillStyle(NES.ROOF_DARK, 1);
    g.fillRect(rx, -roofThick, 2, roofThick + 1);
  }

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

// ── 城池绘制 ────────────────────────────────────────────────

/** NES 风格城池 — FC/NES RPG 中国古城门楼，像素逐行绘制 */
function drawPixelCastle(g: Phaser.GameObjects.Graphics) {
  const wallW = 82;
  const wallH = 26;
  const towerW = 40;
  const towerH = 14;
  const roofOverhang = 8;
  const roofW = towerW + roofOverhang * 2;
  const roofH = 10;
  const gateW = 14;
  const gateH = 18;
  const crenH = 4;

  const halfWall = wallW / 2;
  const halfTower = towerW / 2;
  const halfRoof = roofW / 2;
  const halfGate = gateW / 2;
  const towerBot = -wallH;
  const towerTop = towerBot - towerH;
  const roofBot = towerTop;
  const roofTopY = roofBot - roofH;

  // 城墙主体
  g.fillStyle(NES.CASTLE_WALL, 1);
  g.fillRect(-halfWall, -wallH, wallW, wallH);

  // 砖缝纹理
  g.fillStyle(NES.CASTLE_WALL_LINE, 1);
  for (let row = 0; row < wallH; row += 5) {
    g.fillRect(-halfWall, -wallH + row, wallW, 1);
    const off = (Math.floor(row / 5) % 2) * 5;
    for (let col = off; col < wallW; col += 10) {
      g.fillRect(-halfWall + col, -wallH + row, 1, Math.min(5, wallH - row));
    }
  }

  // 垛口 (crenellations)
  const crenW = 5;
  const crenGap = 4;
  g.fillStyle(NES.CASTLE_WALL, 1);
  for (let cx = -halfWall + 1; cx < halfWall - crenW; cx += crenW + crenGap) {
    if (cx + crenW > -halfTower && cx < halfTower) continue;
    g.fillRect(cx, -wallH - crenH, crenW, crenH);
    g.fillStyle(NES.CASTLE_WALL_LINE, 1);
    g.fillRect(cx, -wallH - crenH, crenW, 1);
    g.fillStyle(NES.CASTLE_WALL, 1);
  }

  // 城门
  g.fillStyle(NES.CASTLE_GATE, 1);
  g.fillRect(-halfGate, -gateH, gateW, gateH);
  g.fillStyle(NES.CASTLE_WOOD, 1);
  g.fillRect(-halfGate - 1, -gateH - 1, gateW + 2, 2);
  g.fillRect(-halfGate - 1, -gateH, 2, gateH);
  g.fillRect(halfGate - 1, -gateH, 2, gateH);

  // 城楼
  g.fillStyle(NES.CASTLE_TOWER, 1);
  g.fillRect(-halfTower, towerTop, towerW, towerH);
  g.fillStyle(NES.CASTLE_WALL_LINE, 1);
  for (let row = 0; row <= towerH; row += 4) {
    g.fillRect(-halfTower, towerTop + row, towerW, 1);
  }

  // 城楼窗户
  const winW = 6;
  const winH = 6;
  const winY = towerTop + 4;
  g.fillStyle(NES.CASTLE_GATE, 1);
  g.fillRect(-winW - 2, winY, winW, winH);
  g.fillRect(2, winY, winW, winH);
  g.fillStyle(NES.CASTLE_WOOD, 1);
  g.fillRect(-winW - 2, winY + 3, winW, 1);
  g.fillRect(-winW - 2 + 3, winY, 1, winH);
  g.fillRect(2, winY + 3, winW, 1);
  g.fillRect(2 + 3, winY, 1, winH);

  // 屋顶主体 — 深色梯形
  g.fillStyle(NES.CASTLE_ROOF, 1);
  g.beginPath();
  g.moveTo(-halfRoof, roofBot);
  g.lineTo(halfRoof, roofBot);
  g.lineTo(halfRoof - 10, roofTopY + 2);
  g.lineTo(-halfRoof + 10, roofTopY + 2);
  g.closePath();
  g.fillPath();

  // 瓦片竖线
  g.fillStyle(NES.CASTLE_ROOF_LIGHT, 1);
  for (let col = -halfRoof + 4; col < halfRoof - 4; col += 4) {
    g.fillRect(col, roofBot - 1, 1, -(roofH - 4));
  }

  // 飞檐翘角 — 阶梯式上翘，像素风
  g.fillStyle(NES.CASTLE_ROOF, 1);
  g.fillRect(-halfRoof - 4, roofBot - 1, 6, 2);
  g.fillRect(-halfRoof - 8, roofBot - 4, 5, 3);
  g.fillRect(-halfRoof - 11, roofBot - 7, 4, 3);
  g.fillRect(halfRoof - 2, roofBot - 1, 6, 2);
  g.fillRect(halfRoof + 3, roofBot - 4, 5, 3);
  g.fillRect(halfRoof + 7, roofBot - 7, 4, 3);

  // 屋脊
  g.fillStyle(NES.CASTLE_ROOF_LIGHT, 1);
  g.fillRect(-halfRoof + 12, roofTopY + 1, roofW - 24, 2);

  // 宝顶
  g.fillStyle(NES.CASTLE_ROOF_LIGHT, 1);
  g.fillRect(-2, roofTopY - 3, 4, 5);
  g.fillStyle(NES.CASTLE_ROOF, 1);
  g.fillRect(-1, roofTopY - 2, 2, 3);

  // 鸱吻
  g.fillStyle(NES.CASTLE_ROOF, 1);
  g.fillRect(-halfRoof + 10, roofTopY - 1, 3, 3);
  g.fillRect(halfRoof - 13, roofTopY - 1, 3, 3);

  // 黑色轮廓
  g.lineStyle(1, NES.BLACK, 1);
  g.strokeRect(-halfWall, -wallH, wallW, wallH);
  g.strokeRect(-halfTower, towerTop, towerW, towerH);
  g.strokeRect(-halfGate, -gateH, gateW, gateH);
}

/** 创建城池容器 — 替代中心广场 */
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
  drawPixelCastle(g);
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

/** 绘制密集森林簇 — NES 风格窄锥形，高密度层叠 */
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

  // 森林边缘散落稀疏树
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

/** 绘制山脉簇 — NES 尖三角峰 + 山脚圆顶岩石 */
export function drawMountainClusters(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  originX: number,
  originY: number,
): void {
  const cx = originX;
  const cy = originY;

  // 山峰位置 — 密集层叠排列
  const peakGroups = [
    // 右上山脉群
    { peaks: [
      { x: 540, y: 130 }, { x: 550, y: 140 }, { x: 560, y: 128 },
      { x: 548, y: 148 }, { x: 536, y: 145 }, { x: 556, y: 155 },
    ]},
    // 左上山脉群
    { peaks: [
      { x: 85, y: 132 }, { x: 95, y: 142 }, { x: 78, y: 148 },
      { x: 90, y: 155 }, { x: 100, y: 150 },
    ]},
    // 上方中间
    { peaks: [
      { x: 318, y: 56 }, { x: 330, y: 62 }, { x: 325, y: 50 },
    ]},
    // 右下（避开河流）
    { peaks: [
      { x: 510, y: 370 }, { x: 500, y: 378 },
    ]},
    // 左下
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

  // 山脚岩石 — 散落在山脉底部和森林边缘
  const rockPositions = [
    { x: 530, y: 160 }, { x: 555, y: 162 }, { x: 545, y: 166 },
    { x: 75, y: 160 }, { x: 95, y: 163 }, { x: 85, y: 168 },
    { x: 315, y: 68 }, { x: 332, y: 72 },
    { x: 500, y: 390 },
    { x: 78, y: 388 }, { x: 92, y: 392 },
    // 森林边缘岩石
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

/** 绘制河流与水池 — NES 纯色块，无渐变/半透明 */
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

  // 河流岸线坐标（左岸，右侧始终为画布边缘 640）
  const shoreEdge = [
    { x: 640, y: 200 }, { x: 632, y: 256 }, { x: 616, y: 320 },
    { x: 576, y: 376 }, { x: 520, y: 416 }, { x: 480, y: 448 },
  ];
  const getShoreX = (py: number): number => {
    for (let i = 0; i < shoreEdge.length - 1; i++) {
      const a = shoreEdge[i], b = shoreEdge[i + 1];
      if (py >= a.y && py <= b.y) {
        const t = (py - a.y) / (b.y - a.y);
        return a.x + (b.x - a.x) * t;
      }
    }
    return 640;
  };

  // 岸线黑色描边
  g.lineStyle(3, NES.BLACK, 1);
  g.beginPath();
  g.moveTo(640 - ox, 198 - oy);
  g.lineTo(630 - ox, 254 - oy);
  g.lineTo(614 - ox, 318 - oy);
  g.lineTo(574 - ox, 374 - oy);
  g.lineTo(518 - ox, 414 - oy);
  g.lineTo(478 - ox, 448 - oy);
  g.strokePath();

  // 河流主体 — 深蓝底色
  g.fillStyle(NES.WATER_DEEP, 1);
  g.beginPath();
  g.moveTo(640 - ox, 200 - oy);
  g.lineTo(632 - ox, 256 - oy);
  g.lineTo(616 - ox, 320 - oy);
  g.lineTo(576 - ox, 376 - oy);
  g.lineTo(520 - ox, 416 - oy);
  g.lineTo(480 - ox, 448 - oy);
  g.lineTo(640 - ox, 448 - oy);
  g.lineTo(640 - ox, 200 - oy);
  g.closePath();
  g.fillPath();

  // 中层水色
  g.fillStyle(NES.WATER_MID, 1);
  g.beginPath();
  g.moveTo(640 - ox, 224 - oy);
  g.lineTo(628 - ox, 280 - oy);
  g.lineTo(604 - ox, 344 - oy);
  g.lineTo(568 - ox, 384 - oy);
  g.lineTo(536 - ox, 408 - oy);
  g.lineTo(640 - ox, 408 - oy);
  g.lineTo(640 - ox, 224 - oy);
  g.closePath();
  g.fillPath();

  // 浅水高光
  g.fillStyle(NES.WATER_LIGHT, 1);
  g.beginPath();
  g.moveTo(640 - ox, 256 - oy);
  g.lineTo(624 - ox, 312 - oy);
  g.lineTo(596 - ox, 364 - oy);
  g.lineTo(560 - ox, 396 - oy);
  g.lineTo(640 - ox, 396 - oy);
  g.lineTo(640 - ox, 256 - oy);
  g.closePath();
  g.fillPath();

  // 小波浪标记 — 散布 "~" 形亮蓝白纹，NES 像素风
  // 每个波浪：██··  ← 上半行
  //           ··██ ← 下半行（右移2px），组成 "~" 形
  const waveGapX = 14;
  const waveGapY = 8;
  g.fillStyle(NES.WATER_WAVE, 1);
  for (let wy = 204; wy < 446; wy += waveGapY) {
    const sx = getShoreX(wy);
    const rowOff = (Math.floor(wy / waveGapY) % 2) * (waveGapX / 2);
    for (let wx = Math.ceil(sx) + 6 + rowOff; wx < 636; wx += waveGapX) {
      g.fillRect(wx - ox, wy - oy, 3, 1);
      g.fillRect(wx + 3 - ox, wy + 1 - oy, 3, 1);
    }
  }

  // 水池
  const pcx = 544 - ox;
  const pcy = 416 - oy;
  g.fillStyle(NES.WATER_DEEP, 1);
  g.fillRect(pcx - 48, pcy - 16, 96, 32);
  g.fillRect(pcx - 40, pcy - 20, 80, 40);
  g.fillStyle(NES.WATER_MID, 1);
  g.fillRect(pcx - 36, pcy - 12, 72, 24);
  g.fillStyle(NES.WATER_LIGHT, 1);
  g.fillRect(pcx - 16, pcy - 6, 32, 12);

  // 水池小波浪
  g.fillStyle(NES.WATER_WAVE, 1);
  for (let wy = -16; wy < 16; wy += waveGapY) {
    const off = (Math.floor((wy + 16) / waveGapY) % 2) * (waveGapX / 2);
    for (let wx = -36 + off; wx < 36; wx += waveGapX) {
      g.fillRect(pcx + wx, pcy + wy, 3, 1);
      g.fillRect(pcx + wx + 3, pcy + wy + 1, 3, 1);
    }
  }
}
