import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";

type Agent = {
  agent_id: string;
  name: string;
  status: "active" | "archived";
};

type TaskNode = {
  node_id: string;
  agent_id: string;
  source_type: "dispatch_job" | "hosted_run";
  source_id: string;
  title: string;
  message: string;
  board_status: "queued" | "running" | "done" | "failed";
  source_status: string;
  depends_on_node_id?: string;
  run_id?: string;
  dispatch_job_id?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
};

type BoardColumns = Record<TaskNode["board_status"], TaskNode[]>;

type BoardResponse = {
  agent_id: string;
  columns: BoardColumns;
  total: number;
  board_statuses: TaskNode["board_status"][];
};

const COLUMN_META: Record<
  TaskNode["board_status"],
  { label: string; hint: string; headerClass: string; countClass: string }
> = {
  queued: {
    label: "排队中",
    hint: "Queued",
    headerClass: "border-amber-200 bg-amber-50 text-amber-900",
    countClass: "bg-amber-100 text-amber-800",
  },
  running: {
    label: "执行中",
    hint: "Running",
    headerClass: "border-blue-200 bg-blue-50 text-blue-900",
    countClass: "bg-blue-100 text-blue-800",
  },
  done: {
    label: "已完成",
    hint: "Done",
    headerClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
    countClass: "bg-emerald-100 text-emerald-800",
  },
  failed: {
    label: "失败",
    hint: "Failed",
    headerClass: "border-red-200 bg-red-50 text-red-900",
    countClass: "bg-red-100 text-red-800",
  },
};

const SOURCE_LABEL: Record<TaskNode["source_type"], string> = {
  dispatch_job: "派活",
  hosted_run: "托管运行",
};

function TaskCard({ node }: { node: TaskNode }) {
  const title = node.title?.trim() || node.message.slice(0, 80) || node.source_id;
  const subtitle = node.title?.trim() ? node.message.slice(0, 120) : "";
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{title}</div>
          {subtitle && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
          {SOURCE_LABEL[node.source_type]}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="font-mono">{node.source_id.slice(0, 14)}…</span>
        {node.run_id && (
          <Link to={`/agent/agents/${node.agent_id}`} className="text-blue-600 hover:underline">
            run
          </Link>
        )}
        {node.depends_on_node_id && <span>依赖上一节点</span>}
      </div>
      {node.created_at && (
        <div className="mt-2 text-[11px] text-slate-400">{formatDateTimeShort(node.created_at)}</div>
      )}
    </article>
  );
}

export function TaskBoardPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAgents = useCallback(async () => {
    const res = await adminFetch("/api/v1/agents?limit=200");
    if (!res.ok) return;
    const data = (await res.json()) as { agents?: Agent[] };
    const active = (data.agents || []).filter((a) => a.status === "active");
    setAgents(active);
    if (!agentId && active.length) {
      setAgentId(active[0].agent_id);
    }
  }, [agentId]);

  const loadBoard = useCallback(async (selectedAgentId: string) => {
    setLoading(true);
    setError("");
    const query = selectedAgentId ? `?agent_id=${encodeURIComponent(selectedAgentId)}` : "";
    const res = await adminFetch(`/api/v1/task-board${query}`);
    if (!res.ok) {
      setError(`加载看板失败 (${res.status})`);
      setBoard(null);
      setLoading(false);
      return;
    }
    setBoard((await res.json()) as BoardResponse);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    void loadBoard(agentId);
  }, [agentId, loadBoard]);

  const columns = useMemo(() => {
    const empty: BoardColumns = { queued: [], running: [], done: [], failed: [] };
    return board?.columns ?? empty;
  }, [board]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Task Board</div>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">任务看板</h2>
          <p className="mt-1 text-sm text-slate-500">统一展示派活任务与托管 Agent 运行，按 agent 隔离。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">全部 agent</option>
            {agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadBoard(agentId)}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            刷新
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
          加载中…
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-500">共 {board?.total ?? 0} 个节点</div>
          <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
            {(Object.keys(COLUMN_META) as TaskNode["board_status"][]).map((status) => {
              const meta = COLUMN_META[status];
              const items = columns[status] || [];
              return (
                <section key={status} className="flex min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-slate-50/70">
                  <header className={`flex items-center justify-between border-b px-4 py-3 ${meta.headerClass}`}>
                    <div>
                      <div className="text-sm font-semibold">{meta.label}</div>
                      <div className="text-xs opacity-70">{meta.hint}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.countClass}`}>
                      {items.length}
                    </span>
                  </header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 p-6 text-center text-xs text-slate-400">
                        暂无任务
                      </div>
                    ) : (
                      items.map((node) => <TaskCard key={node.node_id} node={node} />)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
