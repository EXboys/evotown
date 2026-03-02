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
    <div className="space-y-3">
      {feedback && (
        <p className="text-xs text-emerald-400 animate-pulse">{feedback}</p>
      )}
      <input
        value={taskInput}
        onChange={(e) => onTaskInputChange(e.target.value)}
        placeholder="输入任务描述..."
        className="w-full px-3 py-2.5 bg-slate-900/70 border border-evo-border/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-evo-accent/50 focus:border-evo-accent/50 transition-colors"
      />
      <div className="flex gap-2">
        <button
          onClick={onInject}
          disabled={!canAct || !taskInput.trim()}
          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-900/30"
        >
          注入任务
        </button>
        <button
          onClick={onEvolve}
          disabled={!canAct}
          className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all hover:shadow-lg hover:shadow-amber-900/30"
        >
          主动进化
        </button>
      </div>
    </div>
  );
}
