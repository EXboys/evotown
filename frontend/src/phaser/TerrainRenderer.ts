import Phaser from "phaser";
import { NES } from "./nesColors";
import {
  BUILDINGS,
  createBuilding,
  createCastle,
  drawPaths,
  drawRiverAndPond,
  drawForestClusters,
  drawMountainClusters,
} from "./sceneAssets";

export interface TerrainConfig {
  scene: Phaser.Scene;
  worldInner: Phaser.GameObjects.Container;
  worldContainer: Phaser.GameObjects.Container;
  width: number;
  height: number;
}

/** 视差系数：镜头偏移 (dx,dy) 时，该层相对位移为 (-dx*(1-factor), -dy*(1-factor))，factor 越大层越「跟镜头」 */
const PARALLAX_BACK = 0.3;  // 背景动得最慢
const PARALLAX_MID = 0.6;   // 中景
const PARALLAX_FRONT = 1;   // 前景与镜头 1:1

/** 执行中建筑的高亮叠加色（暖色「亮灯」感） */
const ACTIVE_BUILDING_OVERLAY = 0xeeddbb;

export class TerrainRenderer {
  private scene: Phaser.Scene;
  private worldInner: Phaser.GameObjects.Container;
  private buildingRects: Map<string, Phaser.GameObjects.Container> = new Map();
  private worldBack!: Phaser.GameObjects.Container;
  private worldMid!: Phaser.GameObjects.Container;
  private worldFront!: Phaser.GameObjects.Container;
  private activeBuildingKeys: Set<string> = new Set();
  private smokeTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
  private swayTrees: Phaser.GameObjects.Image[] = [];
  private waterBubbles: { g: Phaser.GameObjects.Graphics; baseY: number }[] = [];
  private ambientSmokeTimers: Map<string, Phaser.Time.TimerEvent> = new Map();

  constructor(config: TerrainConfig) {
    this.scene = config.scene;
    this.worldInner = config.worldInner;
    this.render(config.width, config.height);
  }

  getBuilding(key: string): Phaser.GameObjects.Container | undefined {
    return this.buildingRects.get(key);
  }

  getAllBuildings(): Map<string, Phaser.GameObjects.Container> {
    return this.buildingRects;
  }

  /** 根据镜头相对默认中心的偏移 (dx, dy) 更新视差层位置，每帧由 TownScene.update 调用 */
  setParallaxOffset(dx: number, dy: number) {
    this.worldBack.setPosition(-dx * (1 - PARALLAX_BACK), -dy * (1 - PARALLAX_BACK));
    this.worldMid.setPosition(-dx * (1 - PARALLAX_MID), -dy * (1 - PARALLAX_MID));
    this.worldFront.setPosition(-dx * (1 - PARALLAX_FRONT), -dy * (1 - PARALLAX_FRONT));
  }

  /** 环境小动画：树梢轻摆、水面微动，每帧由 TownScene.update 调用 */
  updateAmbient(time: number) {
    this.swayTrees.forEach((img, i) => {
      const sway = Math.sin(time * 0.002 + i * 1.2) * 0.06;
      img.setScale(1 + sway, 1);
    });
    this.waterBubbles.forEach(({ g, baseY }, i) => {
      g.y = baseY + Math.sin(time * 0.0012 + i * 2) * 4;
    });
  }

  /** 设置当前正在执行任务的建筑（agent 在 execute 且距离建筑足够近），高亮 + 屋顶冒烟 */
  setActiveBuildings(activeKeys: Set<string>) {
    const prev = this.activeBuildingKeys;
    for (const key of prev) {
      if (!activeKeys.has(key)) {
        this.clearBuildingActive(key);
      }
    }
    for (const key of activeKeys) {
      if (!prev.has(key)) {
        this.setBuildingActive(key);
      }
    }
    this.activeBuildingKeys = new Set(activeKeys);
  }

  private setBuildingActive(key: string) {
    if (key === "workshop") this.stopAmbientSmoke(key);
    const container = this.buildingRects.get(key);
    if (!container) return;
    const overlay = this.scene.add.graphics();
    overlay.fillStyle(ACTIVE_BUILDING_OVERLAY, 0.22);
    overlay.fillRoundedRect(-35, -35, 70, 50, 4);
    overlay.setDepth(-1);
    container.addAt(overlay, 0);
    (container as Phaser.GameObjects.Container & { activeOverlay?: Phaser.GameObjects.Graphics }).activeOverlay = overlay;
    const smokeContainer = this.scene.add.container(0, -28);
    (container as Phaser.GameObjects.Container & { smokeContainer?: Phaser.GameObjects.Container }).smokeContainer = smokeContainer;
    container.add(smokeContainer);
    const spawnSmoke = () => {
      const g = this.scene.add.graphics();
      g.fillStyle(0x888888, 0.5);
      g.fillCircle(0, 0, 3);
      const ox = (Math.random() - 0.5) * 12;
      smokeContainer.add(g);
      g.setPosition(ox, 0);
      this.scene.tweens.add({
        targets: g,
        y: g.y - 16,
        alpha: 0,
        duration: 900,
        ease: "Cubic.easeOut",
        onComplete: () => g.destroy(),
      });
    };
    spawnSmoke();
    this.scene.time.delayedCall(400, spawnSmoke);
    this.scene.time.delayedCall(800, spawnSmoke);
    const timer = this.scene.time.addEvent({
      delay: 1200,
      callback: () => {
        if (!this.activeBuildingKeys.has(key)) return;
        spawnSmoke();
      },
      loop: true,
    });
    this.smokeTimers.set(key, timer);
  }

  private clearBuildingActive(key: string) {
    const container = this.buildingRects.get(key);
    if (!container) return;
    const c = container as Phaser.GameObjects.Container & { activeOverlay?: Phaser.GameObjects.Graphics; smokeContainer?: Phaser.GameObjects.Container };
    if (c.activeOverlay) {
      c.activeOverlay.destroy();
      c.activeOverlay = undefined;
    }
    if (c.smokeContainer) {
      c.smokeContainer.destroy();
      c.smokeContainer = undefined;
    }
    const timer = this.smokeTimers.get(key);
    if (timer) {
      timer.destroy();
      this.smokeTimers.delete(key);
    }
    if (key === "workshop") this.startAmbientSmoke(key);
  }

  private startAmbientSmoke(buildingKey: string) {
    if (this.ambientSmokeTimers.has(buildingKey)) return;
    const container = this.buildingRects.get(buildingKey);
    if (!container) return;
    const ambientSmoke = this.scene.add.container(0, -22);
    (container as Phaser.GameObjects.Container & { ambientSmokeContainer?: Phaser.GameObjects.Container }).ambientSmokeContainer = ambientSmoke;
    container.add(ambientSmoke);
    const spawn = () => {
      const g = this.scene.add.graphics();
      g.fillStyle(0x666666, 0.35);
      g.fillCircle(0, 0, 2);
      const ox = (Math.random() - 0.5) * 10;
      ambientSmoke.add(g);
      g.setPosition(ox, 0);
      this.scene.tweens.add({
        targets: g,
        y: g.y - 12,
        alpha: 0,
        duration: 1200,
        ease: "Cubic.easeOut",
        onComplete: () => g.destroy(),
      });
    };
    const timer = this.scene.time.addEvent({ delay: 2500, callback: spawn, loop: true });
    this.ambientSmokeTimers.set(buildingKey, timer);
  }

  private stopAmbientSmoke(buildingKey: string) {
    const timer = this.ambientSmokeTimers.get(buildingKey);
    if (timer) {
      timer.destroy();
      this.ambientSmokeTimers.delete(buildingKey);
    }
    const container = this.buildingRects.get(buildingKey);
    if (!container) return;
    const c = container as Phaser.GameObjects.Container & { ambientSmokeContainer?: Phaser.GameObjects.Container };
    if (c.ambientSmokeContainer) {
      c.ambientSmokeContainer.destroy();
      c.ambientSmokeContainer = undefined;
    }
  }

  private render(w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;

    this.worldBack = this.scene.add.container(0, 0);
    this.worldMid = this.scene.add.container(0, 0);
    this.worldFront = this.scene.add.container(0, 0);

    // 背景层：草地、森林、山脉
    const grass = this.scene.add.tileSprite(0, 0, w + 64, h + 64, "grass");
    grass.setTileScale(1);
    this.worldBack.add(grass);
    drawForestClusters(this.scene, this.worldBack, cx, cy);
    drawMountainClusters(this.scene, this.worldBack, cx, cy);
    const swayPositions = [
      { x: 80 - cx, y: 95 - cy }, { x: 520 - cx, y: 100 - cy }, { x: 90 - cx, y: 380 - cy },
      { x: 500 - cx, y: 390 - cy }, { x: 200 - cx, y: 60 - cy },
    ];
    swayPositions.forEach((pos) => {
      const tree = this.scene.add.image(pos.x, pos.y, "forestTree").setOrigin(0.5, 1);
      this.worldBack.add(tree);
      this.swayTrees.push(tree);
    });

    drawPaths(this.scene, this.worldMid, cx, cy);
    drawRiverAndPond(this.scene, this.worldMid, cx, cy);
    const stonePositions = [
      { x: 255, y: 200 }, { x: 385, y: 280 },
      { x: 200, y: 240 }, { x: 440, y: 224 },
      { x: 280, y: 360 }, { x: 360, y: 120 },
      { x: 170, y: 300 }, { x: 460, y: 290 },
    ];
    stonePositions.forEach(({ x, y }) => {
      const stone = this.scene.add.image(x - cx, y - cy, "stone");
      this.worldMid.add(stone);
    });
    const bubblePositions = [{ x: 580 - cx, y: 280 - cy }, { x: 560 - cx, y: 360 - cy }, { x: 530 - cx, y: 320 - cy }];
    bubblePositions.forEach((pos) => {
      const g = this.scene.add.graphics();
      g.fillStyle(0x88aacc, 0.4);
      g.fillCircle(pos.x, pos.y, 2);
      this.worldMid.add(g);
      this.waterBubbles.push({ g, baseY: pos.y });
    });

    // 前景层：建筑（与镜头 1:1），整体缩小以显地图更开阔
    const BUILDING_SCALE = 0.85;
    Object.entries(BUILDINGS).forEach(([key, b]) => {
      if (key === "task") return;
      const container = key === "square"
        ? createCastle(this.scene, b.x - cx, b.y - cy, b.label)
        : createBuilding(this.scene, key, b.x - cx, b.y - cy, b.w, b.h, b.roof, b.label, b.color);
      container.setScale(BUILDING_SCALE);
      this.worldFront.add(container);
      this.buildingRects.set(key, container);
    });

    // 工坊常驻轻烟（非执行中时可见；执行中由 setBuildingActive 的烟盖过）
    this.startAmbientSmoke("workshop");

    this.worldInner.add(this.worldBack);
    this.worldInner.add(this.worldMid);
    this.worldInner.add(this.worldFront);
  }
}

export interface UIConfig {
  scene: Phaser.Scene;
  width: number;
  height: number;
}

export class UIRenderer {
  private scene: Phaser.Scene;
  private subtitleContainer!: Phaser.GameObjects.Container;
  private subtitleText!: Phaser.GameObjects.Text;
  private subtitleQueue: Array<{ text: string; level: string }> = [];
  private subtitlePlaying = false;

  constructor(config: UIConfig) {
    this.scene = config.scene;
    this.render(config.width, config.height);
  }

  private render(w: number, h: number) {
    // 标题栏
    const titleBg = this.scene.add.graphics();
    titleBg.fillStyle(NES.BLACK, 1);
    titleBg.fillRect(0, 0, w, 24);
    titleBg.lineStyle(1, NES.WHITE, 1);
    titleBg.strokeRect(0, 0, w, 24);
    titleBg.setDepth(900);
    titleBg.setScrollFactor(0);

    const titleText = this.scene.add.text(w / 2, 12, "EVOTOWN", {
      fontSize: "14px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    titleText.setDepth(901);
    titleText.setScrollFactor(0);

    // 字幕 HUD
    const subBg = this.scene.add.graphics();
    subBg.fillStyle(0x000000, 0.82);
    subBg.fillRect(0, h - 36, w, 36);
    subBg.lineStyle(2, 0xf97316, 1);
    subBg.strokeRect(0, h - 36, w, 36);
    subBg.setDepth(950).setScrollFactor(0);

    this.subtitleText = this.scene.add.text(w + 20, h - 18, "", {
      fontSize: "13px",
      color: "#fbbf24",
      fontStyle: "bold",
    }).setOrigin(0, 0.5).setDepth(951).setScrollFactor(0).setResolution(2);

    this.subtitleContainer = this.scene.add.container(0, 0, [subBg, this.subtitleText]);
    this.subtitleContainer.setDepth(950).setScrollFactor(0).setVisible(false);
  }

  pushSubtitle(text: string, level: string) {
    this.subtitleQueue.push({ text, level });
    if (!this.subtitlePlaying) this.playNextSubtitle();
  }

  private playNextSubtitle() {
    if (this.subtitleQueue.length === 0) {
      this.subtitlePlaying = false;
      this.subtitleContainer.setVisible(false);
      return;
    }
    this.subtitlePlaying = true;
    const { text, level } = this.subtitleQueue.shift()!;

    const colors: Record<string, string> = {
      last_stand: "#ff6666",
      elimination: "#ff4444",
      defection: "#ff9933",
      info: "#fbbf24",
    };
    const color = colors[level] ?? "#fbbf24";
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    this.subtitleContainer.setVisible(true);
    this.subtitleText
      .setText(text)
      .setColor(color)
      .setAlpha(1)
      .setX(w + 20);

    this.scene.tweens.add({
      targets: this.subtitleText,
      x: 12,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.scene.time.delayedCall(3500, () => {
          this.scene.tweens.add({
            targets: this.subtitleText,
            alpha: 0,
            x: -w,
            duration: 600,
            ease: "Cubic.easeIn",
            onComplete: () => {
              this.subtitleText.setX(w + 20).setAlpha(1);
              this.playNextSubtitle();
            },
          });
        });
      },
    });

    if (level === "elimination") {
      this.scene.cameras.main.flash(200, 80, 0, 0, false);
    } else if (level === "last_stand") {
      this.scene.cameras.main.flash(150, 60, 0, 0, false);
    }
    void h;
  }

  getWidth(): number {
    return this.scene.scale.width;
  }

  getHeight(): number {
    return this.scene.scale.height;
  }
}
