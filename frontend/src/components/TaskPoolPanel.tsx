import { useEffect, useRef, useState, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import { useLocale } from "../lib/i18n";
import { formatDateTimeShort } from "../lib/datetime";

// ── Types ──────────────────────────────────────────────────────────

type TaskStatus =
  | "pending" | "pre_review" | "approved" | "in_progress" | "completed" | "failed" | "rejected";

type TaskRecord = {
  id: string;
  title: string;
  description: string;
  submitter_type: string;
  submitter_id: string;
  source: string;
  status: TaskStatus;
  priority: number;
  tags: string[];
  requirement: string;
  plan: string;
  result: string;
  target_agent_id: string | null;
  assignee_type: string | null;
  assignee_id: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskTab = "all" | "pending" | "pre_review" | "approved" | "in_progress" | "completed" | "failed" | "rejected";

const STATUS_META: Record<TaskStatus, { labelZh: string; labelEn: string; className: string }> = {
  pending:      { labelZh: "待评估",   labelEn: "Pending",     className: "border-amber-200 bg-amber-50 text-amber-700" },
  pre_review:   { labelZh: "待确认",   labelEn: "Pre-Review",  className: "border-sky-200 bg-sky-50 text-sky-700" },
  approved:     { labelZh: "待执行",   labelEn: "Approved",    className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  in_progress:  { labelZh: "执行中",   labelEn: "In Progress", className: "border-violet-200 bg-violet-50 text-violet-700" },
  completed:    { labelZh: "执行成功", labelEn: "Completed",   className: "border-slate-200 bg-slate-100 text-slate-600" },
  failed:       { labelZh: "执行失败", labelEn: "Failed",      className: "border-red-200 bg-red-50 text-red-700" },
  rejected:     { labelZh: "已拒绝",   labelEn: "Rejected",    className: "border-red-200 bg-red-50 text-red-700" },
};

const SOURCE_LABELS: Record<string, string> = { portal: "门户", mcp: "MCP", admin: "管理后台" };
const SUBMITTER_LABELS: Record<string, string> = { employee: "员工", agent: "Agent" };

function renderSubmitter(task: TaskRecord) {
  if (task.submitter_type === "admin") {
    return task.submitter_id === "admin" ? "管理员" : (task.submitter_id || "管理员");
  }
  if (task.submitter_type === "hermes") {
    return "Hermes (sysadmin)";
  }
  if (task.submitter_type === "employee") {
    return task.submitter_id || "员工";
  }
  return task.submitter_type || "—";
}

// ── Shared helpers ──────────────────────────────────────────────────

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-medium uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div><div className="mt-0.5 text-xs text-slate-400">{note}</div></div>;
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

// ── Component ──────────────────────────────────────────────────────

export function TaskPoolPanel({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
  const { locale } = useLocale();

  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<TaskTab>("all");
  const [filters, setFilters] = useState({ query: "", source: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const initialLoadDone = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  // Detail drawer
  const [detail, setDetail] = useState<TaskRecord | null>(null);
  const [expandText, setExpandText] = useState("");

  // Confirm modal (pre_review → approved)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState("");
  const [confirmTaskId, setConfirmTaskId] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Return modal (pre_review → pending)
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnTitle, setReturnTitle] = useState("");
  const [returnDesc, setReturnDesc] = useState("");
  const [returnTaskId, setReturnTaskId] = useState("");
  const [returning, setReturning] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTargetAgent, setNewTargetAgent] = useState("");
  const [newPriority, setNewPriority] = useState(0);
  const [creating, setCreating] = useState(false);
  const [agentList, setAgentList] = useState<Array<{ agent_id: string; name: string }>>([]);

  const loadTasks = () => {
    const isInitial = !initialLoadDone.current;

    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError("");
    const params = new URLSearchParams();
    if (tab !== "all") params.set("status", tab);
    params.set("limit", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));

    adminFetch(`/api/v1/tasks?${params}`)
      .then((r) => r.ok ? r.json() as Promise<{ tasks: TaskRecord[]; total: number }> : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { setTasks(d.tasks || []); setTotal(d.total || 0); initialLoadDone.current = true; })
      .catch((err) => setError(err.message || "加载失败"))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => { setPage(1); }, [tab]);
  useEffect(() => { loadTasks(); }, [tab, page, pageSize]);

  // Respond to global refresh triggered from parent EnterpriseConsole
  const loadOnce = useRef(false);
  useEffect(() => {
    if (loadOnce.current) {
      loadTasks();
    } else {
      loadOnce.current = true;
    }
  }, [refreshTrigger]);

  // Counts — total from API for "all", page-level for per-status breakdown
  const counts: Record<TaskTab, number> = { all: total, pending: 0, pre_review: 0, approved: 0, in_progress: 0, completed: 0, failed: 0, rejected: 0 };
  tasks.forEach((t) => { const k = t.status as keyof typeof counts; if (k in counts) counts[k]++; });

  // Filter tasks client-side by query/source (status already filtered by API)
  const filtered = tasks.filter((t) => {
    if (filters.query && !t.title.includes(filters.query) && !t.description.includes(filters.query) && !t.id.includes(filters.query)) return false;
    if (filters.source && t.source !== filters.source) return false;
    return true;
  });

  // ── Detail drawer handlers ──
  const openDetail = (task: TaskRecord) => {
    setDetail(task);
  };

  const statusLabel = (s: TaskStatus) => locale === "zh" ? STATUS_META[s].labelZh : STATUS_META[s].labelEn;

  // ── Confirm: pre_review → approved ──
  const openConfirm = (task: TaskRecord) => {
    setConfirmTaskId(task.id);
    setConfirmPlan(task.plan || "");
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const res = await adminFetch(`/api/v1/tasks/${confirmTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", plan: confirmPlan }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmOpen(false);
      setMessage("任务已确认，状态更新为待执行");
      setTimeout(() => setMessage(""), 3000);
      loadTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setConfirming(false);
    }
  };

  // ── Return: pre_review → pending ──
  const openReturn = (task: TaskRecord) => {
    setReturnTaskId(task.id);
    setReturnTitle(task.title);
    setReturnDesc(task.description);
    setReturnOpen(true);
  };

  const handleReturn = async () => {
    setReturning(true);
    try {
      const res = await adminFetch(`/api/v1/tasks/${returnTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "pending",
          title: returnTitle,
          description: returnDesc,
          plan: "",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReturnOpen(false);
      setMessage("任务已退回，Agent 将重新评估");
      setTimeout(() => setMessage(""), 3000);
      loadTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setReturning(false);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await adminFetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDesc.trim(),
          submitter_type: "employee",
          source: "admin",
          target_agent_id: newTargetAgent || null,
          priority: newPriority,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCreateOpen(false);
      setNewTitle(""); setNewDesc(""); setNewTargetAgent(""); setNewPriority(0);
      loadTasks();
      setMessage("任务创建成功");
      setTimeout(() => setMessage(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    // Load agent list when opening modal
    adminFetch("/api/v1/agents?include_all=false&limit=200")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => setAgentList((d.agents || []) as Array<{ agent_id: string; name: string }>))
      .catch(() => setAgentList([]));
    setCreateOpen(true);
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">员工提交与 Agent MCP 上报的任务，审核打标后转为系统需求，分配给执行者处理。</p>
        <div className="flex gap-2">
          <button type="button" onClick={openCreate} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">+ 创建任务</button>
          <button type="button" onClick={loadTasks} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{loading ? "加载中…" : refreshing ? "刷新中…" : "刷新"}</button>
        </div>
      </div>

      {/* Stat cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <StatCard label="全部" value={counts.all} note="总任务数" />
        <StatCard label="待处理" value={counts.pending} note="pending" />
        <StatCard label="预审中" value={counts.pre_review} note="pre-review" />
        <StatCard label="已批准" value={counts.approved} note="待执行" />
        <StatCard label="执行中" value={counts.in_progress} note="in progress" />
        <StatCard label="已完成" value={counts.completed} note="done" />
        <StatCard label="失败" value={counts.failed} note="failed" />
        <StatCard label="已拒绝" value={counts.rejected} note="rejected" />
      </section>

      {/* Messages */}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}<button onClick={() => setMessage("")} className="ml-2 text-emerald-500 hover:text-emerald-700">✕</button></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button onClick={() => setError("")} className="ml-2 text-red-500 hover:text-red-700">✕</button></div>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {(["all", "pending", "pre_review", "approved", "in_progress", "completed", "failed", "rejected"] as TaskTab[]).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${tab === item ? "border border-b-white border-slate-200 bg-white text-slate-950 -mb-px" : "text-slate-500 hover:text-slate-800"}`}>
            {item === "all" ? "全部" : statusLabel(item as TaskStatus)}
            {item !== "all" && counts[item] > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{counts[item]}</span>}
          </button>
        ))}
      </div>

      {/* Filter bar + table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={(e) => e.preventDefault()} className="mb-4 flex flex-wrap gap-2">
          <input className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="搜索标题或描述" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
            <option value="">全部来源</option><option value="portal">门户</option><option value="mcp">MCP</option><option value="admin">管理后台</option>
          </select>
          <button type="button" onClick={() => { loadTasks(); setFilters({ query: "", source: "" }); }} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white">重置</button>
        </form>

        {refreshing && !loading && (
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            数据刷新中...
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">暂无任务。员工可以通过门户提交，Agent 可以通过 MCP 上报。</div>
        ) : (
          <>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">任务</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">提交人</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">来源</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="hidden px-3 py-2.5 sm:table-cell">优先级</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">执行者</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">创建时间</th>
                  <th className="hidden px-3 py-2.5 xl:table-cell">更新时间</th>
                  <th className="w-20 px-3 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((task) => (
                  <tr key={task.id} className="cursor-pointer hover:bg-slate-50/50" onClick={() => openDetail(task)}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">{task.title}</div>
                      <div className="font-mono text-xs text-slate-500">{task.id}</div>
                      {task.description && <div className="text-xs text-slate-400 line-clamp-1 mt-0.5">{task.description.slice(0, 80)}</div>}
                      {task.tags?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{task.tags.map((tag) => <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{tag}</span>)}</div>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-600 md:table-cell">{renderSubmitter(task)}</td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-600 lg:table-cell">{SOURCE_LABELS[task.source] || task.source}</td>
                    <td className="px-3 py-2.5"><Badge className={STATUS_META[task.status]?.className || ""}>{statusLabel(task.status)}</Badge></td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      {task.priority > 0 ? <span className="text-xs font-medium text-amber-600">P{task.priority}</span> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-600 lg:table-cell">
                      {task.target_agent_id || <span className="text-slate-400">未分配</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-500 lg:table-cell">{formatDateTimeShort(task.created_at)}</td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-500 xl:table-cell">{formatDateTimeShort(task.updated_at)}</td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => openDetail(task)} className="text-xs text-slate-500 hover:text-slate-800">详情</button>
                        {task.status === "pre_review" && (
                          <>
                            <button type="button" onClick={() => openConfirm(task)} className="text-xs text-emerald-600 hover:text-emerald-800">确认</button>
                            <button type="button" onClick={() => openReturn(task)} className="text-xs text-red-500 hover:text-red-700">退回</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <div className="flex items-center gap-2 text-slate-500">
                <span>共 {total} 条</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="rounded border border-slate-200 px-2 py-1 text-xs">
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} 条/页</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-30">上一页</button>
                <span className="px-2 text-slate-600">{page} / {Math.ceil(total / pageSize)}</span>
                <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(p => p + 1)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-30">下一页</button>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* Detail drawer — read only */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-lg bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-slate-900 leading-snug">{detail.title}</h2>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                  <span className="font-mono text-slate-400">{detail.id}</span>
                  <Badge className={STATUS_META[detail.status]?.className || ""}>{statusLabel(detail.status)}</Badge>
                  {detail.priority > 0 && <span className="text-amber-600 font-medium">P{detail.priority}</span>}
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-lg shrink-0 ml-3">✕</button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Meta row */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-slate-400">提交人</span>
                  <p className="text-slate-700">{renderSubmitter(detail)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">来源</span>
                  <p className="text-slate-700">{SOURCE_LABELS[detail.source] || detail.source}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">分配执行者</span>
                  <p className="text-slate-700">{detail.target_agent_id || <span className="text-slate-400 italic">未分配</span>}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">创建时间</span>
                  <p className="text-slate-700 text-xs">{formatDateTimeShort(detail.created_at)}</p>
                </div>
              </div>

              {/* Assignee info */}
              {detail.status === "in_progress" && detail.assignee_type && (
                <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-700">
                  {detail.assignee_type === "hermes" ? "Hermes" : `Agent ${detail.assignee_id || ""}`} 正在处理
                  {detail.claimed_at && <span className="ml-2 text-violet-500">{formatDateTimeShort(detail.claimed_at)}</span>}
                </div>
              )}

              {/* Tags */}
              {detail.tags && detail.tags.length > 0 && (
                <div>
                  <span className="text-xs text-slate-400 block mb-1.5">标签</span>
                  <div className="flex flex-wrap gap-1">
                    {detail.tags.map((tag) => (
                      <span key={tag} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <span className="text-xs text-slate-400 block mb-1.5">描述</span>
                {detail.description ? (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {detail.description}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">无</p>
                )}
              </div>

              {/* Plan */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400">执行方案</span>
                  {detail.plan && (
                    <button onClick={() => setExpandText(detail.plan)} className="text-xs text-blue-600 hover:text-blue-800">全屏查看</button>
                  )}
                </div>
                {detail.plan ? (
                  <div className="rounded-lg bg-sky-50/50 border border-sky-200 p-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {detail.plan}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">暂无（未预审或预审未完成）</p>
                )}
              </div>

              {/* Result */}
              {detail.result && (
                <div>
                  <span className="text-xs text-slate-400 block mb-1.5">执行结果</span>
                  <div className="rounded-lg bg-emerald-50/50 border border-emerald-200 p-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {detail.result}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setCreateOpen(false)} />
          <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">创建任务</h3>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">标题 *</label>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="任务标题"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">描述</label>
              <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={3} placeholder="问题描述或需求说明"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">优先级 (0-10)</label>
              <input type="number" min={0} max={10} value={newPriority} onChange={(e) => setNewPriority(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">分配执行者</label>
              <select value={newTargetAgent} onChange={(e) => setNewTargetAgent(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">未分配</option>
                <option value="sysadmin">sysadmin（超级管理员）</option>
                {agentList.map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>{a.name || a.agent_id}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setCreateOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleCreate} disabled={creating || !newTitle.trim()}
                className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {creating ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expand modal */}
      {expandText && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-8">
          <div className="absolute inset-0 bg-black/50" onClick={() => setExpandText("")} />
          <div className="relative w-full max-w-3xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <span className="text-sm font-semibold text-slate-900">执行方案</span>
              <button onClick={() => setExpandText("")} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-sans">{expandText}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmOpen(false)} />
          <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">确认执行方案</h3>
            <p className="text-xs text-slate-500">确认后将状态更新为「待执行」，可微调方案内容。</p>
            <textarea value={confirmPlan} onChange={(e) => setConfirmPlan(e.target.value)} rows={10}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y font-mono" />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleConfirm} disabled={confirming}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {confirming ? "确认中…" : "确认执行"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return modal */}
      {returnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setReturnOpen(false)} />
          <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">退回任务</h3>
            <p className="text-xs text-slate-500">退回后状态更新为「待评估」，Agent 将重新预审。方案将被清空。</p>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">标题</label>
              <input value={returnTitle} onChange={(e) => setReturnTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">描述</label>
              <textarea value={returnDesc} onChange={(e) => setReturnDesc(e.target.value)} rows={4}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setReturnOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleReturn} disabled={returning}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {returning ? "退回中…" : "确认退回"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
