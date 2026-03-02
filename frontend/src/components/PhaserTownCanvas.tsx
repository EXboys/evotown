import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { getPhaserConfig } from "../phaser/config";

const GAME_HEIGHT = 448;

export function PhaserTownCanvas() {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    let rafId: number;
    let game: Phaser.Game | null = null;
    // 等待浏览器完成布局后再初始化 Phaser，确保父容器尺寸已计算
    rafId = requestAnimationFrame(() => {
      if (!parentRef.current) return;
      const config = getPhaserConfig(parentRef.current);
      game = new Phaser.Game(config);
      gameRef.current = game;
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (game) {
        game.destroy(true);
      } else if (gameRef.current) {
        gameRef.current.destroy(true);
      }
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950">
      <div
        id="phaser-town"
        ref={parentRef}
        className="flex-1 w-full overflow-hidden"
        style={{ minHeight: GAME_HEIGHT }}
      />
    </div>
  );
}
