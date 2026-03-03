interface TaskInjectorBarProps {
  agents: { id: string; balance: number }[];
  taskInput: string;
  onTaskInputChange: (v: string) => void;
  onInject: () => void;
  onEvolve: () => void;
  feedback?: string;
}

export function TaskInjectorBar({ agents, taskInput, onTaskInputChange, onInject, onEvolve, feedback }: TaskInjectorBarProps) {
  const canAct = agents.length > 0;
  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-800/40 bg-gradient-to-b from-amber-950/40 via-stone-900/60 to-amber-950/30 shadow-[inset_0_1px_0_rgba(251,191,36,0.08),0_4px_12px_-2px_rgba(0,0,0,0.4)]">
      {/* 卷轴装饰线 */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-600/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-700/30 to-transparent" />
      <div className="p-4 space-y-3">
        {/* 任务卷轴标题 */}
        <div className="flex items-center gap-2">
          <span className="text-amber-500/90 text-lg" aria-hidden>📜</span>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-amber-200/80">
            任务卷轴
          </h4>
        </div>
        {feedback && (
          <p className="text-xs text-emerald-400 animate-pulse flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {feedback}
          </p>
        )}
        <div className="relative">
          <textarea
            value={taskInput}
            onChange={(e) => onTaskInputChange(e.target.value)}
            placeholder="在此书写你的任务，如：帮我总结这份文档的要点..."
            rows={2}
            className="w-full px-3.5 py-2.5 bg-slate-900/50 border border-amber-900/50 rounded-lg text-sm text-slate-200 placeholder-slate-500/80 focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-600/50 transition-all resize-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={onInject}
            disabled={!canAct || !taskInput.trim()}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-b from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-amber-50 shadow-lg shadow-amber-900/40 hover:shadow-amber-800/50 border border-amber-500/30"
          >
            <span aria-hidden>⚡</span>
            注入任务
          </button>
          <button
            onClick={onEvolve}
            disabled={!canAct}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-b from-violet-700 to-violet-800 hover:from-violet-600 hover:to-violet-700 text-violet-100 shadow-lg shadow-violet-900/40 hover:shadow-violet-800/50 border border-violet-500/30"
          >
            <span aria-hidden>✨</span>
            主动进化
          </button>
        </div>
      </div>
    </div>
  );
}
