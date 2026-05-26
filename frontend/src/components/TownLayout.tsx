import { useNavigate } from "react-router-dom";
import { PhaserTownCanvas } from "./PhaserTownCanvas";
import { ScanlineOverlay } from "./ScanlineOverlay";
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
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        <PhaserTownCanvas />
        <ScanlineOverlay />
      </div>
      <EventTicker />

      {/* 地图图例 */}
      <div className="absolute left-3 bottom-20 z-40 rounded-xl border border-slate-600/35 bg-slate-950/78 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur-md">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Legend</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-slate-300">
          <LegendItem color="bg-emerald-400" label="运行中" />
          <LegendItem color="bg-sky-400" label="团队协作" />
          <LegendItem color="bg-violet-400" label="技能沉淀" />
          <LegendItem color="bg-rose-400" label="风险/暂停" />
        </div>
      </div>

      {/* 地图快捷导航 — 右上角 */}
      <div className="absolute top-3 right-3 z-40 flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600/50 bg-slate-950/86 px-3 py-1.5 text-xs font-medium text-slate-300 shadow-lg shadow-black/40 backdrop-blur-sm transition-colors hover:border-slate-400 hover:text-white"
          title="返回平台首页"
        >
          ⌂ <span className="tracking-wider">首页</span>
        </button>
        <button
          type="button"
          onClick={() => navigate("/chronicle")}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600/50 bg-slate-950/86 px-3 py-1.5 text-xs font-medium text-slate-300 shadow-lg shadow-black/40 backdrop-blur-sm transition-colors hover:border-sky-500/70 hover:text-sky-200"
          title="查看组织学习日志"
        >
          📜 <span className="tracking-wider">组织日志</span>
        </button>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-1.5 rounded-lg border border-cyan-700/50 bg-[#071318]/90 px-3 py-1.5 text-xs font-medium text-cyan-300 shadow-lg shadow-black/40 backdrop-blur-sm transition-colors hover:border-cyan-400 hover:text-cyan-100 hover:bg-[#0a1b23]/95"
          title="企业管理后台"
        >
          ◆ <span className="tracking-wider">控制台</span>
        </button>
      </div>
      {!connected && (
        <div className="absolute bottom-10 left-3 px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs font-medium border border-amber-500/30">
          WS 未连接
        </div>
      )}
      {/* 组织日志新篇通知 */}
      {latest && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-sky-600/50 bg-slate-950/95 shadow-xl shadow-black/50 max-w-sm">
          <span className="text-lg">📋</span>
          <div className="flex-1 min-w-0">
            <div className="text-sky-200 text-xs font-bold tracking-wider mb-0.5">新日志 · {latest.date}</div>
            <div className="text-slate-400 text-[11px] truncate">{latest.preview.slice(0, 40)}…</div>
          </div>
          <button
            onClick={() => { navigate(`/chronicle?date=${latest.date}`); clear(); }}
            className="text-[11px] px-2 py-1 rounded bg-sky-700/30 text-sky-300 hover:bg-sky-700/50 shrink-0 transition-colors"
          >
            查看
          </button>
          <button onClick={clear} className="text-slate-500 hover:text-slate-300 text-sm leading-none transition-colors">✕</button>
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
