import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { getPhaserConfig } from "../phaser/config";

const GAME_HEIGHT = 560;

export function PhaserTownCanvas() {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    const config = getPhaserConfig(parentRef.current);
    const game = new Phaser.Game(config);
    gameRef.current = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-b from-slate-900 to-slate-950">
      <div
        id="phaser-town"
        ref={parentRef}
        className="flex-1 w-full relative"
        style={{ minHeight: GAME_HEIGHT }}
      />
    </div>
  );
}
