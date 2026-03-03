/**
 * 场景资产 — 建筑/地面/装饰纹理与绘制逻辑
 * 45 度天空俯视风格
 */
import Phaser from "phaser";

const PIXEL = 3;

/** 建筑配置 */
export const BUILDINGS = {
  square: { x: 320, y: 224, label: "中央广场", w: 7, h: 5, roof: "deck" as const, color: 0x8b7355 },
  task: { x: 340, y: 340, label: "任务中心", w: 4, h: 3, roof: "thatched" as const, color: 0x6b5344 },
  library: { x: 120, y: 90, label: "图书馆", w: 3, h: 4, roof: "thatched" as const, color: 0x5c4033 },
  workshop: { x: 300, y: 85, label: "技能工坊", w: 4, h: 3, roof: "gable" as const, color: 0x6b5344 },
  temple: { x: 500, y: 100, label: "进化神殿", w: 4, h: 4, roof: "mushroom" as const, color: 0x4a6741 },
  archive: { x: 110, y: 340, label: "档案馆", w: 3, h: 3, roof: "thatched" as const, color: 0x5c4033 },
  memory: { x: 500, y: 335, label: "记忆仓库", w: 3, h: 3, roof: "gable" as const, color: 0x6b5344 },
} as const;

export const TO_LABEL: Record<string, string> = {
  广场: "square", 任务中心: "task", 知识图书馆: "library", 图书馆: "library",
  技能工坊: "workshop", 工坊: "workshop", 进化神殿: "temple", 神殿: "temple",
  决策档案馆: "archive", 档案馆: "archive", 记忆仓库: "memory",
};

export const LABEL_TO_XY: Record<string, { x: number; y: number }> = {
  square: BUILDINGS.square, task: BUILDINGS.task, library: BUILDINGS.library,
  workshop: BUILDINGS.workshop, temple: BUILDINGS.temple, archive: BUILDINGS.archive, memory: BUILDINGS.memory,
};

/** 45 度俯视：Y 轴压缩比例。补偿缩放使内容撑满屏幕 */
export const VIEW_SCALE_Y = 0.65;
export const VIEW_FILL_SCALE = 1 / VIEW_SCALE_Y;

/** 注册场景纹理 */
export function registerSceneTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  const grassCanvas = document.createElement("canvas");
  grassCanvas.width = 64;
  grassCanvas.height = 64;
  const ctx = grassCanvas.getContext("2d")!;
  const shades = ["#1e3d0f", "#2a4a14", "#3a6418", "#45761e"];
  for (let i = 0; i < 64; i += 4) {
    for (let j = 0; j < 64; j += 4) {
      const idx = ((i >> 2) + (j >> 2)) % 4;
      const noise = ((i * 7 + j * 13) % 5) === 0 ? 1 : 0;
      ctx.fillStyle = shades[(idx + noise) % shades.length];
      ctx.fillRect(i, j, 4, 4);
    }
  }
  textures.addCanvas("grass", grassCanvas);

  const pathCanvas = document.createElement("canvas");
  pathCanvas.width = 32;
  pathCanvas.height = 32;
  const pCtx = pathCanvas.getContext("2d")!;
  pCtx.fillStyle = "#3a2a20";
  pCtx.fillRect(0, 0, 32, 32);
  pCtx.fillStyle = "#5c4033";
  for (let i = 2; i < 30; i += 8) {
    for (let j = 2; j < 30; j += 8) {
      const v = ((i + j) / 8) % 2 ? "#6a5040" : "#4a3828";
      pCtx.fillStyle = v;
      pCtx.fillRect(i, j, 6, 6);
    }
  }
  pCtx.strokeStyle = "#2a2018";
  pCtx.lineWidth = 1;
  pCtx.strokeRect(0, 0, 32, 32);
  textures.addCanvas("path", pathCanvas);

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
  textures.addCanvas("tree", treeCanvas);

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
  textures.addCanvas("lamp", lampCanvas);

  ["flower", "flower2", "flower3"].forEach((name, i) => {
    const c = document.createElement("canvas");
    c.width = i === 2 ? 8 : i === 1 ? 10 : 12;
    c.height = i === 2 ? 8 : i === 1 ? 10 : 12;
    const fc = c.getContext("2d")!;
    const colors = ["#e879f9", "#f472b6", "#fde047"];
    const radii = [3, 2.5, 2];
    fc.fillStyle = colors[i];
    fc.beginPath();
    fc.arc(c.width / 2, c.height / 2, radii[i], 0, Math.PI * 2);
    fc.fill();
    if (i === 0) {
      fc.fillStyle = "#fbbf24";
      fc.beginPath();
      fc.arc(c.width / 2, c.height / 2, 1.5, 0, Math.PI * 2);
      fc.fill();
    }
    textures.addCanvas(name, c);
  });

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
  textures.addCanvas("stone", stoneCanvas);

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
  textures.addCanvas("mushroom", mushroomCanvas);

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
  textures.addCanvas("smoke", smokeCanvas);

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
  textures.addCanvas("firefly", fireflyCanvas);

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
  textures.addCanvas("bird", birdCanvas);

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
  textures.addCanvas("cloud", cloudCanvas);

  const leafCanvas = document.createElement("canvas");
  leafCanvas.width = 8;
  leafCanvas.height = 12;
  const leafCtx = leafCanvas.getContext("2d")!;
  leafCtx.fillStyle = "rgba(139, 90, 43, 0.8)";
  leafCtx.beginPath();
  leafCtx.ellipse(4, 6, 3, 5, 0, 0, Math.PI * 2);
  leafCtx.fill();
  textures.addCanvas("leaf", leafCanvas);

  const dotCanvas = document.createElement("canvas");
  dotCanvas.width = 12;
  dotCanvas.height = 12;
  const dCtx = dotCanvas.getContext("2d")!;
  const grad = dCtx.createRadialGradient(6, 6, 0, 6, 6, 5);
  grad.addColorStop(0, "rgba(148, 163, 184, 0.8)");
  grad.addColorStop(1, "rgba(148, 163, 184, 0)");
  dCtx.fillStyle = grad;
  dCtx.fillRect(0, 0, 12, 12);
  textures.addCanvas("particle", dotCanvas);

  const lightCanvas = document.createElement("canvas");
  lightCanvas.width = 640;
  lightCanvas.height = 448;
  const lCtx2 = lightCanvas.getContext("2d")!;
  const lightGrad = lCtx2.createLinearGradient(0, 0, 0, 448);
  lightGrad.addColorStop(0, "rgba(255, 248, 240, 0.06)");
  lightGrad.addColorStop(0.5, "rgba(255, 245, 235, 0.02)");
  lightGrad.addColorStop(1, "rgba(0, 0, 0, 0.04)");
  lCtx2.fillStyle = lightGrad;
  lCtx2.fillRect(0, 0, 640, 448);
  textures.addCanvas("lightOverlay", lightCanvas);

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
  textures.addCanvas("vignette", vignetteCanvas);
}

/** 混合颜色：base 与 tint 按 ratio 混合 */
function blendColor(base: number, tint: number, ratio: number): number {
  const r = Math.round(((base >> 16) & 0xff) * (1 - ratio) + ((tint >> 16) & 0xff) * ratio);
  const g = Math.round(((base >> 8) & 0xff) * (1 - ratio) + ((tint >> 8) & 0xff) * ratio);
  const b = Math.round((base & 0xff) * (1 - ratio) + (tint & 0xff) * ratio);
  return (r << 16) | (g << 8) | b;
}

/** 45°俯看：正面+侧面+顶部，梯形透视屋顶 */
function drawPixelBuilding(g: Phaser.GameObjects.Graphics, w: number, h: number, roof: string, wallTint: number) {
  const s = PIXEL * 3;
  const bw = w * s;
  const bh = h * s;
  const d = 10;
  const woodBase = 0x9a7d5e;
  const wood = blendColor(woodBase, wallTint, 0.08);
  const woodDark = blendColor(0x6b5344, wallTint, 0.06);
  const woodDarker = blendColor(0x4a3728, wallTint, 0.04);
  const woodLight = blendColor(0xb89a78, wallTint, 0.06);
  const woodHighlight = blendColor(0xd4c4a8, wallTint, 0.04);
  const stone = 0x7a6b5a;
  const stoneDark = 0x4a4038;
  const stoneOutline = 0x3d3528;
  const thatch = 0xd4b88a;
  const thatchDark = 0x9a7b4a;
  const mushroom = 0x9a6a44;
  const mushroomSpot = 0x5a3a22;

  // 1. 地基 — 更精细的石块纹理
  g.fillStyle(stoneOutline, 0.6);
  g.fillRect(-d - 3, bh + 1, bw + d * 2 + 6, s + 6);
  g.fillStyle(stoneDark, 1);
  g.fillRect(-d - 2, bh + 2, bw + d * 2 + 4, s + 4);
  const stoneW = 10;
  const stoneH = 4;
  for (let i = 0; i < Math.ceil((bw + d * 2 + 4) / stoneW) + 1; i++) {
    for (let j = 0; j < 2; j++) {
      const ox = -d - 1 + (j % 2) * (stoneW / 2) + i * stoneW;
      const oy = bh + 3 + j * stoneH;
      const shade = ((i + j) % 3 === 0 ? stone : (i + j) % 3 === 1 ? 0x6a5a48 : stoneDark) as number;
      g.fillStyle(shade, 0.95);
      g.fillRoundedRect(ox, oy, stoneW - 1, stoneH - 1, 1);
      g.fillStyle(0x9a8a78, 0.25);
      g.fillRect(ox + 1, oy + 1, 2, 1);
    }
  }
  g.fillStyle(stoneOutline, 0.9);
  g.fillRect(-d - 2, bh + 2, d + 2, s + 4);
  g.fillStyle(0x5a4a40, 0.95);
  g.fillRect(bw, bh + 2, d + 2, s + 4);

  // 2. 左侧面 — 木纹与阴影
  g.fillStyle(woodDarker, 1);
  g.beginPath();
  g.moveTo(-d, bh);
  g.lineTo(0, bh);
  g.lineTo(0, 0);
  g.lineTo(-d, 0);
  g.closePath();
  g.fillPath();
  for (let j = 0; j < h; j++) {
    const base = (j % 2 ? 0x3d2e24 : 0x352618) as number;
    g.fillStyle(base, 1);
    g.fillRect(-d + 1, j * s + 1, d - 2, s - 1);
    g.fillStyle(0x2d2018, 0.6);
    g.fillRect(-d + 1, j * s + 1, 2, s - 1);
    g.fillStyle(0x4a3828, 0.2);
    g.fillRect(-d + d - 3, j * s + 2, 1, s - 3);
  }

  // 3. 右侧面
  g.fillStyle(woodDark, 0.98);
  g.beginPath();
  g.moveTo(bw, bh);
  g.lineTo(bw + d, bh);
  g.lineTo(bw + d, 0);
  g.lineTo(bw, 0);
  g.closePath();
  g.fillPath();
  for (let j = 0; j < h; j++) {
    const base = (j % 2 ? 0x5c4033 : 0x524030) as number;
    g.fillStyle(base, 0.98);
    g.fillRect(bw + 1, j * s + 1, d - 2, s - 1);
    g.fillStyle(0x4a3728, 0.4);
    g.fillRect(bw + d - 3, j * s + 1, 1, s - 1);
    g.fillStyle(0x7a6048, 0.15);
    g.fillRect(bw + 2, j * s + 2, 1, s - 3);
  }

  // 4. 正面墙体 — 更细腻的砖/木板纹理
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      const isBrick = (i + Math.floor(j / 2)) % 2 === 0;
      const c = edge ? woodDark : isBrick ? wood : woodLight;
      g.fillStyle(c, 1);
      g.fillRect(i * s, j * s, s, s);
      if (!edge) {
        g.fillStyle(0x3d2e24, 0.12);
        g.fillRect(i * s, j * s, 1, 1);
        g.fillRect(i * s + s - 1, j * s, 1, 1);
        if (isBrick && (i < w * 0.6 || j < h * 0.5)) {
          g.fillStyle(woodHighlight, 0.15);
          g.fillRect(i * s + 1, j * s + 1, 2, 2);
        }
        if ((i + j) % 4 === 0) {
          g.fillStyle(0x2a2018, 0.08);
          g.fillRect(i * s + 2, j * s + 2, 1, 1);
        }
      }
    }
  }

  const drawWindow = (x: number, y: number) => {
    const frameW = 2;
    const winS = Math.floor(s / 2) - 1;
    g.fillStyle(woodDark, 1);
    g.fillRect(x - frameW, y - frameW, s + frameW * 2, s + frameW * 2);
    g.fillStyle(woodHighlight, 0.35);
    g.fillRect(x - frameW, y - frameW, frameW, s + frameW * 2);
    g.fillRect(x - frameW, y - frameW, s + frameW * 2, frameW);
    g.fillStyle(0x3a4a5a, 0.85);
    g.fillRect(x, y, s, s);
    g.fillStyle(0x5a7a9a, 0.6);
    g.fillRect(x + 1, y + 1, winS, winS);
    g.fillRect(x + s - winS - 1, y + 1, winS, winS);
    g.fillRect(x + 1, y + s - winS - 1, winS, winS);
    g.fillRect(x + s - winS - 1, y + s - winS - 1, winS, winS);
    g.fillStyle(0x9ac8e8, 0.5);
    g.fillRect(x + 2, y + 2, 2, 2);
    g.fillStyle(0xffffff, 0.2);
    g.fillRect(x + 1, y + 1, 1, 1);
  };
  if (w >= 4) drawWindow(s + 1, s + 1);
  if (w >= 5) drawWindow((w - 2) * s + 1, s + 1);

  const doorX = (w / 2 - 0.5) * s;
  const doorY = (h - 1) * s;
  const frameW = 2;
  g.fillStyle(woodDark, 1);
  g.fillRect(doorX - frameW - 2, doorY - frameW - 2, s + (frameW + 2) * 2, s + (frameW + 2) * 2);
  g.fillStyle(woodHighlight, 0.3);
  g.fillRect(doorX - frameW - 2, doorY - frameW - 2, frameW + 2, s + (frameW + 2) * 2);
  g.fillRect(doorX - frameW - 2, doorY - frameW - 2, s + (frameW + 2) * 2, frameW + 2);
  g.fillStyle(wood, 1);
  g.fillRect(doorX, doorY, s, s);
  g.fillStyle(woodLight, 0.8);
  g.fillRect(doorX + 2, doorY + 2, s - 4, s - 4);
  g.fillStyle(woodDark, 1);
  g.fillRect(doorX + s - 6, doorY + s / 2 - 3, 2, 4);
  g.fillStyle(0x3d2e24, 0.5);
  g.fillCircle(doorX + s - 5, doorY + s / 2 - 1, 1.5);
  g.fillStyle(woodHighlight, 0.5);
  g.fillRect(doorX + 1, doorY + 1, 2, 2);

  // 5. 屋顶（45°俯视：前宽后窄）
  const roofDepth = 20;
  const eave = 8;
  const taper = 16;
  const fl = { x: -d - eave, y: 0 };
  const fr = { x: bw + d + eave, y: 0 };
  const bl = { x: -d - eave + taper, y: -roofDepth };
  const br = { x: bw + d + eave - taper, y: -roofDepth };
  const ridgeY = -roofDepth - 2;

  const chamfer = 6;
  const rightEdge = (t: number) => {
    if (t <= chamfer / roofDepth) {
      const u = t * roofDepth / chamfer;
      return { x: fr.x - chamfer + chamfer * u, y: -chamfer * u };
    }
    if (t >= 1 - chamfer / roofDepth) {
      const u = (t - (1 - chamfer / roofDepth)) / (chamfer / roofDepth);
      return { x: br.x - chamfer * u, y: -roofDepth + chamfer * (1 - u) };
    }
    const s = (t - chamfer / roofDepth) / (1 - 2 * chamfer / roofDepth);
    return { x: fr.x + (br.x - fr.x) * s, y: -chamfer + (-roofDepth + chamfer * 2) * s };
  };

  const drawRoofQuad = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, fill: number, alpha: number) => {
    g.fillStyle(fill, alpha);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineTo(x3, y3);
    g.lineTo(x4, y4);
    g.closePath();
    g.fillPath();
  };

  /** 屋顶渐变 — 右侧斜角切掉 fr、br 直角 */
  const drawRoofGradient = (steps: number, frontColor: number, backColor: number) => {
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const tMid = (t0 + t1) / 2;
      const mt = 1 - tMid;
      const x1 = fl.x + (bl.x - fl.x) * t0;
      const y1 = fl.y + (bl.y - fl.y) * t0;
      const x3 = fl.x + (bl.x - fl.x) * t1;
      const y3 = fl.y + (bl.y - fl.y) * t1;
      const p2 = rightEdge(t0);
      const p4 = rightEdge(t1);
      const r = Math.round(((frontColor >> 16) & 0xff) * mt + ((backColor >> 16) & 0xff) * tMid);
      const gr = Math.round(((frontColor >> 8) & 0xff) * mt + ((backColor >> 8) & 0xff) * tMid);
      const b = Math.round((frontColor & 0xff) * mt + (backColor & 0xff) * tMid);
      const c = (r << 16) | (gr << 8) | b;
      drawRoofQuad(x1, y1, p2.x, p2.y, p4.x, p4.y, x3, y3, c, 0.92);
    }
  };

  /** 屋檐侧面 — 右侧用斜角三角形连接屋顶与墙 */
  const drawEaveSides = () => {
    const eaveH = 6;
    const sideDepth = 4;
    const rad = 2.5;
    const leftColor = 0x6a6258;
    const rightColor = 0x6a6258;
    const backColor = 0x5a5548;

    g.fillStyle(leftColor, 0.85);
    g.fillRoundedRect(fl.x, -eaveH, d + eave, eaveH, rad);
    g.fillStyle(0x8a8278, 0.2);
    g.fillRoundedRect(fl.x + 1, -eaveH + 1, d + eave - 2, Math.max(1, eaveH / 2 - 1), rad - 1);

    g.fillStyle(backColor, 0.8);
    g.fillRoundedRect(bl.x, -roofDepth, sideDepth, roofDepth, rad);

    g.fillStyle(rightColor, 0.85);
    g.beginPath();
    g.moveTo(fr.x - d - eave, 0);
    g.lineTo(fr.x - chamfer, 0);
    g.lineTo(fr.x - chamfer, -chamfer);
    g.lineTo(fr.x, -eaveH);
    g.lineTo(fr.x - d - eave, -eaveH);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x8a8278, 0.2);
    g.fillRect(fr.x - d - eave + 2, -eaveH + 2, d + eave - chamfer - 4, Math.max(1, eaveH / 2 - 2));

    g.fillStyle(rightColor, 0.85);
    g.beginPath();
    g.moveTo(br.x - chamfer, -roofDepth);
    g.lineTo(br.x - sideDepth, -roofDepth);
    g.lineTo(br.x - sideDepth, 0);
    g.lineTo(br.x, 0);
    g.lineTo(br.x, -roofDepth + chamfer);
    g.lineTo(br.x - chamfer, -roofDepth);
    g.closePath();
    g.fillPath();

    g.fillStyle(rightColor, 0.9);
    g.beginPath();
    g.moveTo(fr.x, 0);
    g.lineTo(fr.x - chamfer, -chamfer);
    g.lineTo(fr.x - chamfer, 0);
    g.closePath();
    g.fillPath();

    g.fillStyle(backColor, 0.9);
    g.beginPath();
    g.moveTo(br.x, -roofDepth);
    g.lineTo(br.x - chamfer, -roofDepth + chamfer);
    g.lineTo(br.x - chamfer, -roofDepth);
    g.closePath();
    g.fillPath();
  };

  /** 屋檐下阴影 — 圆角 */
  const drawEaveShadow = () => {
    g.fillStyle(0x1a1510, 0.3);
    g.fillRoundedRect(fl.x + 4, 0, fr.x - fl.x - 8, 5, 2);
  };

  if (roof === "thatched") {
    drawRoofGradient(6, 0xe8d4a8, thatchDark);
    const m1x = (fl.x + bl.x) / 2;
    const m2x = (fr.x + br.x) / 2;
    const my = (fl.y + bl.y) / 2;
    drawRoofQuad(fl.x + 8, fl.y, fr.x - chamfer, -chamfer, m2x - 4, my, m1x + 4, my, thatch, 0.98);
    drawRoofQuad(m1x + 4, my, m2x - 4, my, br.x - chamfer, -roofDepth + chamfer, bl.x, bl.y, thatchDark, 0.95);
    for (let row = 0; row < 14; row++) {
      const t = row / 14;
      const y = fl.y + (bl.y - fl.y) * t - 0.5;
      const ww = Math.max(14, (fr.x - fl.x - 28) * (0.9 - t * 0.2));
      const cx = (fl.x + fr.x) / 2;
      const alpha = 0.18 + (1 - t) * 0.1;
      g.fillStyle(0xd4c090, alpha);
      g.fillRect(cx - ww / 2, y, ww, 1.5);
      if (row % 2 === 0) {
        g.fillStyle(0xe8dcb0, alpha * 0.7);
        g.fillRect(cx - ww / 2 + 3, y - 0.3, ww - 6, 1);
      }
    }
    g.fillStyle(0xf0e4c0, 0.7);
    g.fillRect(bw / 4 + 8, -6, bw / 2 - 16, 6);
    g.fillStyle(0xd4c498, 0.35);
    g.fillRect(bw / 4 + 10, -5, bw / 2 - 20, 4);
    g.fillStyle(0xffffff, 0.15);
    g.beginPath();
    g.moveTo(bl.x + 4, ridgeY + 2);
    g.lineTo(br.x - 4, ridgeY + 2);
    g.lineTo(br.x - 2, ridgeY);
    g.lineTo(bl.x + 2, ridgeY);
    g.closePath();
    g.fillPath();
    drawEaveShadow();
    drawEaveSides();
  } else if (roof === "gable") {
    drawRoofGradient(5, 0x8a7a5a, 0x3d2e24);
    const m1x = (fl.x + bl.x) / 2;
    const m2x = (fr.x + br.x) / 2;
    const my = (fl.y + bl.y) / 2;
    drawRoofQuad(fl.x + 8, fl.y, fr.x - chamfer, -chamfer, m2x - 5, my, m1x + 5, my, wood, 0.97);
    drawRoofQuad(m1x + 5, my, m2x - 5, my, br.x - chamfer, -roofDepth + chamfer, bl.x, bl.y, 0x4a3828, 0.94);
    const shingleRows = Math.max(6, Math.floor(roofDepth / 2.5));
    for (let row = 0; row < shingleRows; row++) {
      const ty = row / shingleRows;
      const y = fl.y + (bl.y - fl.y) * ty - 1;
      const rowW = (fr.x - fl.x - 20) * (0.92 - ty * 0.2);
      const cx = (fl.x + fr.x) / 2;
      const shingleCount = Math.max(5, Math.floor(rowW / 8));
      for (let i = 0; i < shingleCount; i++) {
        const tx = (i + 0.5) / shingleCount - 0.5;
        const x = cx + tx * rowW;
        g.fillStyle(0x3d2e24, 0.55);
        g.fillRoundedRect(x - 3, y, 6, 2.5, 0.5);
        g.fillStyle(0x5a4a38, 0.25);
        g.fillRect(x - 2, y + 0.5, 4, 1);
      }
    }
    g.fillStyle(0x2a2018, 1);
    g.fillRoundedRect((w / 2 - 0.5) * s - 2, ridgeY - 4, s + 4, s + 6, 2);
    g.fillStyle(woodDark, 1);
    g.fillRoundedRect((w / 2 - 0.5) * s - 1, ridgeY - 2, s + 2, s + 4, 1);
    g.fillStyle(wood, 1);
    g.fillRect((w / 2 - 0.5) * s, ridgeY, s, s + 2);
    g.fillStyle(woodLight, 0.8);
    g.fillRect((w / 2 - 0.5) * s + 2, ridgeY + 2, s - 4, s - 2);
    g.fillStyle(0xf0e8d8, 0.35);
    g.fillRect((w / 2 - 0.5) * s + 1, ridgeY - 1, s - 2, 1);
    drawEaveShadow();
    drawEaveSides();
  } else if (roof === "mushroom") {
    g.fillStyle(0x4a2818, 1);
    g.fillRect(bw / 2 - 5, 0, 10, roofDepth);
    g.fillStyle(0x3a2010, 1);
    g.fillRect(bw / 2 - 5, 0, 2, roofDepth);
    g.fillRect(bw / 2 - 1, 0, 2, roofDepth);
    g.fillStyle(0x6a4028, 0.9);
    g.fillRect(bw / 2 + 1, 0, 2, roofDepth);
    g.fillStyle(0x8a5a32, 0.7);
    g.fillRect(bw / 2 + 3, 0, 2, roofDepth);
    g.fillStyle(mushroom, 1);
    g.fillCircle(bw / 2, -6, s * 1.4);
    g.fillStyle(mushroomSpot, 0.92);
    g.fillCircle(bw / 2 - 5, -8, 2.5);
    g.fillCircle(bw / 2 + 4, -10, 2);
    g.fillCircle(bw / 2 - 2, -11, 1.5);
    g.fillStyle(0xba8a64, 0.5);
    g.fillCircle(bw / 2, -8, s * 0.55);
    g.fillStyle(0x6a3a22, 0.4);
    g.fillCircle(bw / 2 - 4, -7, 2);
    g.fillStyle(0xd4a878, 0.25);
    g.fillCircle(bw / 2 + 3, -9, 2.5);
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(bw / 2 + 2, -10, 1.5);
  } else {
    drawRoofGradient(4, 0x8a7a68, 0x4a3d28);
    const m1x = (fl.x + bl.x) / 2;
    const m2x = (fr.x + br.x) / 2;
    const my = (fl.y + bl.y) / 2;
    drawRoofQuad(fl.x + 8, fl.y, fr.x - chamfer, -chamfer, m2x - 5, my, m1x + 5, my, wood, 0.97);
    drawRoofQuad(m1x + 5, my, m2x - 5, my, br.x - chamfer, -roofDepth + chamfer, bl.x, bl.y, 0x5c4033, 0.93);
    const deckRows = Math.max(4, Math.floor(bw / 10));
    for (let row = 0; row < deckRows; row++) {
      const t = (row + 0.5) / deckRows;
      const x = fl.x + (fr.x - fl.x) * t - 5;
      g.fillStyle(0x5a4a38, 0.6);
      g.fillRoundedRect(x, -5, 8, 3, 0.5);
      g.fillStyle(0x7a6a58, 0.35);
      g.fillRect(x + 1, -4, 6, 1.5);
      g.fillStyle(0x3d3020, 0.3);
      g.fillRect(x + 1, -3.5, 6, 0.5);
    }
    g.fillStyle(0x8a7a68, 0.65);
    g.fillRect(bw / 4 + 10, -6, bw / 2 - 20, 6);
    g.fillStyle(0x6a5a48, 0.4);
    g.fillRect(bw / 4 + 12, -5, bw / 2 - 24, 4);
    g.fillStyle(0xffffff, 0.1);
    g.fillRect(bw / 4 + 14, -5.5, bw / 2 - 28, 1);
    drawEaveShadow();
    drawEaveSides();
  }
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
  roof: string,
  label: string,
  color = 0x8b7355
): Phaser.GameObjects.Container {
  const s = PIXEL * 3;
  const bw = w * s;
  const bh = h * s;
  const totalW = bw + BUILDING_DEPTH * 2;
  const container = scene.add.container(x, y);

  const shadow = scene.add.graphics();
  shadow.fillStyle(0x1a1512, 0.28);
  shadow.fillEllipse(0, bh / 2 + 10, totalW * 0.55, 8);
  shadow.fillStyle(0x0d0a08, 0.2);
  shadow.fillRoundedRect(-totalW / 2 + 4, -bh / 2 + 4, totalW, bh, 5);
  container.add(shadow);

  const g = scene.add.graphics();
  drawPixelBuilding(g, w, h, roof, color);
  g.setPosition(-totalW / 2, -bh / 2);
  container.add(g);

  const labelBg = scene.add.graphics();
  labelBg.fillStyle(0x1a1410, 0.96);
  labelBg.fillRoundedRect(-totalW / 2 - 5, bh / 2 + 3, totalW + 10, 20, 5);
  labelBg.lineStyle(1, 0x4a3728, 0.5);
  labelBg.strokeRoundedRect(-totalW / 2 - 5, bh / 2 + 3, totalW + 10, 20, 5);
  labelBg.fillStyle(0x3d2e24, 0.4);
  labelBg.fillRect(-totalW / 2 - 3, bh / 2 + 6, totalW + 6, 1);
  labelBg.fillStyle(0x5c4033, 0.25);
  labelBg.fillRect(-totalW / 2 - 3, bh / 2 + 4, totalW + 6, 2);
  container.add(labelBg);

  const labelText = scene.add.text(0, bh / 2 + 13, label, {
    fontSize: "10px",
    color: "#f0e8dc",
    fontStyle: "bold",
  }).setOrigin(0.5);
  container.add(labelText);

  g.setInteractive(new Phaser.Geom.Rectangle(-BUILDING_DEPTH, 0, totalW, bh), Phaser.Geom.Rectangle.Contains);
  g.on("pointerover", () => { container.y = y - 3; });
  g.on("pointerout", () => { container.y = y; });

  return container;
}

/** 绘制道路（添加到 parent，origin 为世界中心偏移） */
export function drawPaths(
  scene: Phaser.Scene,
  parent?: Phaser.GameObjects.Container,
  originX = 0,
  originY = 0
): void {
  const g = scene.add.graphics();
  if (parent) parent.add(g);
  const ox = originX;
  const oy = originY;
  const STEP = 24;
  const TILE = 20;
  const drawn = new Set<string>();
  const key = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`;
  const drawTile = (x: number, y: number) => {
    const k = key(x, y);
    if (drawn.has(k)) return;
    drawn.add(k);
    const tx = x - ox;
    const ty = y - oy;
    g.fillStyle(0x5c4033, 0.95);
    g.fillRect(tx - TILE / 2, ty - TILE / 2, TILE, TILE);
    g.fillStyle(0x6b5244, 0.5);
    g.fillRect(tx - TILE / 2 + 2, ty - TILE / 2 + 2, 3, 3);
    g.fillRect(tx + TILE / 2 - 5, ty + TILE / 2 - 5, 3, 3);
  };
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
  const drawPolyPath = (points: { x: number; y: number }[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const perpX = -(b.y - a.y), perpY = b.x - a.x;
      const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
      const bend = (i % 2 === 0 ? 1 : -1) * 15;
      const cx = midX + (perpX / len) * bend;
      const cy = midY + (perpY / len) * bend;
      drawCurvedPath(a.x, a.y, cx, cy, b.x, b.y);
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

/** 绘制河流与水池（添加到 parent，origin 为世界中心偏移） */
export function drawRiverAndPond(
  scene: Phaser.Scene,
  parent?: Phaser.GameObjects.Container,
  originX = 0,
  originY = 0
): void {
  const g = scene.add.graphics();
  if (parent) parent.add(g);
  const ox = originX;
  const oy = originY;
  g.fillStyle(0x2d6b5a, 0.95);
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
  g.fillStyle(0x3d8270, 0.9);
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
  g.fillStyle(0x4a9c8a, 0.6);
  g.beginPath();
  g.moveTo(640 - ox, 256 - oy);
  g.lineTo(624 - ox, 312 - oy);
  g.lineTo(596 - ox, 364 - oy);
  g.lineTo(560 - ox, 396 - oy);
  g.lineTo(640 - ox, 396 - oy);
  g.lineTo(640 - ox, 256 - oy);
  g.closePath();
  g.fillPath();
  g.fillStyle(0x2d6b5a, 0.95);
  g.fillEllipse(544 - ox, 416 - oy, 128, 80);
  g.fillStyle(0x3d8270, 0.9);
  g.fillEllipse(536 - ox, 408 - oy, 96, 60);
  g.fillStyle(0x4a9c8a, 0.5);
  g.fillEllipse(524 - ox, 404 - oy, 56, 36);
  g.fillStyle(0xffffff, 0.15);
  g.fillEllipse(512 - ox, 400 - oy, 24, 12);
}
