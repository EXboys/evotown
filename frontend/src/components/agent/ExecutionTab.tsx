import { formatDateTimeShort } from "../../lib/datetime";

export interface ExecutionLogItem {
  ts: string | number;
  task: string;
  status: "refused" | "executed";
  refusal_reason?: string;
  task_completed?: boolean;
  total_tools?: number;
  failed_tools?: number;
  elapsed_ms?: number;
}

export function ExecutionList({ logs }: { logs: ExecutionLogItem[] }) {
  if (logs.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
        暂无任务记录
      </p>
    );
  }

  return (
    <ul className="space-y-1.5 font-mono text-xs">
      {logs.map((e, i) => (
        <li key={i} className="flex flex-wrap gap-2 py-1.5 px-2 rounded hover:bg-slate-800/40 items-baseline">
          <span className="text-slate-500 shrink-0 whitespace-nowrap">
            {typeof e.ts === "number"
              ? formatDateTimeShort(e.ts * 1000)
              : e.ts
                ? formatDateTimeShort(e.ts)
                : "-"}
          </span>
          <span className="truncate text-slate-300 min-w-0" title={e.task}>
            {e.task || "-"}
          </span>
          {e.status === "refused" ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-rose-900/50 text-rose-400 border border-rose-700/50">
              拒绝
            </span>
          ) : (
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                e.task_completed
                  ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/50"
                  : "bg-amber-900/50 text-amber-400 border border-amber-700/50"
              }`}
            >
              {e.task_completed ? "✓ 完成" : "○ 未完成"}
            </span>
          )}
          {e.status === "refused" && e.refusal_reason && (
            <span className="text-slate-500 text-[10px] truncate max-w-[180px]" title={e.refusal_reason}>
              {e.refusal_reason}
            </span>
          )}
          {e.status === "executed" && (e.total_tools != null || e.elapsed_ms != null) && (
            <span className="text-slate-500 text-[10px]">
              {e.total_tools != null && `🔧 ${e.total_tools}次`}
              {e.failed_tools != null && e.failed_tools > 0 && (
                <span className="text-amber-400"> 失败{e.failed_tools}</span>
              )}
              {e.elapsed_ms != null && ` ⏱ ${e.elapsed_ms}ms`}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ExecutionTab({ logs }: { logs: ExecutionLogItem[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">任务态度与执行（最近 30 条：拒绝 / 接收并执行）</p>
      <ExecutionList logs={logs} />
    </div>
  );
}
