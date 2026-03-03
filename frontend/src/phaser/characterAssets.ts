/**
 * 角色资产 — Minecraft 风格智能体纹理与创建逻辑
 * 从 TownScene 抽离，便于维护与复用
 */
import type Phaser from "phaser";

/** 3/4 视角立体方块绘制 */
function drawBlock3d(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  sideW: number,
  topH: number,
  front: string,
  side: string,
  top: string
) {
  ctx.fillStyle = side;
  ctx.fillRect(fx + fw, fy + topH, sideW, fh - topH);
  ctx.fillStyle = front;
  ctx.fillRect(fx, fy + topH, fw, fh - topH);
  ctx.fillStyle = top;
  ctx.fillRect(fx, fy, fw + sideW, topH);
}

/** 注册角色相关纹理到场景 */
export function registerCharacterTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  // 1) 头部 — 立体方块 + 脸部（眼睛/眉毛/嘴巴/头发）
  const headCanvas = document.createElement("canvas");
  headCanvas.width = 28;
  headCanvas.height = 26;
  const headCtx = headCanvas.getContext("2d")!;
  headCtx.fillStyle = "#5d3d1e";
  headCtx.fillRect(16, 10, 8, 14);
  headCtx.fillStyle = "#8d6e4b";
  headCtx.fillRect(0, 10, 16, 14);
  headCtx.fillStyle = "#a08060";
  headCtx.fillRect(2, 4, 18, 6);
  headCtx.fillStyle = "#6b5344";
  headCtx.fillRect(4, 2, 14, 3);
  headCtx.fillStyle = "#3d2c1e";
  headCtx.fillRect(5, 12, 2, 2);
  headCtx.fillRect(10, 12, 2, 2);
  headCtx.fillRect(4, 11, 10, 1);
  headCtx.fillRect(6, 15, 4, 1);
  textures.addCanvas("char_head", headCanvas);

  // 2) 身体 — 立体 + 衣领/腰带
  const bodyCanvas = document.createElement("canvas");
  bodyCanvas.width = 28;
  bodyCanvas.height = 28;
  const bodyCtx = bodyCanvas.getContext("2d")!;
  drawBlock3d(bodyCtx, 6, 0, 14, 14, 4, 3, "#ffffff", "#5a5a5a", "#e8e8e8");
  bodyCtx.fillStyle = "#d0d0d0";
  bodyCtx.fillRect(6, 2, 14, 2);
  drawBlock3d(bodyCtx, 6, 11, 14, 14, 4, 3, "#ffffff", "#5a5a5a", "#e8e8e8");
  bodyCtx.fillStyle = "#4a4a4a";
  bodyCtx.fillRect(6, 20, 14, 2);
  textures.addCanvas("char_body", bodyCanvas);

  // 3) 左臂 — 肤色立体（侧面/正面/顶面）
  const armLCanvas = document.createElement("canvas");
  armLCanvas.width = 12;
  armLCanvas.height = 24;
  const armLCtx = armLCanvas.getContext("2d")!;
  armLCtx.fillStyle = "#5d3d1e";
  armLCtx.fillRect(6, 4, 4, 18);
  armLCtx.fillStyle = "#8d6e4b";
  armLCtx.fillRect(0, 4, 6, 18);
  armLCtx.fillStyle = "#a08060";
  armLCtx.fillRect(0, 0, 8, 4);
  armLCtx.fillStyle = "#6d4c2b";
  armLCtx.fillRect(4, 10, 2, 2);
  textures.addCanvas("char_arm_left", armLCanvas);

  // 4) 右臂 — 肤色立体
  const armRCanvas = document.createElement("canvas");
  armRCanvas.width = 12;
  armRCanvas.height = 24;
  const armRCtx = armRCanvas.getContext("2d")!;
  armRCtx.fillStyle = "#5d3d1e";
  armRCtx.fillRect(2, 4, 4, 18);
  armRCtx.fillStyle = "#8d6e4b";
  armRCtx.fillRect(6, 4, 6, 18);
  armRCtx.fillStyle = "#a08060";
  armRCtx.fillRect(2, 0, 8, 4);
  armRCtx.fillStyle = "#6d4c2b";
  armRCtx.fillRect(4, 10, 2, 2);
  textures.addCanvas("char_arm_right", armRCanvas);

  // 5) 腿+脚 — 立体 + 鞋子
  const legsCanvas = document.createElement("canvas");
  legsCanvas.width = 28;
  legsCanvas.height = 32;
  const legsCtx = legsCanvas.getContext("2d")!;
  legsCtx.fillStyle = "rgba(0,0,0,0.35)";
  legsCtx.fillRect(4, 26, 20, 6);
  drawBlock3d(legsCtx, 6, 0, 5, 14, 3, 2, "#b8b8b8", "#5a5a5a", "#d8d8d8");
  drawBlock3d(legsCtx, 15, 0, 5, 14, 3, 2, "#b8b8b8", "#5a5a5a", "#d8d8d8");
  legsCtx.fillStyle = "#2d2018";
  legsCtx.fillRect(6, 14, 6, 6);
  legsCtx.fillRect(15, 14, 6, 6);
  legsCtx.fillStyle = "#1a1510";
  legsCtx.fillRect(8, 18, 4, 4);
  legsCtx.fillRect(17, 18, 4, 4);
  textures.addCanvas("char_legs", legsCanvas);
}

/** 角色布局常量 */
export const CHAR_LAYOUT = {
  scale: 0.85,
  depth: 400,
  labelOffsetY: 28,
  armOffsetX: 10,
  headOffsetY: -27,
  headOffsetX: 2,
  legsOffsetY: 18,
} as const;

/** 创建角色容器（腿/身体/手臂/头/标签） */
export function createCharacterContainer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  labelText: string
): { container: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text } {
  const { scale, depth, labelOffsetY, armOffsetX, headOffsetY, headOffsetX, legsOffsetY } = CHAR_LAYOUT;

  const container = scene.add.container(x, y);

  const legs = scene.add.sprite(0, legsOffsetY, "char_legs");
  legs.setTint(color);

  const body = scene.add.sprite(0, 0, "char_body");
  body.setTint(color);

  const armL = scene.add.sprite(-armOffsetX, 2, "char_arm_left");
  const armR = scene.add.sprite(armOffsetX, 2, "char_arm_right");
  const head = scene.add.sprite(headOffsetX, headOffsetY, "char_head");

  const label = scene.add.text(0, labelOffsetY, labelText, {
    fontSize: "9px",
    color: "#f1f5f9",
    fontStyle: "bold",
    stroke: "#0f172a",
    strokeThickness: 2,
    backgroundColor: "rgba(15,23,42,0.85)",
    padding: { x: 6, y: 3 },
  }).setOrigin(0.5);

  container.add([legs, body, armL, armR, head, label]);
  label.setDepth(1);
  container.setScale(scale);
  container.setDepth(depth);

  return { container, label };
}
