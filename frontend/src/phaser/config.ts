import Phaser from "phaser";
import TownScene from "./TownScene";

export const getPhaserConfig = (parent: string | HTMLElement | null): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent: parent || undefined,
  width: 800,
  height: 560,
  backgroundColor: "#1a1a2e",
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [TownScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
