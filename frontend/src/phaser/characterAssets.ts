/**
 * 角色资产 — NES/FC 吞食天地2 风格 16×16 像素精灵
 * 双层结构：char_base（身体/轮廓）+ char_helmet（头盔填充，可 tint 变色）
 */
import type Phaser from "phaser";
import { NES_HEX } from "./nesColors";

type PixelRow = (string | null)[];

const _ = null; // 透明
const O = NES_HEX.OUTLINE;
const F = NES_HEX.CHAR_SKIN;
const W = NES_HEX.CHAR_ARMOR;
const G = NES_HEX.CHAR_WEAPON;

/** char_base 正面（朝下走）：身体、面部、铠甲、腿、武器 */
const BASE_FRONT: PixelRow[] = [
  [_,_,_,_,_,O,_,_,_,O,_,_,_,_,_,_],
  [_,_,_,_,O,_,_,_,_,_,O,_,_,_,_,_],
  [_,_,_,_,O,_,_,_,_,_,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,O,O,W,W,W,W,W,O,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,_,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,G,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
];

/** char_base 正面 走动帧（腿微动，幅度小：左腿略前） */
const BASE_FRONT_WALK: PixelRow[] = [
  ...BASE_FRONT.slice(0, 12),
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,O,O,_,_,O,O,O,_,_,_,_,_],
];

/** char_base 背面（朝上走）：头盔、铠甲、腿 */
const BASE_BACK: PixelRow[] = [
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,O,O,W,W,W,W,W,O,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,_,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,G,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
];

/** char_base 背面 走动帧（腿微动，幅度小） */
const BASE_BACK_WALK: PixelRow[] = [
  ...BASE_BACK.slice(0, 12),
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,O,O,_,_,O,O,O,_,_,_,_,_],
];

/** char_base 侧面（朝左/右走）：站立时双腿，与身体对齐 */
const BASE_SIDE: PixelRow[] = [
  [_,_,_,_,_,_,O,O,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,O,W,W,W,O,O,_,_,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,G,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,G,_,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,G,_,_,_,_],
  [_,_,_,_,O,W,W,O,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
];

/** char_base 侧面 走动帧（单腿前伸，与身体对齐） */
const BASE_SIDE_WALK: PixelRow[] = [
  ...BASE_SIDE.slice(0, 12),
  [_,_,_,_,O,W,W,W,W,O,_,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,W,O,_,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,W,O,_,_,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,_,_,_,_,_,_],
];

/** char_helmet 正面 */
const HELMET_FRONT: PixelRow[] = [
  [_,_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** char_helmet 背面（#FFFFFF 为 tint 填充区） */
const HELMET_BACK: PixelRow[] = [
  [_,_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** char_helmet 侧面（#FFFFFF 为 tint 填充区） */
const HELMET_SIDE: PixelRow[] = [
  [_,_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** 将像素数组绘制到 Canvas */
function renderPixels(ctx: CanvasRenderingContext2D, pixels: PixelRow[]) {
  for (let y = 0; y < pixels.length; y++) {
    for (let x = 0; x < pixels[y].length; x++) {
      const c = pixels[y][x];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

/** 注册角色纹理到场景（4 方向） */
export function registerCharacterTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;
  const add = (key: string, pixels: PixelRow[]) => {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    renderPixels(c.getContext("2d")!, pixels);
    textures.addCanvas(key, c);
  };
  add("char_base_front", BASE_FRONT);
  add("char_base_front_walk", BASE_FRONT_WALK);
  add("char_base_back", BASE_BACK);
  add("char_base_back_walk", BASE_BACK_WALK);
  add("char_base_side", BASE_SIDE);
  add("char_base_side_walk", BASE_SIDE_WALK);
  add("char_helmet_front", HELMET_FRONT);
  add("char_helmet_back", HELMET_BACK);
  add("char_helmet_side", HELMET_SIDE);
  add("char_base", BASE_FRONT);
  add("char_helmet", HELMET_FRONT);
}

/** 角色布局常量 */
export const CHAR_LAYOUT = {
  scale: 2,
  depth: 400,
  labelOffsetY: 14,
} as const;

export type CharFacing = "front" | "back" | "left" | "right";

/** 根据朝向与走动帧设置 base/helmet 纹理（walkFrame: 0=站立双腿, 1=迈步单腿） */
export function setCharFacing(
  base: Phaser.GameObjects.Sprite,
  helmet: Phaser.GameObjects.Sprite,
  facing: CharFacing,
  walkFrame = 0,
): void {
  const flipX = facing === "right";
  const w = walkFrame ? "_walk" : "";
  if (facing === "front") {
    base.setTexture(`char_base_front${w}`);
    helmet.setTexture("char_helmet_front");
    base.setFlipX(false);
  } else if (facing === "back") {
    base.setTexture(`char_base_back${w}`);
    helmet.setTexture("char_helmet_back");
    base.setFlipX(false);
  } else {
    base.setTexture(`char_base_side${w}`);
    helmet.setTexture("char_helmet_side");
    base.setFlipX(flipX);
    helmet.setFlipX(flipX);
  }
}

/** 创建角色容器（base + helmet + label），body 用于上下浮动与朝向 */
export function createCharacterContainer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  labelText: string,
): {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Sprite;
  helmet: Phaser.GameObjects.Sprite;
} {
  const { scale, depth, labelOffsetY } = CHAR_LAYOUT;

  const container = scene.add.container(x, y);
  const body = scene.add.container(0, 0);

  const base = scene.add.sprite(0, 0, "char_base_front");
  const helmet = scene.add.sprite(0, 0, "char_helmet_front");
  helmet.setTint(color);
  body.add([base, helmet]);

  const label = scene.add.text(0, labelOffsetY, labelText, {
    fontSize: "5px",
    color: "#F8F8F8",
    fontStyle: "bold",
    backgroundColor: "#000000",
    padding: { x: 2, y: 1 },
  }).setOrigin(0.5, 0).setResolution(2);

  container.add([body, label]);
  container.setScale(scale);
  container.setDepth(depth);

  return { container, label, body, base, helmet };
}
