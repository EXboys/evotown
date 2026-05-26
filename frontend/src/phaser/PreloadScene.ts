import Phaser from "phaser";
import { registerSceneTextures } from "./sceneAssets";
import { registerCharacterTextures } from "./characterAssets";
import { NES } from "./nesColors";

/** 预加载场景 — 注册程序化纹理，NES 风格加载条 */
export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    registerSceneTextures(this);
    registerCharacterTextures(this);

    // NES 风格加载框 — 黑底白边，无圆角
    const boxW = 200;
    const boxH = 24;
    const g = this.add.graphics();
    g.fillStyle(NES.BLACK, 1);
    g.fillRect((w - boxW) / 2 - 2, (h - boxH) / 2 - 2, boxW + 4, boxH + 4);
    g.lineStyle(2, NES.WHITE, 1);
    g.strokeRect((w - boxW) / 2 - 2, (h - boxH) / 2 - 2, boxW + 4, boxH + 4);

    const barBg = this.add.graphics();
    barBg.fillStyle(0x1a1512, 1);
    barBg.fillRect((w - boxW) / 2, (h - boxH) / 2, boxW, boxH);

    const barFill = this.add.graphics();

    const txt = this.add.text(w / 2, h / 2 - 24, "LOADING...", {
      fontSize: "14px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 400,
      ease: "Stepped",
      onUpdate: (tween) => {
        const v = tween.getValue() ?? 0;
        barFill.clear();
        barFill.fillStyle(NES.GRASS_BASE, 1);
        barFill.fillRect((w - boxW) / 2, (h - boxH) / 2, boxW * v, boxH);
      },
      onComplete: () => {
        txt.setText("READY");
        this.time.delayedCall(150, () => this.scene.start("TownScene"));
      },
    });
  }
}
