import Phaser from "phaser";

/** 启动场景 — 初始化，立即进入 PreloadScene */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  create() {
    this.scene.start("PreloadScene");
  }
}
