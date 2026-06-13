import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";

import { adminFetch, isConsoleAuthenticated } from "../hooks/useAdminToken";
import { formatDateTimeShort, formatDateTimeFull } from "../lib/datetime";

type Workspace = {
  workspace_id: string;
  owner_account_id: string;
  tenant_id?: string;
  team_id?: string;
  name: string;
  root_path: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type AgentRun = {
  run_id: string;
  workspace_id: string;
  account_id: string;
  prompt: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  log_excerpt?: string;
  result_summary?: string;
  error?: string;
  artifact_manifest?: Array<{ path: string; sha256: string; bytes: number }>;
  signals?: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
};

type AgentRunEvent = {
  id: number;
  run_id: string;
  event_type: string;
  seq: number;
  ts: string;
  payload?: Record<string, unknown>;
};

type ModelOption = { id: string; label: string; provider?: string; target?: string };
type SkillOption = { id: string; name: string; version?: string; summary?: string };
type McpOption = { id: string; name: string; db_type?: string; access_mode?: string };
type AgentOptions = { models: ModelOption[]; default_model: string; skills: SkillOption[]; mcp: McpOption[] };

const STATUS_META: Record<AgentRun["status"], { label: string; className: string; dot: string }> = {
  queued: { label: "排队中", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
  running: { label: "运行中", className: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500 animate-pulse" },
  succeeded: { label: "完成", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  cancelled: { label: "已取消", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
};

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

/** 把后端事件转成用户可读的中文时间线条目。 */
function describeEvent(event: AgentRunEvent): { icon: string; title: string; detail: string } {
  const payload = event.payload || {};
  const num = (key: string) => (typeof payload[key] === "number" ? (payload[key] as number) : undefined);
  const str = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
  switch (event.event_type) {
    case "run.queued":
      return { icon: "🕒", title: "任务已排队", detail: str("model") ? `模型 ${str("model")}` : "等待执行资源" };
    case "context.prepare":
      return { icon: "📦", title: "准备执行环境", detail: "挂载私有 workspace 与上下文" };
    case "context.ready": {
      const skills = num("skills") ?? 0;
      const materialized = num("materialized_skills") ?? 0;
      const mcp = num("mcp_connections") ?? 0;
      const knowledge = num("knowledge_results") ?? 0;
      const parts = [`${skills} 个 skills`];
      if (materialized) parts.push(`${materialized} 个已落地到 workspace`);
      if (mcp) parts.push(`${mcp} 个 MCP 连接器`);
      parts.push(`命中 ${knowledge} 条知识库`);
      return { icon: "✅", title: "上下文就绪", detail: parts.join("，") };
    }
    case "assistant_message":
      return { icon: "🤖", title: "Agent 返回结果", detail: str("summary") || "执行完成" };
    case "run.error":
      return { icon: "⚠️", title: "执行出错", detail: str("error") || str("summary") || "运行未能完成" };
    default:
      return { icon: "•", title: event.event_type, detail: "" };
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fileMeta(path: string): { icon: string; label: string } {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return { icon: "🧾", label: "JSON" };
  if (lower.endsWith(".md")) return { icon: "📄", label: "Markdown" };
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return { icon: "📃", label: "Text" };
  return { icon: "📁", label: "File" };
}

function prettyContent(path: string, content: string): string {
  if (path.toLowerCase().endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
}

/** Agent 思考中的动画点。 */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </span>
  );
}

/** 把运行按 今天 / 昨天 / 更早 分组。 */
function groupRunsByDate(runs: AgentRun[]): Array<{ label: string; items: AgentRun[] }> {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const yesterday = today - 86400000;
  const buckets: Record<string, AgentRun[]> = { 今天: [], 昨天: [], 更早: [] };
  for (const run of runs) {
    const ts = startOfDay(new Date(run.created_at));
    if (ts >= today) buckets["今天"].push(run);
    else if (ts >= yesterday) buckets["昨天"].push(run);
    else buckets["更早"].push(run);
  }
  return ["今天", "昨天", "更早"].map((label) => ({ label, items: buckets[label] })).filter((g) => g.items.length);
}

/** 轻量 popover：点击外部自动关闭。 */
function Popover({
  open,
  onClose,
  align = "left",
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute bottom-full z-30 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

export function CodingAgentWorkspacePage() {
  const navigate = useNavigate();
  const { workspaceId = "" } = useParams();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [prompt, setPrompt] = useState("");

  const [options, setOptions] = useState<AgentOptions>({ models: [], default_model: "", skills: [], mcp: [] });
  const [model, setModel] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedMcp, setSelectedMcp] = useState<string[]>([]);

  const [modelOpen, setModelOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setLogExpanded(false);
    setEventsExpanded(false);
    setFilesExpanded(false);
  }, [selectedRunId]);

  const [fileViewer, setFileViewer] = useState<{ path: string; content: string; size: number; truncated: boolean } | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [fileLoading, setFileLoading] = useState("");
  const [htmlContents, setHtmlContents] = useState<Record<string, string>>({});
  const [mediaBlobUrls, setMediaBlobUrls] = useState<Record<string, string>>({});

  const SESSION_TITLES_KEY = `evotown-session-titles-${workspaceId}`;
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_TITLES_KEY) || "{}"); } catch { return {}; }
  });
  const [editingTitle, setEditingTitle] = useState<{ id: string; value: string } | null>(null);

  const saveSessionTitle = (sessionId: string, title: string) => {
    const next = { ...sessionTitles, [sessionId]: title.trim() || "" };
    setSessionTitles(next);
    localStorage.setItem(SESSION_TITLES_KEY, JSON.stringify(next));
    setEditingTitle(null);
  };

  const openFile = async (path: string) => {
    if (!workspaceId) return;
    setFileLoading(path);
    try {
      const data = await adminFetch(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files?path=${encodeURIComponent(path)}`,
      ).then((res) => readJson<{ path: string; content: string; size: number; truncated: boolean }>(res));
      setFileViewer(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法打开文件");
    } finally {
      setFileLoading("");
    }
  };

  const runChain = useMemo(() => {
    if (!selectedRunId) return [];
    // Find the root of this session
    const rootMap = new Map<string, string>();
    for (const run of runs) {
      let root = run.run_id;
      let cur: AgentRun | undefined = run;
      const seen = new Set<string>();
      let prevId: string;
      while (true) {
        prevId = ((cur.signals?.previous_run_id as string) || "").trim();
        if (!prevId || seen.has(prevId)) break;
        seen.add(prevId);
        const prev: AgentRun | undefined = runs.find((r) => r.run_id === prevId);
        if (!prev) break;
        root = prevId;
        cur = prev;
      }
      rootMap.set(run.run_id, root);
    }
    const targetRoot = rootMap.get(selectedRunId) || selectedRunId;
    // Collect all runs sharing this root, sorted by time
    return runs
      .filter((r) => (rootMap.get(r.run_id) || r.run_id) === targetRoot)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [selectedRunId, runs]);

  const selectedRun = useMemo(
    () => runChain.length > 0 ? runChain[runChain.length - 1] : null,
    [runChain],
  );

  type Session = { id: string; prompt: string; count: number; lastAt: string; lastStatus: AgentRun["status"] };
  const sessions = useMemo((): Session[] => {
    const rootMap = new Map<string, string>();
    for (const run of runs) {
      let root = run.run_id;
      let cur: AgentRun | undefined = run;
      const seen = new Set<string>();
      let prevId: string;
      while (true) {
        prevId = ((cur.signals?.previous_run_id as string) || "").trim();
        if (!prevId || seen.has(prevId)) break;
        seen.add(prevId);
        const prev: AgentRun | undefined = runs.find((r) => r.run_id === prevId);
        if (!prev) break;
        root = prevId;
        cur = prev;
      }
      rootMap.set(run.run_id, root);
    }
    const groups = new Map<string, AgentRun[]>();
    for (const run of runs) {
      const root = rootMap.get(run.run_id) || run.run_id;
      const g = groups.get(root) || [];
      g.push(run);
      groups.set(root, g);
    }
    return Array.from(groups.entries())
      .map(([id, sessionRuns]) => {
        sessionRuns.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const last = sessionRuns[sessionRuns.length - 1];
        return { id, prompt: sessionRuns[0].prompt, count: sessionRuns.length, lastAt: last.created_at, lastStatus: last.status };
      })
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  }, [runs]);

  const groupedRuns = useMemo(() => groupRunsByDate(runs), [runs]);
  const isRunning = selectedRun?.status === "running" || selectedRun?.status === "queued";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  const activeModel = useMemo(
    () => options.models.find((item) => item.id === model) || null,
    [options.models, model],
  );

  useEffect(() => {
    if (!isConsoleAuthenticated()) {
      navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    void adminFetch("/api/v1/coding-agent/options")
      .then((res) => readJson<AgentOptions>(res))
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setModel((current) => current || data.default_model || data.models[0]?.id || "claude-sonnet-4");
      })
      .catch(() => {
        if (!cancelled) setModel((current) => current || "claude-sonnet-4");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const wsData = await adminFetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`).then((res) =>
        readJson<{ workspace: Workspace; runs?: AgentRun[] }>(res),
      );
      setWorkspace(wsData.workspace);
      setError("");

      const runData = await adminFetch(
        `/api/v1/agent-runs?workspace_id=${encodeURIComponent(workspaceId)}&limit=100`,
      ).then((res) => readJson<{ runs?: AgentRun[] }>(res));
      setRuns(runData.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!selectedRunId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const fetchEvents = async () => {
      try {
        const data = await adminFetch(`/api/v1/agent-runs/${encodeURIComponent(selectedRunId)}/events`).then((res) =>
          readJson<{ events?: AgentRunEvent[] }>(res),
        );
        if (!cancelled) setEvents(data.events || []);
      } catch {
        if (!cancelled) setEvents([]);
      }
    };
    void fetchEvents();
    const id = setInterval(() => void fetchEvents(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedRunId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length, selectedRunId, runs.length]);

  // Fetch media assets via XHR (with auth) so <img>/<video>/<iframe> can render
  useEffect(() => {
    if (!workspaceId || !runChain.length) return;
    let cancelled = false;
    const fetchMedia = async () => {
      for (const run of runChain) {
        const artifacts = run.artifact_manifest || [];
        for (const a of artifacts) {
          if (a.path.startsWith(".evotown/")) continue;
          const isHtml = /\.html?$/i.test(a.path);
          const isMedia = /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)$/i.test(a.path);
          if (!isHtml && !isMedia) continue;
          try {
            const serveUrl = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/serve/${encodeURIComponent(a.path)}`;
            const res = await adminFetch(serveUrl);
            if (cancelled) return;
            if (isHtml) {
              const text = res.ok ? await res.text() : `<p>Error loading: ${res.status}</p>`;
              setHtmlContents((prev) => {
                if (prev[a.path] !== undefined) return prev;
                return { ...prev, [a.path]: text };
              });
            } else if (isMedia && res.ok) {
              const blob = await res.blob();
              const blobUrl = URL.createObjectURL(blob);
              setMediaBlobUrls((prev) => {
                if (prev[a.path] !== undefined) return prev;
                return { ...prev, [a.path]: blobUrl };
              });
            }
          } catch {
            if (!cancelled && isHtml) {
              setHtmlContents((prev) => ({ ...prev, [a.path]: "<p>Failed to load HTML content</p>" }));
            }
          }
        }
      }
    };
    void fetchMedia();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, runChain.map((r) => r.artifact_manifest?.map((a) => a.path).join(",")).join("|")]);

  const toggleSkill = (id: string) =>
    setSelectedSkills((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  const toggleMcp = (id: string) =>
    setSelectedMcp((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  const startRun = async () => {
    if (!workspaceId || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await adminFetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/runs`, {
        method: "POST",
        body: JSON.stringify({ prompt, model, skills: selectedSkills, mcp: selectedMcp, previous_run_id: selectedRunId }),
      }).then((res) => readJson<{ run: AgentRun }>(res));
      setSelectedRunId(data.run.run_id);
      setPrompt("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "运行失败");
    } finally {
      setBusy(false);
    }
  };

  const onPromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void startRun();
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900">
      {/* 左侧：工作区信息 + 对话历史 */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4">
          <button
            type="button"
            onClick={() => navigate("/coding-agent")}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <span aria-hidden>←</span> 返回工作台列表
          </button>
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                {(workspace?.name || "W").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{workspace?.name || "私有工作台"}</div>
                <div className="truncate font-mono text-[11px] text-slate-500">{workspaceId}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">🔒 私有沙盒</Badge>
              {workspace?.team_id ? (
                <Badge className="border-slate-200 bg-slate-50 text-slate-600">团队 {workspace.team_id}</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">对话历史</span>
          <button
            type="button"
            onClick={() => {
              setSelectedRunId("");
              setPrompt("");
            }}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            ＋ 新对话
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && !runs.length ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="rounded-lg border border-slate-100 px-3 py-2.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-2 w-1/3 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : runs.length ? (
            <div className="space-y-1.5">
              {sessions.map((session) => {
                const customTitle = sessionTitles[session.id] || "";
                const displayTitle = customTitle || session.prompt;
                const isActive = runChain.some((r) => r.run_id === session.id || ((r.signals?.previous_run_id as string) || "").trim() === session.id);
                return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedRunId(session.id)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    isActive
                      ? "border-indigo-300 bg-indigo-50/70"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[session.lastStatus].dot}`} />
                    {editingTitle?.id === session.id ? (
                      <input
                        autoFocus
                        value={editingTitle.value}
                        onChange={(e) => setEditingTitle({ id: session.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveSessionTitle(session.id, editingTitle.value);
                          if (e.key === "Escape") setEditingTitle(null);
                        }}
                        onBlur={() => saveSessionTitle(session.id, editingTitle.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm text-slate-700 outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                    ) : (
                      <span className="truncate text-sm text-slate-700">{displayTitle}</span>
                    )}
                    <span
                      role="button"
                      title="编辑标题"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTitle({ id: session.id, value: displayTitle });
                      }}
                      className="ml-auto shrink-0 text-xs text-slate-300 hover:text-slate-500 transition-colors"
                    >
                      ✏️
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-4 text-[11px] text-slate-400">
                    <span>{STATUS_META[session.lastStatus].label}</span>
                    <span>·</span>
                    <span>{session.count} 轮对话</span>
                    <span>·</span>
                    <span>{formatDateTimeShort(session.lastAt)}</span>
                  </div>
                </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
              还没有对话，在右侧输入任务开始。
            </div>
          )}
        </div>
      </aside>

      {/* 中间：对话区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">Coding Agent 工作台</div>
            <div className="text-xs text-slate-500">
              在私有 workspace 中执行任务，自动注入公共 skills 与知识库上下文。
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
            <button
              type="button"
              onClick={() => setDetailsOpen((value) => !value)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                detailsOpen
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              详情面板
            </button>
          </div>
        </header>

        {error && (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">{error}</div>
        )}

        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {runChain.length > 0 ? (
            <div className="mx-auto max-w-3xl space-y-4">
              {runChain.map((run) => {
                const isLast = run.run_id === selectedRun?.run_id;
                const runRunning = run.status === "running" || run.status === "queued";
                return (
                  <div key={run.run_id}>
                    {/* User message */}
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-indigo-600 px-4 py-3 text-sm text-white shadow-sm">
                        <p className="whitespace-pre-wrap">{run.prompt}</p>
                        <div className="mt-1.5 text-[11px] text-indigo-100">
                          {run.model} · {formatDateTimeShort(run.created_at)}
                        </div>
                      </div>
                    </div>

                    {/* AI response */}
                    <div className="mt-3 flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                        AI
                      </div>
                      <div className="max-w-[85%] flex-1">
                        <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="font-medium">Agent</span>
                          <span>{formatDateTimeFull(run.completed_at || run.created_at)}</span>
                        </div>
                        <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                          <div className="mb-2 flex items-center gap-2">
                            <Badge className={STATUS_META[run.status].className}>
                              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[run.status].dot}`} />
                              {STATUS_META[run.status].label}
                            </Badge>
                          </div>
                          {runRunning && !run.result_summary && !run.error ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-slate-500">
                                <TypingDots />
                                <span>Agent 正在执行…</span>
                                {run.created_at && (
                                  <span className="text-xs text-slate-400">
                                    {(() => {
                                      const start = new Date(run.created_at).getTime();
                                      const now = Date.now();
                                      const sec = Math.floor((now - start) / 1000);
                                      if (sec < 60) return `(${sec}秒)`;
                                      return `(${Math.floor(sec/60)}分${sec%60}秒)`;
                                    })()}
                                  </span>
                                )}
                              </div>
                              {events.length > 0 && (
                                <div className="space-y-0.5">
                                  {events.slice(-3).map((event) => {
                                    const info = describeEvent(event);
                                    return (
                                      <div key={`${event.id}-${event.seq}`} className="flex items-center gap-1.5 text-xs text-slate-400">
                                        <span>{info.icon}</span>
                                        <span className={event.event_type === "context.ready" ? "text-emerald-600" : ""}>
                                          {info.title}
                                        </span>
                                        {info.detail ? <span className="text-slate-300">· {info.detail}</span> : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="prose prose-sm max-w-none prose-slate">
                              <ReactMarkdown>
                                {run.result_summary || run.error || "执行完成。"}
                              </ReactMarkdown>
                            </div>
                          )}
                          {/* Image/Video previews — always visible inline */}
                          {isLast && (run.artifact_manifest || [])
                            .filter(a => !a.path.startsWith(".evotown/") && /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)$/i.test(a.path))
                            .length > 0 && (
                            <div className="mt-3 space-y-2">
                              {(run.artifact_manifest || [])
                                .filter(a => !a.path.startsWith(".evotown/") && /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)$/i.test(a.path))
                                .map((a) => {
                                  const ext = a.path.split(".").pop()?.toLowerCase() || "";
                                  const isVideo = ext === "mp4" || ext === "webm";
                                  const blobUrl = mediaBlobUrls[a.path];
                                  if (isVideo) {
                                    return (
                                      <video key={a.path} controls className="max-h-80 max-w-full rounded-lg">
                                        {blobUrl ? <source src={blobUrl} type={`video/${ext}`} /> : null}
                                      </video>
                                    );
                                  }
                                  return blobUrl ? (
                                    <img key={a.path} src={blobUrl} alt={a.path} className="max-h-80 max-w-full rounded-lg" />
                                  ) : null;
                                })}
                            </div>
                          )}
                          {/* Web preview (HTML files) — always visible inline */}
                          {isLast && (run.artifact_manifest || [])
                            .filter(a => !a.path.startsWith(".evotown/") && /\.html?$/i.test(a.path))
                            .length > 0 && (
                            <div className="mt-3 space-y-3">
                              {(run.artifact_manifest || [])
                                .filter(a => !a.path.startsWith(".evotown/") && /\.html?$/i.test(a.path))
                                .map((a) => {
                                  const serveUrl = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/serve/${encodeURIComponent(a.path)}`;
                                  return (
                                    <div key={a.path} className="rounded-lg border border-slate-200 overflow-hidden">
                                      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                                        <span className="text-xs font-medium text-slate-600">
                                          📄 {a.path.split("/").pop() || a.path}
                                        </span>
                                        <a
                                          href={serveUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-xs text-indigo-600 hover:text-indigo-800"
                                        >
                                          在新窗口打开 ↗
                                        </a>
                                      </div>
                                      <div className="w-full" style={{ height: "70vh", maxHeight: "600px" }}>
                                        {htmlContents[a.path] ? (
                                          <iframe
                                            srcDoc={htmlContents[a.path]}
                                            className="w-full h-full border-0"
                                            title={a.path}
                                            sandbox="allow-scripts allow-same-origin"
                                          />
                                        ) : (
                                          <div className="flex items-center justify-center h-full text-sm text-slate-400">
                                            Loading preview...
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                          {/* Toggle buttons */}
                          {isLast && (run.log_excerpt || events.length > 0 || (run.artifact_manifest?.filter(a => !a.path.startsWith(".evotown/")).length ?? 0) > 0) && (
                            <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3">
                              {run.log_excerpt ? (
                                <button
                                  type="button"
                                  onClick={() => setLogExpanded((v) => !v)}
                                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                  <span>{logExpanded ? "▾" : "▸"}</span>
                                  <span>执行日志</span>
                                </button>
                              ) : null}
                              {events.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setEventsExpanded((v) => !v)}
                                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                  <span>{eventsExpanded ? "▾" : "▸"}</span>
                                  <span>事件时间线</span>
                                </button>
                              ) : null}
                              {((run.artifact_manifest || []).filter(a => !a.path.startsWith(".evotown/")).length > 0) && (
                                <button
                                  type="button"
                                  onClick={() => setFilesExpanded((v) => !v)}
                                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                  <span>{filesExpanded ? "▾" : "▸"}</span>
                                  <span>文件下载 ({(run.artifact_manifest || []).filter(a => !a.path.startsWith(".evotown/")).length})</span>
                                </button>
                              )}
                            </div>
                          )}
                          {isLast && run.log_excerpt && logExpanded ? (
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                              {run.log_excerpt}
                            </pre>
                          ) : null}
                          {isLast && eventsExpanded && events.length ? (
                            <div className="mt-2 space-y-1">
                              {events.map((event) => {
                                const info = describeEvent(event);
                                return (
                                  <div key={`${event.id}-${event.seq}`} className="flex items-center gap-2 text-xs text-slate-400">
                                    <span aria-hidden>{info.icon}</span>
                                    <span className="text-slate-600">{info.title}</span>
                                    {info.detail ? <span className="truncate text-slate-400">· {info.detail}</span> : null}
                                    <span className="ml-auto text-slate-300">{formatDateTimeShort(event.ts)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                          {isLast && filesExpanded && (
                            <div className="mt-2 space-y-1">
                              {(run.artifact_manifest || [])
                                .filter(a => !a.path.startsWith(".evotown/"))
                                .map((a) => (
                                  <a
                                    key={a.path}
                                    href={`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files?path=${encodeURIComponent(a.path)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                                  >
                                    <span>{fileMeta(a.path).icon}</span>
                                    <span className="truncate flex-1">{a.path.split("/").pop() || a.path}</span>
                                    <span className="shrink-0 text-slate-400">{formatBytes(a.bytes)}</span>
                                    <span className="shrink-0 text-slate-300">↓</span>
                                  </a>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white">
                  ⌘
                </div>
                <div className="text-lg font-semibold text-slate-800">开始一段新的对话</div>
                <p className="mt-2 text-sm text-slate-500">
                  在下方输入任务，选择模型、挂载 skills 与 MCP 插件，Agent 会在该私有 workspace 中执行。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {(selectedSkills.length > 0 || selectedMcp.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedSkills.map((id) => {
                  const skill = options.skills.find((item) => item.id === id);
                  return (
                    <span
                      key={`chip-skill-${id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700"
                    >
                      🧩 {skill?.name || id}
                      <button type="button" onClick={() => toggleSkill(id)} className="text-amber-400 hover:text-amber-700">
                        ×
                      </button>
                    </span>
                  );
                })}
                {selectedMcp.map((id) => {
                  const mcp = options.mcp.find((item) => item.id === id);
                  return (
                    <span
                      key={`chip-mcp-${id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700"
                    >
                      🔌 {mcp?.name || id}
                      <button type="button" onClick={() => toggleMcp(id)} className="text-sky-400 hover:text-sky-700">
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onPromptKeyDown}
                rows={1}
                placeholder={selectedRunId ? "继续此对话…（Cmd/Ctrl + Enter 发送）" : "给这个 workspace 里的 Agent 发一个任务（Cmd/Ctrl + Enter 发送）…"}
                className="max-h-52 min-h-[3rem] w-full resize-none rounded-t-2xl px-4 pt-3 text-sm leading-relaxed outline-none"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-3">
                <div className="flex items-center gap-1.5">
                  {/* 模型切换 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setModelOpen((value) => !value);
                        setSkillsOpen(false);
                        setMcpOpen(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <span className="h-2 w-2 rounded-full bg-indigo-500" />
                      {activeModel?.label || model || "选择模型"}
                      <span className="text-slate-400">▾</span>
                    </button>
                    <Popover open={modelOpen} onClose={() => setModelOpen(false)}>
                      <div className="max-h-72 overflow-y-auto p-1">
                        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Evotown 已配置模型
                        </div>
                        {options.models.length ? (
                          options.models.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setModel(item.id);
                                setModelOpen(false);
                              }}
                              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                                model === item.id ? "bg-indigo-50" : ""
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-slate-800">{item.label}</span>
                                {item.provider ? (
                                  <span className="block truncate text-[11px] text-slate-400">{item.provider}</span>
                                ) : null}
                              </span>
                              {model === item.id ? <span className="text-indigo-600">✓</span> : null}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-3 text-xs text-slate-400">暂无已配置模型。</div>
                        )}
                      </div>
                    </Popover>
                  </div>

                  {/* Skills */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setSkillsOpen((value) => !value);
                        setModelOpen(false);
                        setMcpOpen(false);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 ${
                        selectedSkills.length
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 text-slate-700"
                      }`}
                    >
                      🧩 Skills{selectedSkills.length ? ` (${selectedSkills.length})` : ""}
                    </button>
                    <Popover open={skillsOpen} onClose={() => setSkillsOpen(false)}>
                      <div className="max-h-72 overflow-y-auto p-1">
                        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          公共 Skills
                        </div>
                        {options.skills.length ? (
                          options.skills.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => toggleSkill(item.id)}
                              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                            >
                              <span
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                  selectedSkills.includes(item.id)
                                    ? "border-amber-500 bg-amber-500 text-white"
                                    : "border-slate-300"
                                }`}
                              >
                                {selectedSkills.includes(item.id) ? "✓" : ""}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-slate-800">
                                  {item.name}
                                  {item.version ? (
                                    <span className="ml-1 text-[11px] font-normal text-slate-400">v{item.version}</span>
                                  ) : null}
                                </span>
                                {item.summary ? (
                                  <span className="block truncate text-[11px] text-slate-400">{item.summary}</span>
                                ) : null}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-3 text-xs text-slate-400">暂无可用 skills。</div>
                        )}
                      </div>
                    </Popover>
                  </div>

                  {/* MCP 插件 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setMcpOpen((value) => !value);
                        setModelOpen(false);
                        setSkillsOpen(false);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 ${
                        selectedMcp.length
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : "border-slate-200 text-slate-700"
                      }`}
                    >
                      🔌 MCP{selectedMcp.length ? ` (${selectedMcp.length})` : ""}
                    </button>
                    <Popover open={mcpOpen} onClose={() => setMcpOpen(false)}>
                      <div className="max-h-72 overflow-y-auto p-1">
                        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          MCP / 数据连接器
                        </div>
                        {options.mcp.length ? (
                          options.mcp.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => toggleMcp(item.id)}
                              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                            >
                              <span
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                  selectedMcp.includes(item.id)
                                    ? "border-sky-500 bg-sky-500 text-white"
                                    : "border-slate-300"
                                }`}
                              >
                                {selectedMcp.includes(item.id) ? "✓" : ""}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-slate-800">{item.name}</span>
                                <span className="block truncate text-[11px] text-slate-400">
                                  {[item.db_type, item.access_mode].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-3 text-xs text-slate-400">暂无可访问的 MCP 连接器。</div>
                        )}
                      </div>
                    </Popover>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void startRun()}
                  disabled={busy || !prompt.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? "提交中…" : "发送任务"}
                </button>
              </div>
            </div>
            <div className="mt-1.5 text-center text-[11px] text-slate-400">
              任务在中心化托管环境中执行 · Cmd/Ctrl + Enter 快速发送
            </div>
          </div>
        </div>
      </main>

      {/* 右侧：运行详情 */}
      {detailsOpen && (
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            运行详情
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedRun ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="font-mono text-[11px] text-slate-500">{selectedRun.run_id}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge className={STATUS_META[selectedRun.status].className}>
                      {STATUS_META[selectedRun.status].label}
                    </Badge>
                    <Badge className="border-slate-200 bg-white text-slate-600">{selectedRun.model}</Badge>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-slate-700">挂载的 Skills / MCP</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(((selectedRun.signals?.selected_skills as string[]) || [])).map((id) => (
                      <Badge key={`r-skill-${id}`} className="border-amber-200 bg-amber-50 text-amber-700">
                        🧩 {options.skills.find((item) => item.id === id)?.name || id}
                      </Badge>
                    ))}
                    {(((selectedRun.signals?.selected_mcp as string[]) || [])).map((id) => (
                      <Badge key={`r-mcp-${id}`} className="border-sky-200 bg-sky-50 text-sky-700">
                        🔌 {options.mcp.find((item) => item.id === id)?.name || id}
                      </Badge>
                    ))}
                    {!((selectedRun.signals?.selected_skills as string[]) || []).length &&
                    !((selectedRun.signals?.selected_mcp as string[]) || []).length ? (
                      <span className="text-xs text-slate-400">未挂载额外插件。</span>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">上下文文件</span>
                    <span className="text-[11px] text-slate-400">点击查看</span>
                  </div>
                  <div className="space-y-2">
                    {(selectedRun.artifact_manifest || []).length ? (
                      (selectedRun.artifact_manifest || []).map((artifact) => {
                        const meta = fileMeta(artifact.path);
                        const name = artifact.path.split("/").pop() || artifact.path;
                        return (
                          <button
                            key={artifact.path}
                            type="button"
                            onClick={() => void openFile(artifact.path)}
                            className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
                          >
                            <span className="text-base" aria-hidden>{meta.icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-slate-900">{name}</span>
                              <span className="block truncate text-[11px] text-slate-400">
                                {meta.label} · {formatBytes(artifact.bytes)}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-slate-300">
                              {fileLoading === artifact.path ? "…" : "›"}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-xs text-slate-400">暂无上下文文件。</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-slate-700">执行步骤</div>
                  {events.length ? (
                    <ol className="relative space-y-3 border-l border-slate-200 pl-4">
                      {events.map((event) => {
                        const info = describeEvent(event);
                        return (
                          <li key={`detail-${event.id}-${event.seq}`} className="relative">
                            <span className="absolute -left-[1.4rem] flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px]">
                              {info.icon}
                            </span>
                            <div className="text-sm font-medium text-slate-800">{info.title}</div>
                            {info.detail ? (
                              <div className="mt-0.5 break-words text-xs text-slate-500">{info.detail}</div>
                            ) : null}
                            <div className="mt-0.5 text-[11px] text-slate-400">{formatDateTimeShort(event.ts)}</div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="text-xs text-slate-400">暂无执行步骤。</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-slate-400">选择左侧的一次运行查看详情。</div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  <div className="mb-1 font-medium text-slate-700">workspace 路径</div>
                  <div className="break-all font-mono text-[11px] text-slate-500">{workspace?.root_path || "—"}</div>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 文件查看器 */}
      {fileViewer && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setFileViewer(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden>{fileMeta(fileViewer.path).icon}</span>
                <span className="truncate font-mono text-sm font-medium text-slate-900">{fileViewer.path}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] text-slate-400">
                  {formatBytes(fileViewer.size)}
                  {fileViewer.truncated ? " · 已截断" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setFileViewer(null)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  关闭
                </button>
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
              {prettyContent(fileViewer.path, fileViewer.content)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
