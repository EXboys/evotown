import { PhaserTownCanvas } from "./PhaserTownCanvas";
import { useWebSocket } from "../hooks/useWebSocket";

export function TownLayout() {
  const { connected } = useWebSocket();
  return (
    <div className="flex-1 flex flex-col relative border-r border-slate-600/50">
      <PhaserTownCanvas />
      {!connected && (
        <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs font-medium border border-amber-500/30">
          WS 未连接
        </div>
      )}
    </div>
  );
}
