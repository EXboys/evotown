import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEvotownStore } from "../store/evotownStore";
import type { JudgeScore } from "../store/evotownStore";

type TaskHistoryItem = {
  outcome?: "claimed" | "dropped" | "refused";
  agent_id?: string;
  claimed_by?: string;
  task: string;
  difficulty: string;
  success?: boolean;
  elapsed_ms?: number;
  refusal_count?: number;
  refusal_reason?: string;
  ts?: number;
  judge?: JudgeScore;
};

type TaskDetail = {
  agent_id: string;
  task: string;
  transcript: Array<{ type?: string; role?: string; content?: string; tool_calls?: unknown }>;
  decision?: { total_tools?: number; failed_tools?: number; tools_detail?: string; task_description?: string };
  task_history?: { judge?: JudgeScore; elapsed_ms?: number; success?: boolean };
};

const DIFFICULTY_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };

export function TaskHistoryPage() {
  const navigate = useNavigate();
  const agents = useEvotownStore((s) => s.agents);
  const agentNameMap = Object.fromEntries(agents.map((a) => [a.id, a.display_name || a.id]));

  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<TaskHistoryItem | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadHistory = () => {
    setLoading(true);
    fetch("/monitor/task_history?limit=200")
      .then((r) => r.json())
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadHistory(); }, []);

  const openDetail = (h: TaskHistoryItem) => {
    const agentId = h.claimed_by ?? h.agent_id;
    if (!agentId || !h.task) return;
    setSelectedItem(h);
    setDetailLoading(true);
    const params = new URLSearchParams();
    params.set("agent_id", agentId);
    params.set("task", h.task);
    if (h.ts != null) params.set("ts", String(h.ts));
    fetch(`/monitor/task_detail?${params}`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setDetail(data as TaskDetail); })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  };

  const reversed = [...history].reverse();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/arena")} className="text-slate-400 hover:text-white text-sm">← 返回竞技场</button>
          <h1 className="text-base font-bold text-slate-200">📋 任务历史</h1>
          <span className="text-xs text-slate-500">({history.length})</span>
        </div>
        <button onClick={loadHistory} disabled={loading} className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50">
          {loading ? "加载中..." : "刷新"}
        </button>
      </nav>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Task List */}
        <div className="w-[380px] shrink-0 border-r border-slate-800 overflow-y-auto">
          {reversed.map((h, i) => {
            const isDropped = h.outcome === "dropped" || (!h.agent_id && !h.claimed_by && h.refusal_count != null && h.outcome !== "refused");
            const isRefused = h.outcome === "refused";
            const claimant = h.claimed_by ?? h.agent_id;
            const isSelected = selectedItem === h;
            const canClick = !!(claimant && h.task && !isDropped);
            return (
              <div
                key={i}
                onClick={() => canClick && openDetail(h)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs border-b border-slate-800/50 transition-colors ${
                  isSelected ? "bg-slate-800" : canClick ? "hover:bg-slate-900/80 cursor-pointer" : ""
                }`}
              >
                <span className={`w-5 text-center shrink-0 ${h.success ? "text-emerald-500" : isRefused ? "text-amber-500" : isDropped ? "text-slate-600" : "text-red-500"}`}>
                  {isRefused ? "⊘" : isDropped ? "—" : h.success ? "✓" : "✗"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-300 truncate" title={h.task}>{h.task}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                    {claimant && <span className="font-mono">{agentNameMap[claimant] || claimant}</span>}
                    <span className="px-1 py-0.5 rounded bg-slate-700/50">{DIFFICULTY_LABELS[h.difficulty] ?? h.difficulty}</span>
                    {h.refusal_count != null && h.refusal_count > 0 && <span>拒{h.refusal_count}</span>}
                    {h.ts && <span>{new Date(h.ts * 1000).toLocaleString("zh-CN")}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {history.length === 0 && !loading && (
            <p className="text-sm text-slate-500 italic text-center py-8">暂无任务历史</p>
          )}
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedItem && <p className="text-slate-500 text-sm text-center mt-20">← 点击左侧任务查看执行明细</p>}
          {detailLoading && <p className="text-slate-400 text-sm text-center mt-20">加载执行详情...</p>}
          {detail && !detailLoading && <TaskDetailPanel detail={detail} agentNameMap={agentNameMap} />}
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = value >= 7 ? "bg-emerald-500" : value >= 4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-slate-300 font-mono">{value}</span>
    </div>
  );
}

function TaskDetailPanel({ detail, agentNameMap }: { detail: TaskDetail; agentNameMap: Record<string, string> }) {
  const toolsDetail = detail.decision?.tools_detail
    ? (() => { try { return JSON.parse(detail.decision!.tools_detail!) as { tool?: string; success?: boolean }[]; } catch { return []; } })()
    : [];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Task Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-200 leading-relaxed">{detail.task}</h2>
        <p className="text-xs text-slate-500 mt-1 font-mono">Agent: {agentNameMap[detail.agent_id] || detail.agent_id}</p>
      </div>

      {/* Judge Score */}
      {detail.task_history?.judge && (
        <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">裁判评分</h3>
            <span className={`text-sm font-bold px-3 py-1 rounded-lg ${
              detail.task_history.judge.reward > 0
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                : "bg-red-500/25 text-red-300 border border-red-500/40"
            }`}>
              {detail.task_history.judge.reward > 0 ? "+" : ""}{detail.task_history.judge.reward} 分
            </span>
          </div>
          <div className="space-y-2">
            <ScoreBar label="完成度" value={detail.task_history.judge.completion} />
            <ScoreBar label="质量" value={detail.task_history.judge.quality} />
            <ScoreBar label="效率" value={detail.task_history.judge.efficiency} />
          </div>
          {detail.task_history.judge.reason && (
            <p className="text-xs text-slate-500 leading-relaxed">{detail.task_history.judge.reason}</p>
          )}
          {detail.task_history.elapsed_ms != null && (
            <p className="text-xs text-slate-500">耗时 {detail.task_history.elapsed_ms}ms</p>
          )}
        </div>
      )}

      {/* Tool Calls */}
      {toolsDetail.length > 0 && (
        <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-slate-300">工具调用 ({toolsDetail.length})</h3>
          <ul className="space-y-1.5 font-mono text-xs">
            {toolsDetail.map((t, j) => (
              <li key={j} className="flex items-center gap-2 py-1 px-2 rounded bg-slate-800/50">
                <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] shrink-0 ${
                  t.success ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                }`}>
                  {t.success ? "✓" : "✗"}
                </span>
                <span className="text-slate-300">{t.tool ?? "?"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-300">执行日志 (Transcript)</h3>
        {detail.transcript.length === 0 ? (
          <p className="text-xs text-slate-500 italic">无 transcript 记录</p>
        ) : (
          <div className="space-y-3 font-mono text-xs">
            {detail.transcript.map((e, j) => {
              const role = e.role ?? e.type;
              const content = e.content ?? "";
              const toolCalls = e.tool_calls;
              if (role === "user") {
                return (
                  <div key={j} className="p-3 rounded-lg bg-blue-900/20 border border-blue-700/30">
                    <span className="text-blue-400 text-[10px] font-semibold uppercase">用户</span>
                    <pre className="mt-1.5 whitespace-pre-wrap break-words text-slate-300 text-xs">{content || "(空)"}</pre>
                  </div>
                );
              }
              if (role === "assistant") {
                return (
                  <div key={j} className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/30">
                    <span className="text-emerald-400 text-[10px] font-semibold uppercase">助手</span>
                    {toolCalls != null && (
                      <pre className="mt-1.5 text-amber-400/90 text-[10px] whitespace-pre-wrap break-words">
                        {typeof toolCalls === "string" ? toolCalls : JSON.stringify(toolCalls, null, 2)}
                      </pre>
                    )}
                    <pre className="mt-1.5 whitespace-pre-wrap break-words text-slate-300 text-xs">{content || "(空)"}</pre>
                  </div>
                );
              }
              return (
                <div key={j} className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
                  <pre className="whitespace-pre-wrap break-words text-slate-400 text-xs">{JSON.stringify(e, null, 2)}</pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

