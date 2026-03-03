import Phaser from "phaser";
import BootScene from "./BootScene";
import PreloadScene from "./PreloadScene";
import TownScene from "./TownScene";

export const getPhaserConfig = (parent: string | HTMLElement | null): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent: parent || undefined,
  width: 640,
  height: 448,
  backgroundColor: "#000000",
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [BootScene, PreloadScene, TownScene],
  scale: {
    mode: Phaser.Scale.ENVELOP,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 640,
    height: 448,
  },
  render: {
    pixelArt: true,
    roundPixels: true,
    antialias: false,
  },
});
