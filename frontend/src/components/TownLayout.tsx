import { useNavigate } from "react-router-dom";
import { PhaserTownCanvas } from "./PhaserTownCanvas";
import { ScanlineOverlay } from "./ScanlineOverlay";
import { EventTicker } from "./EventTicker";
import { useAgentSync } from "../hooks/useAgentSync";
import { useWebSocket } from "../hooks/useWebSocket";
import { useChronicleStore } from "../store/chronicleStore";
import { useEvotownStore } from "../store/evotownStore";

export function TownLayout() {
  useAgentSync();
  const { connected } = useWebSocket();
  const navigate = useNavigate();
  const latest = useChronicleStore((s) => s.latestPublished);
  const clear = useChronicleStore((s) => s.clearLatestPublished);
  const agents = useEvotownStore((s) => s.agents);
  const availableTasks = useEvotownStore((s) => s.availableTasks);
  const evolutionEvents = useEvotownStore((s) => s.evolutionEvents);
  const taskRecords = useEvotownStore((s) => s.taskRecords);

  const activeAgents = agents.filter((a) => a.in_task).length;
  const skillSignals = evolutionEvents.filter((e) =>
    ["skill_generated", "skill_pending", "skill_confirmed", "skill_refined"].includes(e.event_type ?? e.type)
  ).length;
  const riskSignals =
    agents.filter((a) => a.status === "bankrupt").length +
    taskRecords.filter((r) => !r.success).slice(-10).length;

  return (
    <div className="flex-1 flex flex-col relative border-r border-slate-600/50 min-w-0">
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        <PhaserTownCanvas />
        <ScanlineOverlay />
      </div>
      <EventTicker />

      {/* 企业运行地图定位条 */}
      <div className="absolute top-3 left-3 z-40 max-w-[min(640px,calc(100%-190px))] rounded-xl border border-sky-500/25 bg-slate-950/82 px-3.5 py-2.5 shadow-xl shadow-black/35 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-sky-100">企业 Agent 协作地图</div>
            <div className="text-[10px] text-slate-500">实时观测任务、技能沉淀、协作关系与风险韧性</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <StatusPill label="Agent" value={`${activeAgents}/${agents.length}`} tone="sky" />
            <StatusPill label="任务池" value={availableTasks.length} tone="blue" />
            <StatusPill label="技能线索" value={skillSignals} tone="violet" />
            <StatusPill label="风险" value={riskSignals} tone={riskSignals > 0 ? "rose" : "emerald"} />
          </div>
        </div>
      </div>

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

      {/* 组织日志入口按钮 — 悬浮在地图右上角 */}
      <button
        onClick={() => navigate("/chronicle")}
        className="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600/50 bg-slate-950/86 text-slate-300 text-xs font-medium hover:border-amber-500/70 hover:text-amber-200 transition-colors shadow-lg shadow-black/40 backdrop-blur-sm"
        title="查看组织学习日志"
      >
        📜 <span className="tracking-wider">组织日志</span>
      </button>
      <button
        onClick={() => navigate("/dashboard")}
        className="absolute top-14 right-3 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-700/50 bg-[#071318]/90 text-cyan-300 text-xs font-medium hover:border-cyan-400 hover:text-cyan-100 hover:bg-[#0a1b23]/95 transition-colors shadow-lg shadow-black/40 backdrop-blur-sm"
        title="查看外部引擎与 run 上报"
      >
        ◆ <span className="tracking-wider">控制台</span>
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

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "sky" | "blue" | "violet" | "emerald" | "rose";
}) {
  const tones = {
    sky: "border-sky-500/25 bg-sky-500/10 text-sky-200",
    blue: "border-blue-500/25 bg-blue-500/10 text-blue-200",
    violet: "border-violet-500/25 bg-violet-500/10 text-violet-200",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${tones[tone]}`}>
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </span>
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
