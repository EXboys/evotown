import Phaser from "phaser";
import { NES } from "./nesColors";
import {
  drawOfficeFloorPlan,
  drawOfficePlants,
  createRoomMarkers,
} from "./officeFloorPlan";

export interface TerrainConfig {
  scene: Phaser.Scene;
  worldInner: Phaser.GameObjects.Container;
  worldContainer: Phaser.GameObjects.Container;
  width: number;
  height: number;
}

/** 室内单层 — 不做视差 */
const PARALLAX = 1;

/** 功能区执行中高亮 */
const ACTIVE_ROOM_OVERLAY = 0x38bdf8;

export class TerrainRenderer {
  private scene: Phaser.Scene;
  private worldInner: Phaser.GameObjects.Container;
  private buildingRects: Map<string, Phaser.GameObjects.Container> = new Map();
  private worldBack!: Phaser.GameObjects.Container;
  private worldMid!: Phaser.GameObjects.Container;
  private worldFront!: Phaser.GameObjects.Container;
  private activeBuildingKeys: Set<string> = new Set();
  private activePulseTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
  private swayTrees: Phaser.GameObjects.Image[] = [];

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

  setParallaxOffset(dx: number, dy: number) {
    const ox = -dx * (1 - PARALLAX);
    const oy = -dy * (1 - PARALLAX);
    this.worldBack.setPosition(ox, oy);
    this.worldMid.setPosition(ox, oy);
    this.worldFront.setPosition(ox, oy);
  }

  updateAmbient(time: number) {
    this.swayTrees.forEach((img, i) => {
      const sway = Math.sin(time * 0.002 + i * 1.2) * 0.04;
      img.setScale(0.85 + sway, 0.85);
    });
  }

  setActiveBuildings(activeKeys: Set<string>) {
    const prev = this.activeBuildingKeys;
    for (const key of prev) {
      if (!activeKeys.has(key)) this.clearBuildingActive(key);
    }
    for (const key of activeKeys) {
      if (!prev.has(key)) this.setBuildingActive(key);
    }
    this.activeBuildingKeys = new Set(activeKeys);
  }

  private setBuildingActive(key: string) {
    const container = this.buildingRects.get(key);
    if (!container) return;
    const c = container as Phaser.GameObjects.Container & {
      highlightZone?: Phaser.GameObjects.Graphics;
      zoneRect?: { w: number; h: number };
      activeOverlay?: Phaser.GameObjects.Graphics;
    };
    const zone = c.zoneRect;
    if (!zone) return;

    const overlay = this.scene.add.graphics();
    overlay.fillStyle(ACTIVE_ROOM_OVERLAY, 0.18);
    overlay.fillRect(-zone.w / 2, -zone.h / 2, zone.w, zone.h);
    overlay.lineStyle(1, ACTIVE_ROOM_OVERLAY, 0.55);
    overlay.strokeRect(-zone.w / 2, -zone.h / 2, zone.w, zone.h);
    container.addAt(overlay, 0);
    c.activeOverlay = overlay;

    const timer = this.scene.time.addEvent({
      delay: 600,
      loop: true,
      callback: () => {
        if (!this.activeBuildingKeys.has(key) || !c.activeOverlay) return;
        this.scene.tweens.add({
          targets: c.activeOverlay,
          alpha: { from: 1, to: 0.45 },
          duration: 500,
          yoyo: true,
        });
      },
    });
    this.activePulseTimers.set(key, timer);
  }

  private clearBuildingActive(key: string) {
    const container = this.buildingRects.get(key);
    if (!container) return;
    const c = container as Phaser.GameObjects.Container & { activeOverlay?: Phaser.GameObjects.Graphics };
    if (c.activeOverlay) {
      c.activeOverlay.destroy();
      c.activeOverlay = undefined;
    }
    const timer = this.activePulseTimers.get(key);
    if (timer) {
      timer.destroy();
      this.activePulseTimers.delete(key);
    }
  }

  private render(w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;

    this.worldBack = this.scene.add.container(0, 0);
    this.worldMid = this.scene.add.container(0, 0);
    this.worldFront = this.scene.add.container(0, 0);

    drawOfficeFloorPlan(this.scene, this.worldMid, cx, cy);
    drawOfficePlants(this.scene, this.worldMid, cx, cy).forEach((p) => this.swayTrees.push(p));

    this.buildingRects = createRoomMarkers(this.scene, cx, cy);
    this.buildingRects.forEach((container) => {
      this.worldFront.add(container);
    });

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
    const titleBg = this.scene.add.graphics();
    titleBg.fillStyle(NES.BLACK, 1);
    titleBg.fillRect(0, 0, w, 24);
    titleBg.lineStyle(1, NES.WHITE, 1);
    titleBg.strokeRect(0, 0, w, 24);
    titleBg.setDepth(900);
    titleBg.setScrollFactor(0);

    const titleText = this.scene.add.text(w / 2, 12, "协作楼层 · F1", {
      fontSize: "14px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    titleText.setDepth(901);
    titleText.setScrollFactor(0);

    const subBg = this.scene.add.graphics();
    subBg.fillStyle(0x000000, 0.82);
    subBg.fillRect(0, h - 36, w, 36);
    subBg.lineStyle(2, 0x38bdf8, 1);
    subBg.strokeRect(0, h - 36, w, 36);
    subBg.setDepth(950).setScrollFactor(0);

    this.subtitleText = this.scene.add.text(w + 20, h - 18, "", {
      fontSize: "13px",
      color: "#7dd3fc",
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
      last_stand: "#f87171",
      elimination: "#ef4444",
      defection: "#fb923c",
      info: "#7dd3fc",
    };
    const color = colors[level] ?? "#7dd3fc";
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
