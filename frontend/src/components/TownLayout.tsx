import { useNavigate } from "react-router-dom";
import { PhaserTownCanvas } from "./PhaserTownCanvas";
import { EventTicker } from "./EventTicker";
import { useAgentSync } from "../hooks/useAgentSync";
import { useWebSocket } from "../hooks/useWebSocket";
import { useChronicleStore } from "../store/chronicleStore";

export function TownLayout() {
  useAgentSync();
  const { connected } = useWebSocket();
  const navigate = useNavigate();
  const latest = useChronicleStore((s) => s.latestPublished);
  const clear = useChronicleStore((s) => s.clearLatestPublished);

  return (
    <div className="flex-1 flex flex-col relative border-r border-slate-600/50 min-w-0">
      <PhaserTownCanvas />
      <EventTicker />
      {/* 史记入口按钮 — 悬浮在游戏画面右上角 */}
      <button
        onClick={() => navigate("/chronicle")}
        className="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-700/50 bg-[#13100a]/90 text-amber-400 text-xs font-medium hover:border-amber-500 hover:text-amber-300 hover:bg-[#1a1409]/95 transition-colors shadow-lg shadow-black/40 backdrop-blur-sm"
        title="查看三国·进化演绎战报"
      >
        📜 <span className="tracking-wider">进化演绎</span>
      </button>
      {!connected && (
        <div className="absolute bottom-10 left-3 px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs font-medium border border-amber-500/30">
          WS 未连接
        </div>
      )}
      {/* 战报新章通知 toast */}
      {latest && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-600/50 bg-[#13100a]/95 shadow-xl shadow-black/50 max-w-sm">
          <span className="text-lg">📜</span>
          <div className="flex-1 min-w-0">
            <div className="text-amber-300 text-xs font-bold tracking-wider mb-0.5">新章发布 · {latest.date}</div>
            <div className="text-amber-700 text-[11px] truncate">{latest.preview.slice(0, 40)}…</div>
          </div>
          <button
            onClick={() => { navigate(`/chronicle?date=${latest.date}`); clear(); }}
            className="text-[11px] px-2 py-1 rounded bg-amber-700/30 text-amber-400 hover:bg-amber-700/50 shrink-0 transition-colors"
          >
            阅览
          </button>
          <button onClick={clear} className="text-amber-800 hover:text-amber-600 text-sm leading-none transition-colors">✕</button>
        </div>
      )}
    </div>
  );
}
