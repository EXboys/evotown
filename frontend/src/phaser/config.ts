import Phaser from "phaser";
import TownScene from "./TownScene";

export const getPhaserConfig = (parent: string | HTMLElement | null): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent: parent || undefined,
  width: 640,
  height: 448,
  backgroundColor: "#0f172a",
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [TownScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 640,
    height: 448,
  },
});
