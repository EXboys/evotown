/**
 * 室内办公平面图
 * 画布: 640 × 448
 *
 * 布局结构：
 *   ┌─────────────────────────────────────────────┐
 *   │ 知识库 (含会议室) │ Skill 工坊 │   数据中心     │
 *   │                  │           │              │
 *   └────door──────────door────────door───────────┘
 *                  ═══ 横向主走廊 ═══
 *   ┌──────┐                                ┌─────┐
 *   │ 归档 │            开放工位              │ 机房│
 *   ├ door │              (最大)              │door │
 *   │ 任务 │           桌椅 + 电脑             │ 茶水│
 *   ├ door │                                  │door │
 *   │ 记忆 │                                  │ 休息│
 *   └──door┘                                └door──┘
 */
import Phaser from "phaser";
import { NES } from "./nesColors";

export type Rect = { x: number; y: number; w: number; h: number };

// ── 楼层尺寸 ──────────────────────────────────────────────────
export const OFFICE_FLOOR = {
  outer: { x: 28, y: 28, w: 584, h: 392 },
  walk: { xMin: 36, xMax: 604, yMin: 36, yMax: 412 },
} as const;

// ── 房间矩形定义 ─────────────────────────────────────────────
// 上排三房：知识库（含会议室） / Skill 工坊 / 数据中心
const ROOM_KNOWLEDGE: Rect = { x: 36, y: 36, w: 176, h: 154 };
const ROOM_WORKSHOP: Rect = { x: 220, y: 36, w: 172, h: 154 };
const ROOM_TEMPLE: Rect = { x: 400, y: 36, w: 204, h: 154 };

// 主走廊（横贯）
const MAIN_CORRIDOR: Rect = { x: 36, y: 196, w: 568, h: 40 };

// 中下区：左侧叠加 / 中央开放工位 / 右侧叠加
const OPEN_OFFICE: Rect = { x: 184, y: 244, w: 248, h: 168 };

// 左侧三房（归档 / 任务看板 / 记忆仓）
const ROOM_ARCHIVE: Rect = { x: 36, y: 244, w: 140, h: 56 };
const ROOM_TASK: Rect = { x: 36, y: 304, w: 140, h: 52 };
const ROOM_MEMORY: Rect = { x: 36, y: 360, w: 140, h: 52 };

// 右侧整合为一个茶水休闲区（合并原机房 / 茶水间 / 休息区）
const ROOM_LOUNGE: Rect = { x: 440, y: 244, w: 164, h: 168 };

/** 建筑锚点（房间中心，与 LABEL_TO_XY 对齐） */
export const OFFICE_BUILDINGS = {
  library: {
    x: ROOM_KNOWLEDGE.x + ROOM_KNOWLEDGE.w / 2,
    y: ROOM_KNOWLEDGE.y + ROOM_KNOWLEDGE.h / 2,
    label: "知识库",
    w: 3, h: 4, roof: "flat" as const, color: NES.ROOF_DARK,
  },
  workshop: {
    x: ROOM_WORKSHOP.x + ROOM_WORKSHOP.w / 2,
    y: ROOM_WORKSHOP.y + ROOM_WORKSHOP.h / 2,
    label: "研发室",
    w: 4, h: 3, roof: "flat" as const, color: NES.ROOF_DARK,
  },
  temple: {
    x: ROOM_TEMPLE.x + ROOM_TEMPLE.w / 2,
    y: ROOM_TEMPLE.y + ROOM_TEMPLE.h / 2,
    label: "数据中心",
    w: 4, h: 4, roof: "flat" as const, color: NES.ROOF_BROWN,
  },
  square: {
    x: OPEN_OFFICE.x + OPEN_OFFICE.w / 2,
    y: OPEN_OFFICE.y + OPEN_OFFICE.h / 2,
    label: "开放工位",
    w: 5, h: 4, roof: "flat" as const, color: NES.ROOF_BROWN,
  },
  archive: {
    x: ROOM_ARCHIVE.x + ROOM_ARCHIVE.w / 2,
    y: ROOM_ARCHIVE.y + ROOM_ARCHIVE.h / 2,
    label: "归档室",
    w: 3, h: 3, roof: "flat" as const, color: NES.ROOF_DARK,
  },
  memory: {
    x: ROOM_MEMORY.x + ROOM_MEMORY.w / 2,
    y: ROOM_MEMORY.y + ROOM_MEMORY.h / 2,
    label: "资料室",
    w: 3, h: 3, roof: "flat" as const, color: NES.ROOF_DARK,
  },
  task: {
    x: ROOM_TASK.x + ROOM_TASK.w / 2,
    y: ROOM_TASK.y + ROOM_TASK.h / 2,
    label: "任务看板",
    w: 4, h: 3, roof: "flat" as const, color: NES.ROOF_DARK,
  },
} as const;

/** 房间高亮范围（执行中脉冲） */
export const ROOM_HIGHLIGHT: Record<string, Rect> = {
  library: ROOM_KNOWLEDGE,
  workshop: ROOM_WORKSHOP,
  temple: ROOM_TEMPLE,
  square: OPEN_OFFICE,
  archive: ROOM_ARCHIVE,
  memory: ROOM_MEMORY,
  task: ROOM_TASK,
};

// ── 工作位（执行任务时 Agent 走到电脑前坐下） ──────────────────
export type WorkstationFacing = "front" | "back" | "left" | "right";
export interface Workstation {
  x: number;
  y: number;
  facing: WorkstationFacing;
}

/** 开放工位 4×3 工位网格 — 与 drawOpenOffice 内的桌椅位置严格对齐 */
const OPEN_WORKSTATIONS: Workstation[] = (() => {
  const r = OPEN_OFFICE;
  const cols = 4;
  const rows = 3;
  const cellW = 50;
  const cellH = 44;
  const startX = r.x + (r.w - cellW * cols) / 2;
  const startY = r.y + (r.h - cellH * rows) / 2 + 2;
  const list: Workstation[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dx = startX + col * cellW;
      const dy = startY + row * cellH;
      list.push({ x: dx + 19, y: dy + 30, facing: "back" });
    }
  }
  return list;
})();

/** Skill 工坊 3×2 工位 */
const WORKSHOP_WORKSTATIONS: Workstation[] = (() => {
  const r = ROOM_WORKSHOP;
  const list: Workstation[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const dx = r.x + 22 + col * 44;
      const dy = r.y + 36 + row * 56;
      list.push({ x: dx + 16, y: dy + 22, facing: "back" });
    }
  }
  return list;
})();

/** 知识库 会议桌四周 8 个座位 */
const KNOWLEDGE_WORKSTATIONS: Workstation[] = (() => {
  const r = ROOM_KNOWLEDGE;
  const table = { x: r.x + 24, y: r.y + 56, w: r.w - 48, h: 32 };
  const list: Workstation[] = [];
  for (let i = 0; i < 4; i++) {
    const cx = table.x + 16 + (i * (table.w - 32)) / 3 + 6;
    list.push({ x: cx, y: table.y - 5, facing: "front" });
    list.push({ x: cx, y: table.y + table.h + 5, facing: "back" });
  }
  return list;
})();

/** 数据中心 三联屏 + 机柜检修位（共 5 个工位） */
const TEMPLE_WORKSTATIONS: Workstation[] = (() => {
  const r = ROOM_TEMPLE;
  const consoleX = r.x + 32;
  const consoleY = r.y + 86;
  const list: Workstation[] = [];
  // 控制台三联屏前 3 个座位（背对镜头，朝向屏幕）
  for (let i = 0; i < 3; i++) {
    list.push({ x: consoleX + 32 + i * 38, y: consoleY + 32, facing: "back" });
  }
  // 机柜阵列前 2 个巡检位
  list.push({ x: r.x + 46, y: r.y + 72, facing: "back" });
  list.push({ x: r.x + r.w - 46, y: r.y + 72, facing: "back" });
  return list;
})();

/** 归档室 4 个文件柜前位置 */
const ARCHIVE_WORKSTATIONS: Workstation[] = (() => {
  const r = ROOM_ARCHIVE;
  const list: Workstation[] = [];
  for (let i = 0; i < 4; i++) {
    list.push({ x: r.x + 10 + i * 28 + 11, y: r.y + r.h - 8, facing: "back" });
  }
  return list;
})();

/** 任务看板：站在公告板前 */
const TASK_WORKSTATIONS: Workstation[] = (() => {
  const r = ROOM_TASK;
  return [
    { x: r.x + r.w / 2 - 24, y: r.y + r.h - 8, facing: "back" } as Workstation,
    { x: r.x + r.w / 2 + 24, y: r.y + r.h - 8, facing: "back" } as Workstation,
  ];
})();

/** 记忆仓 5 个存储阵列前位置 */
const MEMORY_WORKSTATIONS: Workstation[] = (() => {
  const r = ROOM_MEMORY;
  const list: Workstation[] = [];
  for (let i = 0; i < 4; i++) {
    list.push({ x: r.x + 10 + i * 24 + 9, y: r.y + r.h - 6, facing: "back" });
  }
  return list;
})();

const WORKSTATIONS: Record<string, Workstation[]> = {
  square: OPEN_WORKSTATIONS,
  workshop: WORKSHOP_WORKSTATIONS,
  library: KNOWLEDGE_WORKSTATIONS,
  temple: TEMPLE_WORKSTATIONS,
  archive: ARCHIVE_WORKSTATIONS,
  task: TASK_WORKSTATIONS,
  memory: MEMORY_WORKSTATIONS,
};

export function getWorkstations(roomKey: string): Workstation[] {
  return WORKSTATIONS[roomKey] ?? [];
}

// ── 可走区（房间地毯 + 走廊） ────────────────────────────────
const ROOM_ZONES: { rect: Rect; fill: number }[] = [
  { rect: ROOM_KNOWLEDGE, fill: NES.ZONE_ROOM_A },
  { rect: ROOM_WORKSHOP, fill: NES.ZONE_ROOM_B },
  { rect: ROOM_TEMPLE, fill: NES.ZONE_ROOM_A },
  { rect: OPEN_OFFICE, fill: NES.ZONE_OPEN },
  { rect: ROOM_ARCHIVE, fill: NES.ZONE_ROOM_B },
  { rect: ROOM_TASK, fill: NES.ZONE_ROOM_A },
  { rect: ROOM_MEMORY, fill: NES.ZONE_ROOM_B },
  { rect: ROOM_LOUNGE, fill: NES.LOUNGE_BASE },
];

const CORRIDORS: Rect[] = [MAIN_CORRIDOR];

// ── 墙（加厚，视觉更分明，逻辑足以阻挡 8px 步长寻路） ────────────
const WALL: Rect[] = [
  // 外墙（厚 12）
  { x: 26, y: 26, w: 588, h: 12 },
  { x: 26, y: 410, w: 588, h: 12 },
  { x: 26, y: 26, w: 12, h: 396 },
  { x: 602, y: 26, w: 12, h: 396 },

  // 上排房间垂直分隔（厚 12）
  { x: 210, y: 38, w: 12, h: 152 },
  { x: 390, y: 38, w: 12, h: 152 },

  // 上排底墙（厚 10）
  { x: 38, y: 186, w: 564, h: 10 },

  // 主走廊底墙（厚 12）
  { x: 38, y: 234, w: 564, h: 12 },

  // 中央开放工位 左墙 / 右墙（厚 12）
  { x: 174, y: 244, w: 12, h: 168 },
  { x: 430, y: 244, w: 12, h: 168 },

  // 左侧三房水平分隔（厚 8）
  { x: 38, y: 298, w: 138, h: 8 },
  { x: 38, y: 354, w: 138, h: 8 },

];

// ── 门洞（覆盖在墙上，重新开通走道） ────────────────────────────
const DOOR: Rect[] = [
  // 上排三房 → 主走廊（每房一道门）
  { x: 112, y: 186, w: 28, h: 12 },
  { x: 292, y: 186, w: 28, h: 12 },
  { x: 486, y: 186, w: 28, h: 12 },

  // 开放工位 ↔ 主走廊（中央大门）
  { x: 296, y: 232, w: 44, h: 18 },

  // 左侧三房 ↔ 开放工位（朝右开门）
  { x: 170, y: 260, w: 20, h: 24 },
  { x: 170, y: 318, w: 20, h: 22 },
  { x: 170, y: 374, w: 20, h: 24 },

  // 茶水休闲区 ↔ 开放工位（朝左开一道大门）
  { x: 426, y: 308, w: 20, h: 40 },
];

// ── 几何判定 ──────────────────────────────────────────────────
function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function inCorridor(x: number, y: number): boolean {
  return CORRIDORS.some((c) => inRect(x, y, c));
}

function inRoom(x: number, y: number): boolean {
  return ROOM_ZONES.some((z) => inRect(x, y, z.rect));
}

function inDoor(x: number, y: number): boolean {
  return DOOR.some((d) => inRect(x, y, d));
}

function inWall(x: number, y: number): boolean {
  return WALL.some((w) => inRect(x, y, w));
}

export function isOfficeWalkable(wx: number, wy: number): boolean {
  const { xMin, xMax, yMin, yMax } = OFFICE_FLOOR.walk;
  if (wx < xMin || wx > xMax || wy < yMin || wy > yMax) return false;
  // 门洞优先：门洞处即使在墙位置也可走
  if (inDoor(wx, wy)) return true;
  if (inWall(wx, wy)) return false;
  return inCorridor(wx, wy) || inRoom(wx, wy);
}

export function clampToOfficeWalkable(wx: number, wy: number): { x: number; y: number } {
  if (isOfficeWalkable(wx, wy)) return { x: wx, y: wy };
  return getRandomOfficePoint();
}

export function getRandomOfficePoint(): { x: number; y: number } {
  for (let i = 0; i < 60; i++) {
    const x = OFFICE_FLOOR.walk.xMin + Math.random() * (OFFICE_FLOOR.walk.xMax - OFFICE_FLOOR.walk.xMin);
    const y = OFFICE_FLOOR.walk.yMin + Math.random() * (OFFICE_FLOOR.walk.yMax - OFFICE_FLOOR.walk.yMin);
    if (isOfficeWalkable(x, y)) return { x, y };
  }
  return {
    x: OPEN_OFFICE.x + OPEN_OFFICE.w / 2,
    y: OPEN_OFFICE.y + OPEN_OFFICE.h / 2,
  };
}

// ── 寻路 ──────────────────────────────────────────────────────
const PATH_STEP = 8;

function gridKey(x: number, y: number): string {
  return `${x},${y}`;
}

function segmentIsWalkable(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isOfficeWalkable(a.x + dx * t, a.y + dy * t)) return false;
  }
  return true;
}

/** 找最近可走的格点，且与原点之间无墙阻挡。 */
function nearestGridAnchor(p: { x: number; y: number }): { x: number; y: number } {
  const gx = Math.round(p.x / PATH_STEP) * PATH_STEP;
  const gy = Math.round(p.y / PATH_STEP) * PATH_STEP;
  if (isOfficeWalkable(gx, gy) && segmentIsWalkable(p, { x: gx, y: gy })) {
    return { x: gx, y: gy };
  }
  for (let radius = PATH_STEP; radius <= PATH_STEP * 10; radius += PATH_STEP) {
    for (let dy = -radius; dy <= radius; dy += PATH_STEP) {
      for (let dx = -radius; dx <= radius; dx += PATH_STEP) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (!isOfficeWalkable(nx, ny)) continue;
        if (!segmentIsWalkable(p, { x: nx, y: ny })) continue;
        return { x: nx, y: ny };
      }
    }
  }
  return clampToOfficeWalkable(p.x, p.y);
}

/** A* 寻路：仅沿可走区+门洞移动。返回不含起点的路径点列。 */
export function buildOfficePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const start = nearestGridAnchor(from);
  const end = nearestGridAnchor(to);

  if (start.x === end.x && start.y === end.y) return [end];

  const queue: { x: number; y: number; key: string }[] = [{ ...start, key: gridKey(start.x, start.y) }];
  const cameFrom = new Map<string, string | null>([[gridKey(start.x, start.y), null]]);
  const pointByKey = new Map<string, { x: number; y: number }>([[gridKey(start.x, start.y), start]]);

  const dirs = [
    { x: PATH_STEP, y: 0 },
    { x: -PATH_STEP, y: 0 },
    { x: 0, y: PATH_STEP },
    { x: 0, y: -PATH_STEP },
  ];

  const endKey = gridKey(end.x, end.y);
  let found = false;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.key === endKey) {
      found = true;
      break;
    }
    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!isOfficeWalkable(nx, ny)) continue;
      if (!segmentIsWalkable({ x: cur.x, y: cur.y }, { x: nx, y: ny })) continue;
      const nk = gridKey(nx, ny);
      if (cameFrom.has(nk)) continue;
      cameFrom.set(nk, cur.key);
      pointByKey.set(nk, { x: nx, y: ny });
      queue.push({ x: nx, y: ny, key: nk });
    }
  }

  if (!found) return [end];

  const reversed: { x: number; y: number }[] = [];
  let cursor: string | null = endKey;
  while (cursor) {
    const point = pointByKey.get(cursor);
    if (point) reversed.push(point);
    cursor = cameFrom.get(cursor) ?? null;
  }
  // 保持相邻格点，避免角色直线切墙
  return reversed.reverse().slice(1);
}

// ── 绘制 ──────────────────────────────────────────────────────
function drawRect(g: Phaser.GameObjects.Graphics, r: Rect, fill: number, ox: number, oy: number) {
  g.fillStyle(fill, 1);
  g.fillRect(r.x - ox, r.y - oy, r.w, r.h);
}

/** 绘制室内平面图 */
export function drawOfficeFloorPlan(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  originX: number,
  originY: number,
): void {
  const g = scene.add.graphics();
  parent.add(g);
  const ox = originX;
  const oy = originY;

  // 楼层外背景
  g.fillStyle(0x1e293b, 1);
  g.fillRect(-ox - 80, -oy - 80, 800, 600);

  // 楼层底（深色底板）
  drawRect(g, OFFICE_FLOOR.outer, 0x8993a3, ox, oy);

  // 房间地毯
  for (const z of ROOM_ZONES) {
    drawRect(g, z.rect, z.fill, ox, oy);
  }

  // 走廊
  for (const c of CORRIDORS) {
    drawRect(g, c, NES.ROAD_BASE, ox, oy);
    g.fillStyle(NES.ROAD_DOT, 1);
    for (let ty = c.y; ty < c.y + c.h; ty += 8) {
      for (let tx = c.x; tx < c.x + c.w; tx += 8) {
        if ((tx + ty) % 16 === 0) g.fillRect(tx - ox, ty - oy, 2, 2);
      }
    }
  }

  // 墙体
  g.fillStyle(NES.WALL_OUTER, 1);
  for (const w of WALL) {
    g.fillRect(w.x - ox, w.y - oy, w.w, w.h);
  }
  // 外墙高亮上沿
  g.fillStyle(0x6b7a90, 1);
  g.fillRect(28 - ox, 28 - oy, 584, 2);

  // 门洞 — 用走廊色覆盖墙，并加门框点缀
  g.fillStyle(NES.ROAD_BASE, 1);
  for (const d of DOOR) {
    g.fillRect(d.x - ox, d.y - oy, d.w, d.h);
  }
  // 门框两端的浅色亮点
  g.fillStyle(0xf8fafc, 1);
  for (const d of DOOR) {
    if (d.w > d.h) {
      // 横向门
      g.fillRect(d.x - ox, d.y - oy, 2, d.h);
      g.fillRect(d.x + d.w - 2 - ox, d.y - oy, 2, d.h);
    } else {
      // 纵向门
      g.fillRect(d.x - ox, d.y - oy, d.w, 2);
      g.fillRect(d.x - ox, d.y + d.h - 2 - oy, d.w, 2);
    }
  }

  // 家具/装饰：严格限定在房间内
  drawMeetingRoom(g, ox, oy);
  drawWorkshop(g, ox, oy);
  drawTemple(g, ox, oy);
  drawOpenOffice(g, ox, oy);
  drawArchive(g, ox, oy);
  drawTaskBoard(g, ox, oy);
  drawMemory(g, ox, oy);
  drawLounge(g, ox, oy);

  drawZoneLabels(scene, parent, ox, oy);

  void scene;
}

// ── 各房间家具 ───────────────────────────────────────────────
function drawMeetingRoom(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_KNOWLEDGE;
  // 长会议桌
  const table = { x: r.x + 24, y: r.y + 56, w: r.w - 48, h: 32 };
  g.fillStyle(0xb8c0cc, 1);
  g.fillRect(table.x - ox, table.y - oy, table.w, table.h);
  g.fillStyle(0x6b7a90, 1);
  g.fillRect(table.x - ox, table.y - oy, table.w, 2);
  // 椅子（围桌）
  g.fillStyle(0x64748b, 1);
  for (let i = 0; i < 4; i++) {
    const cx = table.x + 16 + i * (table.w - 32) / 3;
    g.fillRect(cx - ox, table.y - 8 - oy, 12, 6);
    g.fillRect(cx - ox, table.y + table.h + 2 - oy, 12, 6);
  }
  // 投影屏
  g.fillStyle(0x1e293b, 1);
  g.fillRect(r.x + r.w / 2 - 18 - ox, r.y + 14 - oy, 36, 18);
  g.fillStyle(0x38bdf8, 1);
  g.fillRect(r.x + r.w / 2 - 16 - ox, r.y + 16 - oy, 32, 14);
}

function drawWorkshop(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_WORKSHOP;

  // 顶部白板（贴上沿墙）
  g.fillStyle(0xf8fafc, 1);
  g.fillRect(r.x + 20 - ox, r.y + 8 - oy, r.w - 40, 16);
  g.fillStyle(0x6b7a90, 1);
  g.fillRect(r.x + 20 - ox, r.y + 8 - oy, r.w - 40, 2);
  // 白板上的笔画
  g.fillStyle(0xef4444, 1);
  g.fillRect(r.x + 30 - ox, r.y + 14 - oy, 12, 2);
  g.fillStyle(0x3b82f6, 1);
  g.fillRect(r.x + 50 - ox, r.y + 14 - oy, 10, 2);
  g.fillStyle(0x22c55e, 1);
  g.fillRect(r.x + 70 - ox, r.y + 14 - oy, 14, 2);
  g.fillStyle(0xeab308, 1);
  g.fillRect(r.x + 92 - ox, r.y + 14 - oy, 8, 2);

  // 工坊桌：3 桌 × 2 排（开发工位 — 高显示器 + 文件柜）
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const dx = r.x + 22 + col * 44;
      const dy = r.y + 40 + row * 56;
      // 桌面
      g.fillStyle(NES.WALL_EDGE, 1);
      g.fillRect(dx - ox, dy - oy, 32, 16);
      // 双显示器
      g.fillStyle(0x1e293b, 1);
      g.fillRect(dx + 2 - ox, dy + 2 - oy, 12, 9);
      g.fillRect(dx + 18 - ox, dy + 2 - oy, 12, 9);
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(dx + 3 - ox, dy + 3 - oy, 10, 7);
      g.fillRect(dx + 19 - ox, dy + 3 - oy, 10, 7);
      // 屏上代码行
      g.fillStyle(0x7dd3fc, 1);
      g.fillRect(dx + 4 - ox, dy + 4 - oy, 6, 1);
      g.fillRect(dx + 20 - ox, dy + 4 - oy, 7, 1);
      // 椅子
      g.fillStyle(0x64748b, 1);
      g.fillRect(dx + 10 - ox, dy + 18 - oy, 12, 6);
    }
  }
}

function drawTemple(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_TEMPLE;

  // 上排：服务器机柜墙（数据中心）
  const rackY = r.y + 16;
  for (let i = 0; i < 8; i++) {
    const x = r.x + 14 + i * 22;
    g.fillStyle(0x334155, 1);
    g.fillRect(x - ox, rackY - oy, 18, 48);
    g.fillStyle(0x22d3ee, 1);
    g.fillRect(x + 3 - ox, rackY + 4 - oy, 12, 2);
    g.fillRect(x + 3 - ox, rackY + 10 - oy, 12, 2);
    g.fillRect(x + 3 - ox, rackY + 16 - oy, 12, 2);
    g.fillRect(x + 3 - ox, rackY + 22 - oy, 12, 2);
    // 状态灯
    g.fillStyle(0x22c55e, 1);
    g.fillRect(x + 3 - ox, rackY + 38 - oy, 4, 2);
    g.fillStyle(0xfbbf24, 1);
    g.fillRect(x + 10 - ox, rackY + 38 - oy, 4, 2);
  }

  // 中部：训练监控站（控制台 + 多屏）
  const consoleX = r.x + 32;
  const consoleY = r.y + 86;
  g.fillStyle(NES.WALL_EDGE, 1);
  g.fillRect(consoleX - ox, consoleY - oy, r.w - 64, 22);
  // 三联屏
  for (let i = 0; i < 3; i++) {
    g.fillStyle(0x1e293b, 1);
    g.fillRect(consoleX + 18 + i * 38 - ox, consoleY + 2 - oy, 28, 12);
    g.fillStyle(0x38bdf8, 1);
    g.fillRect(consoleX + 19 + i * 38 - ox, consoleY + 3 - oy, 26, 10);
    g.fillStyle(0x7dd3fc, 1);
    g.fillRect(consoleX + 20 + i * 38 - ox, consoleY + 4 - oy, 12, 1);
    g.fillRect(consoleX + 35 + i * 38 - ox, consoleY + 7 - oy, 8, 1);
  }

  // 控制台椅
  g.fillStyle(0x475569, 1);
  for (let i = 0; i < 3; i++) {
    g.fillRect(consoleX + 24 + i * 38 - ox, consoleY + 26 - oy, 16, 6);
  }
}

function drawOpenOffice(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = OPEN_OFFICE;
  // 开放工位：4 × 3 工位网格，居中对称
  const cols = 4;
  const rows = 3;
  const cellW = 50;
  const cellH = 44;
  const startX = r.x + (r.w - cellW * cols) / 2;
  const startY = r.y + (r.h - cellH * rows) / 2 + 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dx = startX + col * cellW;
      const dy = startY + row * cellH;
      // 桌面
      g.fillStyle(NES.WALL_EDGE, 1);
      g.fillRect(dx - ox, dy - oy, 38, 22);
      // 桌面阴影
      g.fillStyle(0xa8b0bc, 1);
      g.fillRect(dx - ox, dy + 20 - oy, 38, 2);
      // 显示器底座
      g.fillStyle(0x334155, 1);
      g.fillRect(dx + 16 - ox, dy + 16 - oy, 6, 3);
      // 双显示器
      g.fillStyle(0x1e293b, 1);
      g.fillRect(dx + 4 - ox, dy + 2 - oy, 14, 12);
      g.fillRect(dx + 20 - ox, dy + 2 - oy, 14, 12);
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(dx + 5 - ox, dy + 3 - oy, 12, 8);
      g.fillRect(dx + 21 - ox, dy + 3 - oy, 12, 8);
      g.fillStyle(0x7dd3fc, 1);
      g.fillRect(dx + 5 - ox, dy + 3 - oy, 12, 1);
      g.fillRect(dx + 21 - ox, dy + 3 - oy, 12, 1);
      // 椅子
      g.fillStyle(0x475569, 1);
      g.fillRect(dx + 12 - ox, dy + 26 - oy, 14, 8);
      g.fillStyle(0x64748b, 1);
      g.fillRect(dx + 14 - ox, dy + 28 - oy, 10, 4);
    }
  }
}

function drawArchive(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_ARCHIVE;
  // 归档：3 个文件柜
  for (let i = 0; i < 4; i++) {
    g.fillStyle(0x94a3b8, 1);
    g.fillRect(r.x + 10 + i * 28 - ox, r.y + 22 - oy, 22, 24);
    g.fillStyle(0x64748b, 1);
    g.fillRect(r.x + 10 + i * 28 - ox, r.y + 28 - oy, 22, 2);
    g.fillRect(r.x + 10 + i * 28 - ox, r.y + 36 - oy, 22, 2);
  }
}

function drawTaskBoard(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_TASK;
  // 公告板
  g.fillStyle(0x475569, 1);
  g.fillRect(r.x + 12 - ox, r.y + 14 - oy, r.w - 24, 28);
  // 便签
  const stickers = [
    { x: r.x + 18, y: r.y + 18, c: 0xfde68a },
    { x: r.x + 36, y: r.y + 20, c: 0xfca5a5 },
    { x: r.x + 54, y: r.y + 18, c: 0xbef264 },
    { x: r.x + 72, y: r.y + 22, c: 0x93c5fd },
    { x: r.x + 90, y: r.y + 18, c: 0xfde68a },
    { x: r.x + 108, y: r.y + 22, c: 0xfca5a5 },
  ];
  stickers.forEach((s) => {
    g.fillStyle(s.c, 1);
    g.fillRect(s.x - ox, s.y - oy, 12, 12);
  });
}

function drawMemory(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_MEMORY;
  // 资料室：靠墙书架 + 桌上资料堆
  const shelfColors = [0xa3826b, 0x8b6f5a, 0x9a7a64];
  const bookPalette = [0xef4444, 0x3b82f6, 0x22c55e, 0xeab308, 0xa855f7, 0xfb923c];

  for (let i = 0; i < 4; i++) {
    const sx = r.x + 12 + i * 30;
    const sy = r.y + 14;
    // 书架外框
    g.fillStyle(shelfColors[i % shelfColors.length], 1);
    g.fillRect(sx - ox, sy - oy, 24, 30);
    // 三层书架隔板
    g.fillStyle(0x6b4f3e, 1);
    g.fillRect(sx - ox, sy + 9 - oy, 24, 2);
    g.fillRect(sx - ox, sy + 19 - oy, 24, 2);
    // 每层 4 本书脊
    for (let row = 0; row < 3; row++) {
      for (let book = 0; book < 4; book++) {
        const bx = sx + 2 + book * 5;
        const by = sy + 1 + row * 10;
        g.fillStyle(bookPalette[(i * 7 + row * 3 + book) % bookPalette.length], 1);
        g.fillRect(bx - ox, by - oy, 4, 7);
      }
    }
  }
}

/** 茶水休闲区：合并咖啡区 / 沙发组 / 盆栽 */
function drawLounge(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
  const r = ROOM_LOUNGE;

  // 顶部：咖啡操作台 + 咖啡机 + 水机 + 冰箱
  const counter = { x: r.x + 16, y: r.y + 16, w: r.w - 90, h: 18 };
  g.fillStyle(0xe2e8f0, 1);
  g.fillRect(counter.x - ox, counter.y - oy, counter.w, counter.h);
  g.fillStyle(0x94a3b8, 1);
  g.fillRect(counter.x - ox, counter.y + counter.h - oy, counter.w, 2);
  // 咖啡机
  g.fillStyle(0x475569, 1);
  g.fillRect(counter.x + 6 - ox, counter.y + 2 - oy, 14, 14);
  g.fillStyle(0xfde68a, 1);
  g.fillRect(counter.x + 8 - ox, counter.y + 8 - oy, 10, 4);
  // 水机
  g.fillStyle(0x38bdf8, 1);
  g.fillRect(counter.x + 28 - ox, counter.y + 2 - oy, 14, 6);
  g.fillStyle(0x94a3b8, 1);
  g.fillRect(counter.x + 28 - ox, counter.y + 8 - oy, 14, 8);
  // 微波炉
  g.fillStyle(0x334155, 1);
  g.fillRect(counter.x + 48 - ox, counter.y + 2 - oy, 16, 10);
  g.fillStyle(0x7dd3fc, 1);
  g.fillRect(counter.x + 50 - ox, counter.y + 4 - oy, 12, 6);

  // 冰箱（独立柜，紧贴右上）
  const fridge = { x: r.x + r.w - 56, y: r.y + 12, w: 24, h: 44 };
  g.fillStyle(0xcbd5e1, 1);
  g.fillRect(fridge.x - ox, fridge.y - oy, fridge.w, fridge.h);
  g.fillStyle(0x94a3b8, 1);
  g.fillRect(fridge.x - ox, fridge.y + 20 - oy, fridge.w, 2);
  g.fillStyle(0x475569, 1);
  g.fillRect(fridge.x + fridge.w - 4 - ox, fridge.y + 4 - oy, 2, 4);
  g.fillRect(fridge.x + fridge.w - 4 - ox, fridge.y + 24 - oy, 2, 4);

  // 中部：两张沙发面对茶几
  const sofa1 = { x: r.x + 22, y: r.y + 64, w: 58, h: 20 };
  const sofa2 = { x: r.x + 22, y: r.y + 116, w: 58, h: 20 };
  const tea = { x: r.x + 30, y: r.y + 92, w: 42, h: 18 };

  [sofa1, sofa2].forEach((s, idx) => {
    g.fillStyle(0x6b7a90, 1);
    g.fillRect(s.x - ox, s.y - oy, s.w, s.h);
    g.fillStyle(0x94a3b8, 1);
    if (idx === 0) {
      g.fillRect(s.x - ox, s.y - oy, s.w, 4); // 上沙发靠背在上
    } else {
      g.fillRect(s.x - ox, s.y + s.h - 4 - oy, s.w, 4); // 下沙发靠背在下
    }
  });
  // 茶几
  g.fillStyle(0x78593a, 1);
  g.fillRect(tea.x - ox, tea.y - oy, tea.w, tea.h);
  g.fillStyle(0x5b4128, 1);
  g.fillRect(tea.x - ox, tea.y + tea.h - 2 - oy, tea.w, 2);

  // 茶几上的杯子
  g.fillStyle(0xfafafa, 1);
  g.fillRect(tea.x + 6 - ox, tea.y + 6 - oy, 4, 6);
  g.fillRect(tea.x + tea.w - 10 - ox, tea.y + 6 - oy, 4, 6);

  // 右下角：吧台 + 高脚椅
  const bar = { x: r.x + r.w - 60, y: r.y + 80, w: 48, h: 12 };
  g.fillStyle(0x78593a, 1);
  g.fillRect(bar.x - ox, bar.y - oy, bar.w, bar.h);
  g.fillStyle(0x5b4128, 1);
  g.fillRect(bar.x - ox, bar.y + bar.h - 2 - oy, bar.w, 2);
  g.fillStyle(0x475569, 1);
  for (let i = 0; i < 3; i++) {
    g.fillRect(bar.x + 8 + i * 14 - ox, bar.y + bar.h + 4 - oy, 8, 8);
  }

  // 右下角盆栽
  g.fillStyle(0x78593a, 1);
  g.fillRect(r.x + r.w - 22 - ox, r.y + r.h - 28 - oy, 14, 6);
  g.fillStyle(0x3d9a50, 1);
  g.fillRect(r.x + r.w - 20 - ox, r.y + r.h - 38 - oy, 10, 10);
  g.fillRect(r.x + r.w - 22 - ox, r.y + r.h - 42 - oy, 14, 6);
}

function drawZoneLabels(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  ox: number,
  oy: number,
) {
  const labels = [{ text: "茶水休闲区", rect: ROOM_LOUNGE }];
  labels.forEach(({ text, rect }) => {
    const t = scene.add.text(rect.x + rect.w / 2 - ox, rect.y + 4 - oy, text, {
      fontSize: "8px",
      color: "#1e293b",
      fontStyle: "bold",
      backgroundColor: "#E2E8F0",
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 0).setResolution(2);
    parent.add(t);
  });
}

// ── 房间标牌（执行中脉冲） ────────────────────────────────────
export function createRoomMarkers(
  scene: Phaser.Scene,
  originX: number,
  originY: number,
): Map<string, Phaser.GameObjects.Container> {
  const markers = new Map<string, Phaser.GameObjects.Container>();
  const accent: Record<string, number> = {
    library: 0x3b82f6,
    workshop: 0x8b5cf6,
    temple: 0xf59e0b,
    archive: 0x64748b,
    memory: 0x06b6d4,
    task: 0x22c55e,
  };

  (Object.keys(OFFICE_BUILDINGS) as Array<keyof typeof OFFICE_BUILDINGS>).forEach((key) => {
    if (key === "square") return;
    const b = OFFICE_BUILDINGS[key];
    const zone = ROOM_HIGHLIGHT[key];
    if (!zone) return;

    const lx = b.x - originX;
    const ly = b.y - originY;
    const container = scene.add.container(lx, ly);

    const zoneGfx = scene.add.graphics();
    zoneGfx.fillStyle(0x000000, 0);
    zoneGfx.fillRect(-zone.w / 2, -zone.h / 2, zone.w, zone.h);
    container.add(zoneGfx);

    const badge = scene.add.graphics();
    const bw = Math.min(b.label.length * 7 + 16, zone.w - 8);
    const badgeY = -zone.h / 2 + 6;
    badge.fillStyle(NES.WALL_WHITE, 1);
    badge.fillRect(-bw / 2, badgeY, bw, 14);
    badge.lineStyle(1, accent[key] ?? NES.WINDOW_GLASS, 1);
    badge.strokeRect(-bw / 2, badgeY, bw, 14);
    container.add(badge);

    const label = scene.add.text(0, badgeY + 7, b.label, {
      fontSize: "8px",
      color: "#334155",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    container.add(label);

    (container as Phaser.GameObjects.Container & {
      highlightZone?: Phaser.GameObjects.Graphics;
      zoneRect?: Rect;
    }).highlightZone = zoneGfx;
    (container as Phaser.GameObjects.Container & { zoneRect?: Rect }).zoneRect = zone;

    zoneGfx.setInteractive(
      new Phaser.Geom.Rectangle(-zone.w / 2, -zone.h / 2, zone.w, zone.h),
      Phaser.Geom.Rectangle.Contains,
    );

    markers.set(key, container);
  });

  return markers;
}

/** 角落盆栽 — 摆在房间内不挡门 */
export function drawOfficePlants(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  originX: number,
  originY: number,
): Phaser.GameObjects.Image[] {
  const ox = originX;
  const oy = originY;
  const spots = [
    { x: ROOM_KNOWLEDGE.x + 16, y: ROOM_KNOWLEDGE.y + ROOM_KNOWLEDGE.h - 8 },
    { x: ROOM_TEMPLE.x + ROOM_TEMPLE.w - 16, y: ROOM_TEMPLE.y + ROOM_TEMPLE.h - 8 },
    { x: OPEN_OFFICE.x + 8, y: OPEN_OFFICE.y + 8 },
    { x: OPEN_OFFICE.x + OPEN_OFFICE.w - 8, y: OPEN_OFFICE.y + 8 },
    { x: OPEN_OFFICE.x + 8, y: OPEN_OFFICE.y + OPEN_OFFICE.h - 8 },
    { x: OPEN_OFFICE.x + OPEN_OFFICE.w - 8, y: OPEN_OFFICE.y + OPEN_OFFICE.h - 8 },
  ];
  const created: Phaser.GameObjects.Image[] = [];
  spots.forEach(({ x, y }) => {
    if (!isOfficeWalkable(x, y)) return;
    const plant = scene.add.image(x - ox, y - oy, "sparseTree");
    plant.setOrigin(0.5, 1);
    plant.setScale(0.8);
    parent.add(plant);
    created.push(plant);
  });
  return created;
}
