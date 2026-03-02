import { useEffect, useState } from "react";
import { useEvotownStore } from "../store/evotownStore";
import type { JudgeScore } from "../store/evotownStore";

function ScoreBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = value >= 7 ? "bg-emerald-500" : value >= 4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-5 text-right text-slate-300 font-mono">{value}</span>
    </div>
  );
}

function JudgeCard({ judge, agentId, success }: { judge: JudgeScore; agentId: string; success: boolean }) {
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      success ? "border-emerald-600/40 bg-emerald-950/20" : "border-red-600/40 bg-red-950/20"
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-slate-400">{agentId}</span>
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
          judge.reward > 0 ? "bg-emerald-600/30 text-emerald-300" : 
          judge.reward === 0 ? "bg-slate-600/30 text-slate-300" :
          "bg-red-600/30 text-red-300"
        }`}>
          {judge.reward > 0 ? "+" : ""}{judge.reward}
        </span>
      </div>
      <ScoreBar label="完成度" value={judge.completion} />
      <ScoreBar label="质量" value={judge.quality} />
      <ScoreBar label="效率" value={judge.efficiency} />
      {judge.reason && (
        <p className="text-[10px] text-slate-500 leading-relaxed">{judge.reason}</p>
      )}
    </div>
  );
}

export function ArenaControl() {
  const taskRecords = useEvotownStore((s) => s.taskRecords);
  const dispatcherState = useEvotownStore((s) => s.dispatcherState);
  const setDispatcherState = useEvotownStore((s) => s.setDispatcherState);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/dispatcher/status")
      .then((r) => r.json())
      .then((d) => setDispatcherState(d))
      .catch(() => {});
  }, [setDispatcherState]);

  const toggleDispatcher = async () => {
    setLoading(true);
    try {
      const endpoint = dispatcherState.running ? "/dispatcher/stop" : "/dispatcher/start";
      const res = await fetch(endpoint, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDispatcherState({ running: !dispatcherState.running, ...data });
      }
    } finally {
      setLoading(false);
    }
  };

  const generateTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch("/dispatcher/generate", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDispatcherState({ pool_size: data.pool_size });
      }
    } finally {
      setLoading(false);
    }
  };

  const recentRecords = taskRecords.slice(-10).reverse();

  return (
    <div className="space-y-4">
      {/* Dispatcher Control */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          任务分发器
        </h3>
        <div className="rounded-lg bg-slate-900/50 border border-slate-600/50 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dispatcherState.running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
              <span className="text-xs text-slate-300">
                {dispatcherState.running ? "运行中" : "已停止"}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">
              任务池: {dispatcherState.pool_size}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={toggleDispatcher}
              disabled={loading}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
                dispatcherState.running
                  ? "bg-red-600/80 hover:bg-red-500 text-white"
                  : "bg-emerald-600/80 hover:bg-emerald-500 text-white"
              }`}
            >
              {dispatcherState.running ? "停止分发" : "启动分发"}
            </button>
            <button
              onClick={generateTasks}
              disabled={loading}
              className="flex-1 py-2 bg-slate-700/80 hover:bg-slate-600 rounded-lg text-xs font-medium text-slate-200 transition-all disabled:opacity-40"
            >
              生成任务
            </button>
          </div>
        </div>
      </section>

      {/* Judge Records */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          裁判评分 <span className="text-slate-600">({taskRecords.length})</span>
        </h3>
        {recentRecords.length === 0 ? (
          <p className="text-xs text-slate-500 italic">暂无评分记录</p>
        ) : (
          <div className="space-y-2">
            {recentRecords.map((r, i) => (
              r.judge ? (
                <JudgeCard key={i} judge={r.judge} agentId={r.agent_id} success={r.success} />
              ) : (
                <div key={i} className="rounded-lg border border-slate-600/40 bg-slate-900/30 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">{r.agent_id}</span>
                    <span className={`text-xs ${r.success ? "text-emerald-400" : "text-red-400"}`}>
                      {r.success ? "PASS" : "FAIL"}
                    </span>
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </section>

      {/* Arena Stats */}
      <ArenaStats />
    </div>
  );
}

function ArenaStats() {
  const [stats, setStats] = useState<{
    active_tasks: number;
    total_completed: number;
    success_count: number;
    fail_count: number;
    success_rate: number;
    avg_elapsed_ms: number;
  } | null>(null);

  useEffect(() => {
    const refresh = () => {
      fetch("/monitor/stats")
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">竞技场统计</h3>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "进行中", value: stats.active_tasks, color: "text-blue-400" },
          { label: "已完成", value: stats.total_completed, color: "text-slate-300" },
          { label: "成功率", value: `${(stats.success_rate * 100).toFixed(0)}%`, color: "text-emerald-400" },
          { label: "平均耗时", value: `${(stats.avg_elapsed_ms / 1000).toFixed(1)}s`, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-slate-900/50 border border-slate-600/30 p-2 text-center">
            <p className="text-[10px] text-slate-500">{s.label}</p>
            <p className={`text-sm font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
