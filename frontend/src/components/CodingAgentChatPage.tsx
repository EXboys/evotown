import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MarkdownContent } from "./MarkdownContent";
import { ClickableConversationImage, ImageLightbox, type LightboxImage } from "./ImageLightbox";
import {
  ContextFileViewer,
  contextArtifactMeta,
  contextArtifactPath,
  sortContextArtifacts,
} from "./ContextFileViewer";

import { adminFetch, getAdminToken, getConsoleApiKey, getStaffToken, isConsoleAuthenticated } from "../hooks/useAdminToken";
import { formatDateTimeShort, formatDateTimeFull, parseEvotownTimestamp } from "../lib/datetime";
import { formatBytes, fileMeta } from "../lib/codingAgentUtils";
import { WorkspaceFileList, type WorkspaceFileEntry } from "./WorkspaceFileList";
import { GatewayDrawer } from "./gateway/GatewayDrawer";

type Agent = {
  agent_id: string; owner_account_id: string; name: string; root_path: string;
  status: "active" | "archived"; created_at: string; updated_at: string;
  template_id?: string;
};

type AgentTemplateSummary = {
  template_id: string;
  has_agent_dir?: boolean;
  agent_dir_root?: string;
  agent_dir_prefix?: string;
};

type AgentRun = {
  run_id: string; agent_id: string; account_id: string; prompt: string; model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  log_excerpt?: string; result_summary?: string; error?: string;
  artifact_manifest?: Array<{ path: string; sha256: string; bytes: number }>;
  signals?: Record<string, unknown>; created_at: string; started_at?: string; completed_at?: string;
};

type AgentRunEvent = { id: number; run_id: string; event_type: string; seq: number; ts: string; payload?: Record<string, unknown> };
type AgentUpload = { path: string; filename: string; bytes: number; sha256: string; kind: "image" | "file"; content_type: string };
type PendingAttachment = AgentUpload & { localId: string; previewUrl?: string };
type SkillOption = { id: string; name: string; version?: string; summary?: string };
type KnowledgeItem = { id: string; title: string; version?: string };
type AgentProfile = {
  agent_type?: string; soul?: string; paradigm?: string; standards?: string;
  default_model?: string; default_skills?: string[]; default_mcp?: string[];
};

const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.htm,.py,.js,.ts,.tsx,.jsx,.css,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

function runAttachmentPaths(run: AgentRun): string[] {
  const raw = run.signals?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function eventAssistantText(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const summary = typeof payload.summary === "string" ? payload.summary : "";
  return (text || summary).trim();
}

function streamingAssistantTexts(events: AgentRunEvent[]): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.event_type !== "assistant_message") continue;
    const t = eventAssistantText(ev.payload);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    texts.push(t);
  }
  return texts;
}

function runReplyFallback(run: AgentRun, events: AgentRunEvent[]): string {
  if (streamingAssistantTexts(events).length) return "";
  return (run.result_summary || "").trim();
}

function buildSessionGroups(runs: AgentRun[]): Map<string, string[]> {
  const byId = new Map(runs.map((run) => [run.run_id, run]));
  const rootByRun = new Map<string, string>();
  for (const run of runs) {
    let root = run.run_id;
    let cur: AgentRun | undefined = run;
    const seen = new Set<string>();
    while (cur) {
      const prevId = String((cur.signals?.previous_run_id as string) || "").trim();
      if (!prevId || seen.has(prevId)) break;
      seen.add(prevId);
      const prev = byId.get(prevId);
      if (!prev) break;
      root = prevId;
      cur = prev;
    }
    rootByRun.set(run.run_id, root);
  }
  const groups = new Map<string, string[]>();
  for (const run of runs) {
    const root = rootByRun.get(run.run_id) || run.run_id;
    const chain = groups.get(root) || [];
    chain.push(run.run_id);
    groups.set(root, chain);
  }
  return groups;
}

function resolveSessionRoot(runs: AgentRun[], sessionId: string): string {
  const id = sessionId.trim();
  if (!id) return "";
  const groups = buildSessionGroups(runs);
  if (groups.has(id)) return id;
  for (const [root, runIds] of groups) {
    if (runIds.includes(id)) return root;
  }
  return runs.some((run) => run.run_id === id) ? id : "";
}

function runsInSession(runs: AgentRun[], sessionId: string): AgentRun[] {
  const root = resolveSessionRoot(runs, sessionId);
  if (!root) return [];
  const runIds = new Set(buildSessionGroups(runs).get(root) || [root]);
  return runs
    .filter((run) => runIds.has(run.run_id))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function AssistantReplyBlocks({ texts }: { texts: string[] }) {
  if (!texts.length) return null;
  return (
    <>
      {texts.map((text, index) => (
        <div key={`${index}-${text.slice(0, 24)}`} className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <MarkdownContent>{text}</MarkdownContent>
        </div>
      ))}
    </>
  );
}

function isImageAttachmentPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path);
}

function formatLog(raw: string): string {
  return raw.split("\n").map(line => {
    line = line.trim();
    if (!line) return "";
    try {
      const obj = JSON.parse(line);
      switch (obj.type) {
        case "assistant": {
          const texts: string[] = [];
          for (const block of (obj.message?.content || [])) {
            if (block.text) texts.push(block.text);
          }
          return texts.length ? "🤖 " + texts.join(" ") : "";
        }
        case "user": {
          const parts: string[] = [];
          for (const block of (obj.message?.content || [])) {
            if (block.type === "tool_result") {
              const content = typeof block.content === "string" ? block.content.slice(0, 200) : JSON.stringify(block.content).slice(0, 200);
              parts.push(block.is_error ? "⚠️ 错误: " + content : "📤 " + content);
            }
          }
          return parts.join("\n");
        }
        case "system":
          return obj.subtype === "init" ? "🚀 启动 — 模型: " + (obj.model || "?") : "";
        case "result":
          return obj.is_error ? "❌ 失败: " + ((obj.result || obj.subtype || "").slice(0, 200)) : "✅ 完成";
        default:
          return "";
      }
    } catch {
      return line.length > 200 ? line.slice(0, 200) + "..." : line;
    }
  }).filter(Boolean).join("\n");
}

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

function describeEvent(event: AgentRunEvent): { icon: string; title: string; detail: string } {
  const payload = event.payload || {};
  const num = (key: string) => (typeof payload[key] === "number" ? (payload[key] as number) : undefined);
  const str = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
  switch (event.event_type) {
    case "run.queued": return { icon: "🕒", title: "任务已排队", detail: str("model") ? `模型 ${str("model")}` : "等待执行资源" };
    case "context.prepare": return { icon: "📦", title: "准备执行环境", detail: "挂载私有 agent 与上下文" };
    case "context.ready": {
      const skills = num("skills") ?? 0;
      const mcp = num("mcp_connections") ?? 0;
      const kn = num("knowledge_results") ?? 0;
      return { icon: "✅", title: "上下文就绪", detail: `${skills} skills · ${mcp} MCP · 命中 ${kn} 条知识库` };
    }
    case "vision.ready": return { icon: "👁️", title: "视觉分析完成", detail: `${num("images") ?? 0} 张图片` };
    case "vision.error": return { icon: "⚠️", title: "视觉分析失败", detail: str("error") || "视觉模型不可用" };
    case "vision.skipped": return { icon: "ℹ️", title: "未启用视觉模型", detail: "" };
    case "assistant_message": return { icon: "🤖", title: "Agent 返回", detail: (str("text") || str("summary"))?.slice(0, 80) || "" };
    case "tool_call": return { icon: "🔧", title: "调用工具", detail: str("tool") || "" };
    case "tool_result": {
      const err = payload["is_error"];
      return { icon: err ? "⚠️" : "📤", title: err ? "工具错误" : "工具返回", detail: str("content")?.slice(0, 80) || "" };
    }
    case "run.error": return { icon: "⚠️", title: "执行出错", detail: str("error") || "运行失败" };
    default: return { icon: "•", title: event.event_type, detail: "" };
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try { data = JSON.parse(text); } catch {
      if (res.status === 413) throw new Error("文件过大");
      throw new Error(`服务器异常 (HTTP ${res.status})`);
    }
  }
  if (!res.ok) {
    const detail = typeof (data as { detail?: unknown })?.detail === "string" ? (data as { detail: string }).detail : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {[0, 1, 2].map((index) => (
        <span key={index} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${index * 0.15}s` }} />
      ))}
    </span>
  );
}

export function CodingAgentChatPage() {
  const navigate = useNavigate();
  const { agentId = "" } = useParams();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [eventsByRun, setEventsByRun] = useState<Record<string, AgentRunEvent[]>>({});
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("claude-sonnet-4");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const PAGE_SIZE = 10;
  const [hasMoreRuns, setHasMoreRuns] = useState(true);
  const loadingMoreRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imeComposingRef = useRef(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);

  // Sidebar
  const [leftOpen, setLeftOpen] = useState(true);
  const [expandedSection, setExpandedSection] = useState<"history" | "skills" | "knowledge" | null>(null);
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(`evotown-session-titles-${agentId}`) || "{}"); } catch { return {}; }
  });
  const [assignedSkills, setAssignedSkills] = useState<SkillOption[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [rightOpen, setRightOpen] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState("");

  // Detail
  useEffect(() => { setLogExpanded(false); setEventsExpanded(false); setFilesExpanded(false); }, [selectedRunId]);
  const [logExpanded, setLogExpanded] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [fileViewer, setFileViewer] = useState<{ path: string; content: string; size: number; truncated: boolean } | null>(null);
  const [fileLoading, setFileLoading] = useState("");
  const [fileError, setFileError] = useState<{ path: string; message: string; status?: number } | null>(null);
  const [agentFiles, setAgentFiles] = useState<WorkspaceFileEntry[]>([]);
  const [agentFilesTruncated, setAgentFilesTruncated] = useState(false);
  const [agentFilesLoading, setAgentFilesLoading] = useState(false);
  const [showSystemFiles, setShowSystemFiles] = useState(false);

  // Profile modal
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [profileData, setProfileData] = useState<AgentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Dev file browser
  const [devDirPath, setDevDirPath] = useState("");
  const [devDirFiles, setDevDirFiles] = useState<Array<{ name: string; path: string; is_dir: boolean; size: number }>>([]);
  const [devDirLoading, setDevDirLoading] = useState(false);
  const [devDirRoot, setDevDirRoot] = useState<"agent" | "shared" | "server" | "">("");
  const [devDirPrefix, setDevDirPrefix] = useState("");

  type Session = { id: string; prompt: string; count: number; lastAt: string; lastStatus: AgentRun["status"] };
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!agentId) return;
    adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}`)
      .then(r => r.json()).then(d => {
        const ws = d.agent || d;
        if (ws.template_id) {
          adminFetch("/api/v1/agent-templates").then(r => r.json()).then(td => {
            const tpl = ((td.templates || []) as AgentTemplateSummary[]).find(
              (t) => t.template_id === ws.template_id,
            );
            if (tpl?.has_agent_dir) {
              setDevDirRoot(tpl.agent_dir_root as "agent" | "shared" | "server");
              setDevDirPrefix((tpl.agent_dir_prefix || "").replace(/\/$/, ""));
            }
          }).catch(() => {});
        }
      }).catch(() => {});
  }, [agentId]);

  const hasDevFiles = devDirRoot ? true : false;
  useEffect(() => { if (hasDevFiles) setRightOpen(true); }, [hasDevFiles]);

  const [sessionLoading, setSessionLoading] = useState(false);

  const mergeRuns = useCallback((incoming: AgentRun[]) => {
    setRuns((prev) => {
      const merged = new Map(prev.map((run) => [run.run_id, run]));
      for (const run of incoming) merged.set(run.run_id, run);
      return Array.from(merged.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    });
  }, []);

  const loadSessionRuns = useCallback(async (sessionId: string) => {
    if (!agentId || !sessionId) return;
    setSessionLoading(true);
    try {
      const data = await adminFetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/runs?limit=${PAGE_SIZE}&asc=true`,
      ).then((res) => readJson<{ runs?: AgentRun[]; has_more?: boolean }>(res));
      mergeRuns(data.runs || []);
      setHasMoreRuns(!!data.has_more);
    } catch {
      /* keep prior runs; thread may show partial data */
    } finally {
      setSessionLoading(false);
    }
  }, [agentId, mergeRuns]);

  const loadSessionRunsRef = useRef(loadSessionRuns);
  loadSessionRunsRef.current = loadSessionRuns;

  const loadDevDir = (dir: string) => {
    if (!agentId) return;
    setDevDirLoading(true);
    const params = new URLSearchParams();
    if (dir) params.set("subdir", dir);
    if (devDirPrefix) params.set("prefix", devDirPrefix);
    const qs = params.toString();
    const apiUrl = `/api/v1/agents/${encodeURIComponent(agentId)}/file-index${qs ? "?" + qs : ""}`;
    adminFetch(apiUrl).then(r => readJson<{ entries?: WorkspaceFileEntry[] }>(r)).then(data => {
      setDevDirFiles((data.entries || []).map(e => ({
        name: e.name,
        path: e.path,
        is_dir: e.is_dir || false,
        size: e.size || 0,
      })));
      setDevDirPath(dir);
    }).catch((err) => { console.error("loadDevDir failed", err); }).finally(() => setDevDirLoading(false));
  };
  useEffect(() => { if (rightOpen && hasDevFiles && !devDirPath) void loadDevDir(""); }, [rightOpen, hasDevFiles, devDirPath]);

  const openSharedFile = (path: string) => {
    setFileLoading(path); setError("");
    adminFetch(`/api/v1/mcp-dev/files/read?path=${encodeURIComponent(path)}`)
      .then(res => readJson<{ path: string; content: string; size: number; truncated: boolean }>(res))
      .then(d => setFileViewer(d)).catch(err => setError(err instanceof Error ? err.message : "无法打开文件")).finally(() => setFileLoading(""));
  };
  const [htmlContents, setHtmlContents] = useState<Record<string, string>>({});
  const [mediaBlobUrls, setMediaBlobUrls] = useState<Record<string, string>>({});
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);

  // Hooks
  useEffect(() => {
    if (!isConsoleAuthenticated()) navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    const el = textareaRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  // Load
  const loadAgentFiles = useCallback(async (silent: boolean = false) => {
    if (!agentId) return;
    if (!silent) setAgentFilesLoading(true);
    try {
      const data = await adminFetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/file-index?include_dot=${showSystemFiles ? "true" : "false"}`,
      ).then((res) => readJson<{ entries?: WorkspaceFileEntry[]; truncated?: boolean }>(res));
      setAgentFiles(data.entries || []);
      setAgentFilesTruncated(Boolean(data.truncated));
    } catch { if (!silent) { setAgentFiles([]); setAgentFilesTruncated(false); } }
    finally { if (!silent) setAgentFilesLoading(false); }
  }, [agentId, showSystemFiles]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const [wsData, sessionsData] = await Promise.all([
        adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}`).then((res) =>
          readJson<{ agent: Agent; runs?: AgentRun[] }>(res),
        ),
        adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions`).then((res) =>
          readJson<{ sessions?: Session[] }>(res),
        ),
      ]);
      setAgent(wsData.agent);
      setSessions(sessionsData.sessions || []);
      if (wsData.runs?.length) mergeRuns(wsData.runs);
      setError("");
      void loadAgentFiles(true);
      void adminFetch(`/api/v1/agent/options?agent_id=${encodeURIComponent(agentId)}`)
        .then((res) => res.json())
        .then((opts) => {
          setAssignedSkills((opts.skills || []) as SkillOption[]);
          const dm = (opts.default_model as string) || "";
          if (dm) setModel(dm);
        })
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [agentId, loadAgentFiles, mergeRuns]);

  const reloadSessions = useCallback(async () => {
    if (!agentId) return;
    try {
      const data = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions`).then((res) =>
        readJson<{ sessions?: Session[] }>(res),
      );
      setSessions(data.sessions || []);
    } catch {
      /* ignore */
    }
  }, [agentId]);

  const sessionRootId = useMemo(
    () => (selectedRunId ? resolveSessionRoot(runs, selectedRunId) : ""),
    [selectedRunId, runs],
  );

  // Load more (older) runs — cursor-based, session-aware
  const loadMore = useCallback(async () => {
    if (!agentId || loadingMoreRef.current || !hasMoreRuns) return;
    // Find the oldest non-root run for the cursor (root has no older runs)
    const candidates = selectedRunId
      ? runs.filter(r => r.run_id !== selectedRunId)
      : runs;
    const oldest = candidates[candidates.length - 1];
    if (!oldest?.created_at) return;
    loadingMoreRef.current = true;
    const container = threadRef.current;
    const prevHeight = container?.scrollHeight || 0;
    try {
      let url: string;
      if (sessionRootId) {
        url = `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionRootId)}/runs?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.created_at)}`;
      } else {
        url = `/api/v1/agent-runs?agent_id=${encodeURIComponent(agentId)}&limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.created_at)}`;
      }
      const runData = await adminFetch(url).then((res) => readJson<{ runs?: AgentRun[]; has_more?: boolean }>(res));
      const more = runData.runs || [];
      if (!more.length) { setHasMoreRuns(false); return; }
      setRuns(prev => [...prev, ...more]);
      setHasMoreRuns(!!runData.has_more);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - prevHeight;
      });
    } catch { /* ignore */ } finally { loadingMoreRef.current = false; }
  }, [agentId, hasMoreRuns, runs, selectedRunId, sessionRootId]);

  // Run chain — runs belonging to the selected session only
  const runChain = useMemo(() => {
    if (!selectedRunId) return [];
    return runsInSession(runs, selectedRunId);
  }, [selectedRunId, runs]);

  const initialSessionPickedRef = useRef(false);
  useEffect(() => {
    initialSessionPickedRef.current = false;
  }, [agentId]);
  useEffect(() => {
    if (initialSessionPickedRef.current || selectedRunId || loading || !sessions.length) return;
    initialSessionPickedRef.current = true;
    setSelectedRunId(sessions[0].id);
  }, [selectedRunId, sessions, loading]);

  useEffect(() => {
    const root = sessionRootId || selectedRunId;
    if (!root || loading) return;
    void loadSessionRunsRef.current(root);
  }, [sessionRootId, selectedRunId, loading, agentId]);

  // Events — SSE stream for running runs, one-time fetch for completed runs
  const sseRef = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reloadSessionsRef = useRef(reloadSessions);
  reloadSessionsRef.current = reloadSessions;

  const refreshActiveSession = useCallback(async (sessionId: string) => {
    if (!agentId || !sessionId) return;
    await Promise.all([loadSessionRunsRef.current(sessionId), reloadSessionsRef.current()]);
  }, [agentId]);

  const refreshActiveSessionRef = useRef(refreshActiveSession);
  refreshActiveSessionRef.current = refreshActiveSession;
  const sessionRootRef = useRef(sessionRootId);
  sessionRootRef.current = sessionRootId;
  useEffect(() => {
    if (!selectedRunId || !runChain.length) return;
    let cancelled = false;

    // One-time fetch events for each run in the chain
    const fetchAllEvents = async () => {
      await Promise.all(runChain.map(async (run) => {
        if (cancelled) return;
        if (eventsByRun[run.run_id]?.length) return;
        try {
          const data = await adminFetch(`/api/v1/agent-runs/${encodeURIComponent(run.run_id)}/events`).then((res) => readJson<{ events?: AgentRunEvent[] }>(res));
          if (!cancelled) setEventsByRun((prev) => ({ ...prev, [run.run_id]: data.events || [] }));
        } catch {
          if (!cancelled) setEventsByRun((prev) => ({ ...prev, [run.run_id]: prev[run.run_id] || [] }));
        }
      }));
    };
    void fetchAllEvents();

    // SSE for running runs — push new events in real time
    const runningRunIds = runChain.filter(r => r.status === "running" || r.status === "queued").map(r => r.run_id);

    if (runningRunIds.length > 0) {
      const abort = new AbortController();
      sseRef.current = abort;

      const streamRun = async (runId: string) => {
        try {
          const staffToken = getStaffToken();
          const apiKey = getConsoleApiKey();
          const adminToken = getAdminToken();
          const headers: Record<string, string> = {};
          if (staffToken) headers["Authorization"] = `Bearer ${staffToken}`;
          else if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          else if (adminToken) headers["X-Admin-Token"] = adminToken;

          const res = await fetch(`/api/v1/agent-runs/${encodeURIComponent(runId)}/stream`, { headers, signal: abort.signal });
          if (!res.ok || !res.body) return;

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            if (cancelled || abort.signal.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const ev = JSON.parse(line.slice(6)) as AgentRunEvent;
                  if (!cancelled) {
                    setEventsByRun(prev => {
                      const existing = prev[runId] || [];
                      if (existing.some(e => e.id === ev.id)) return prev;
                      return { ...prev, [runId]: [...existing, ev] };
                    });
                  }
                } catch { /* ignore parse errors */ }
              } else if (line.startsWith("event: done")) {
                setEventsByRun(prev => {
                  const existing = prev[runId] || [];
                  const doneEvent: AgentRunEvent = {
                    id: (existing.length + 1),
                    run_id: runId,
                    event_type: "run.done",
                    seq: (existing.length + 1),
                    ts: new Date().toISOString(),
                    payload: { sse_closed: true },
                  };
                  return { ...prev, [runId]: [...existing, doneEvent] };
                });
                if (!cancelled) {
                  const root = sessionRootRef.current || selectedRunId;
                  void refreshActiveSessionRef.current(root);
                }
                return; // stream done
              }
            }
          }
        } catch (err) {
          if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
            // ignore — EventSource-like auto-reconnect isn't built in here,
            // but the next status change on the run list will trigger a reload
          }
        }
      };

      for (const rid of runningRunIds) {
        void streamRun(rid);
      }
    }

    return () => {
      cancelled = true;
      sseRef.current?.abort();
      sseRef.current = null;
    };
  }, [selectedRunId, runChain.map(r => r.run_id).join(',')]);

  useEffect(() => { void load(); }, [load]);

  // Track whether user manually scrolled away from bottom
  const userScrolledUpRef = useRef(false);
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const handler = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      userScrolledUpRef.current = !atBottom;
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  const totalEventCount = useMemo(() => {
    return Object.values(eventsByRun).reduce((sum, evts) => sum + (evts?.length || 0), 0);
  }, [eventsByRun]);

  // Scroll to bottom on new-session-open, content load, or runChain length change
  const prevSelectedRunIdRef = useRef(selectedRunId);
  const needsScrollRef = useRef(false);
  useLayoutEffect(() => {
    const isNewSession = prevSelectedRunIdRef.current !== selectedRunId;
    prevSelectedRunIdRef.current = selectedRunId;
    if (isNewSession) needsScrollRef.current = true;
    if (!isNewSession && !needsScrollRef.current && runChain.length > 0) return;
    requestAnimationFrame(() => {
      const el = threadRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
    });
  }, [selectedRunId, runChain.length]);

  // Scroll to bottom while streaming events; on new session, force-scroll once
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      const el = threadRef.current;
      if (!el) return;
      if (needsScrollRef.current) {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
        needsScrollRef.current = false;
        return;
      }
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (atBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
      }
    });
  }, [totalEventCount]);

  // Keep scroll pinned to bottom when content resizes (events, iframes, images)
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (needsScrollRef.current) {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
        needsScrollRef.current = false;
        return;
      }
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (atBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedRun = useMemo(() => (runChain.length > 0 ? runChain[runChain.length - 1] : null), [runChain]);
  const isRunning = selectedRun?.status === "running" || selectedRun?.status === "queued";

  // Media
  useEffect(() => {
    if (!agentId || !runChain.length) return;
    let cancelled = false;
    const fetchMedia = async () => {
      for (const run of runChain) {
        for (const path of runAttachmentPaths(run)) {
          if (!isImageAttachmentPath(path)) continue;
          try {
            const serveUrl = `/api/v1/agents/${encodeURIComponent(agentId)}/serve/${encodeURIComponent(path)}`;
            const res = await adminFetch(serveUrl);
            if (cancelled) return;
            if (res.ok) {
              const blob = await res.blob();
              const blobUrl = URL.createObjectURL(blob);
              setMediaBlobUrls((prev) => { if (prev[path] !== undefined) return prev; return { ...prev, [path]: blobUrl }; });
            }
          } catch { /* ignore */ }
        }
        const artifacts = run.artifact_manifest || [];
        for (const a of artifacts) {
          if (a.path.startsWith(".evotown/")) continue;
          const isHtml = /\.html?$/i.test(a.path);
          const isMedia = /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)$/i.test(a.path);
          if (!isHtml && !isMedia) continue;
          try {
            const serveUrl = `/api/v1/agents/${encodeURIComponent(agentId)}/serve/${encodeURIComponent(a.path)}`;
            const res = await adminFetch(serveUrl);
            if (cancelled) return;
            if (isHtml) {
              const text = res.ok ? await res.text() : `<p>Error loading: ${res.status}</p>`;
              setHtmlContents((prev) => { if (prev[a.path] !== undefined) return prev; return { ...prev, [a.path]: text }; });
            } else if (isMedia && res.ok) {
              const blob = await res.blob();
              const blobUrl = URL.createObjectURL(blob);
              setMediaBlobUrls((prev) => { if (prev[a.path] !== undefined) return prev; return { ...prev, [a.path]: blobUrl }; });
            }
          } catch { if (!cancelled && isHtml) setHtmlContents((prev) => ({ ...prev, [a.path]: "<p>Failed to load</p>" })); }
        }
      }
    };
    void fetchMedia();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, runChain.map((r) => `${runAttachmentPaths(r).join(",")}|${r.artifact_manifest?.map((a) => a.path).join(",") || ""}`).join(";")]);

  const saveSessionTitle = (sessionId: string, title: string) => {
    const next = { ...sessionTitles, [sessionId]: title.trim() || "" };
    setSessionTitles(next);
    localStorage.setItem(`evotown-session-titles-${agentId}`, JSON.stringify(next));
  };

  // File viewer
  const openFile = async (path: string) => {
    if (!agentId) return;
    setFileLoading(path); setError("");
    try {
      if (isImageAttachmentPath(path)) {
        const name = path.split("/").pop() || path;
        const cached = mediaBlobUrls[path];
        if (cached) { setLightboxImage({ src: cached, alt: name }); return; }
        const serveUrl = `/api/v1/agents/${encodeURIComponent(agentId)}/serve/${encodeURIComponent(path)}`;
        const res = await adminFetch(serveUrl);
        if (!res.ok) { setFileError({ path, message: `HTTP ${res.status}`, status: res.status }); return; }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setMediaBlobUrls((prev) => ({ ...prev, [path]: blobUrl }));
        setLightboxImage({ src: blobUrl, alt: name });
        return;
      }
      const res = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/files?path=${encodeURIComponent(path)}`);
      if (!res.ok) { setFileError({ path, message: `HTTP ${res.status}`, status: res.status }); return; }
      const data = await res.json() as { path: string; content: string; size: number; truncated: boolean };
      setFileViewer(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法打开文件";
      setFileError({ path, message: msg });
    }
    finally { setFileLoading(""); }
  };

  // Upload / send
  const uploadAgentFiles = async (files: File[]) => {
    if (!agentId || !files.length) return [] as AgentUpload[];
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const data = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/uploads`, { method: "POST", body: form }).then((res) => readJson<{ uploads?: AgentUpload[] }>(res));
    return data.uploads || [];
  };

  const handleAttachmentPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length) return;
    const maxBytes = 10 * 1024 * 1024;
    const tooLarge = picked.filter((f) => f.size > maxBytes);
    if (tooLarge.length) { setError(`以下文件超过 10MB：${tooLarge.map((f) => f.name).join("、")}`); return; }
    setUploadingAttachments(true); setError("");
    try {
      const uploaded = await uploadAgentFiles(picked);
      const next: PendingAttachment[] = uploaded.map((item, index) => {
        const source = picked[index];
        const previewUrl = item.kind === "image" && source ? URL.createObjectURL(source) : undefined;
        return { ...item, localId: `${item.path}-${Date.now()}-${index}`, previewUrl };
      });
      setPendingAttachments((prev) => [...prev, ...next]);
    } catch (err) { setError(err instanceof Error ? err.message : "上传失败"); }
    finally { setUploadingAttachments(false); }
  };

  const startRun = async () => {
    if (!agentId) return;
    const sentPrompt = prompt.trim();
    const attachmentPaths = pendingAttachments.map((item) => item.path);
    if (!sentPrompt && !attachmentPaths.length) return;
    const activeSessionRoot = sessionRootId || resolveSessionRoot(runs, selectedRunId) || "";
    const chain = activeSessionRoot ? runsInSession(runs, activeSessionRoot) : [];
    const previousRunId = chain.length ? chain[chain.length - 1].run_id : "";
    setBusy(true); setError("");
    try {
      const data = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/runs`, {
        method: "POST",
        body: JSON.stringify({
          prompt: sentPrompt || "请处理我上传的附件。",
          model,
          previous_run_id: previousRunId,
          attachments: attachmentPaths,
        }),
      }).then((res) => readJson<{ run: AgentRun }>(res));
      const newRun: AgentRun = {
        ...data.run,
        prompt: data.run.prompt || sentPrompt || "请处理我上传的附件。",
        signals: {
          ...(data.run.signals || {}),
          previous_run_id: ((data.run.signals?.previous_run_id as string) || "").trim() || previousRunId,
          attachments: attachmentPaths,
        },
      };
      const nextRoot = resolveSessionRoot([...runs, newRun], newRun.run_id) || newRun.run_id;
      setRuns((prev) => {
        const idx = prev.findIndex((run) => run.run_id === newRun.run_id);
        if (idx >= 0) { const next = [...prev]; next[idx] = newRun; return next; }
        return [newRun, ...prev];
      });
      setSelectedRunId(nextRoot); setPrompt("");
      for (const item of pendingAttachments) { if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl); }
      setPendingAttachments([]);
      void reloadSessions();
      void loadSessionRuns(nextRoot);
      void loadAgentFiles(true);
    } catch (err) { setError(err instanceof Error ? err.message : "运行失败"); }
    finally { setBusy(false); }
  };

  const cancelRun = async (runId: string) => {
    setBusy(true); setError("");
    try { await adminFetch(`/api/v1/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }).then((res) => readJson(res)); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "取消失败"); }
    finally { setBusy(false); }
  };

  const deleteSession = async (sessionId: string) => {
    if (!agentId) return;
    setBusy(true); setError("");
    try {
      await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).then((res) => readJson(res));
      if (runChain[0]?.run_id === sessionId) setSelectedRunId("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
    finally { setBusy(false); }
  };

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/profile`);
      const data = await res.json() as { profile?: AgentProfile };
      setProfileData(data.profile || null);
      setProfileDrawerOpen(true);
    } catch {
      setProfileData(null);
    } finally {
      setProfileLoading(false);
    }
  }, [agentId]);

  const onPromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || imeComposingRef.current) return;
    if (event.shiftKey) return;
    event.preventDefault();
    if (!busy && (prompt.trim() || pendingAttachments.length)) void startRun();
  };

  return (
    <div className="flex h-screen w-full bg-white text-slate-900">
      {/* ── Left toggle (when collapsed) ── */}
      {!leftOpen && (
        <button type="button" onClick={() => setLeftOpen(true)} className="absolute left-2 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-slate-200 hover:bg-slate-50" title="展开侧栏">
          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      )}

      {/* ── Left sidebar ── */}
      {leftOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <button type="button" onClick={() => navigate("/agent")} className="text-xs font-medium text-slate-500 hover:text-slate-800">← 返回</button>
            <button type="button" onClick={() => setLeftOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200" title="收起">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
          </div>

          {/* Agent card */}
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-sm font-bold text-white">{(agent?.name || "A").slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0">
                <button type="button" onClick={() => void loadProfile()} className="truncate text-sm font-semibold text-slate-900 hover:text-blue-600 cursor-pointer text-left w-full" title="查看身份设定">{agent?.name || "Agent"}</button>
                <div className="truncate font-mono text-[11px] text-slate-400">{agentId}</div>
              </div>
            </div>
            <Badge className="mt-2 border-slate-200 bg-white text-slate-600">🤖 {model || "claude-sonnet-4"}</Badge>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {/* ── History ── */}
            <div className="border-b border-slate-100">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">💬 对话历史</span>
                <button type="button" onClick={() => setExpandedSection(expandedSection === "history" ? null : "history")} className="rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-200">{expandedSection === "history" ? "收起" : "展开"}</button>
              </div>
              <div className={`px-3 pb-3 ${expandedSection === "history" ? "min-h-0 overflow-y-auto" : "overflow-hidden"}`}>
                {loading && !runs.length ? (
                  <div className="space-y-1.5">{[0, 1, 2].map((i) => (<div key={i} className="h-6 animate-pulse rounded bg-slate-200" />))}</div>
                ) : sessions.length ? (
                  <div className="space-y-0.5">
                    {(expandedSection === "history" ? sessions : sessions.slice(0, 3)).map((session) => {
                      const customTitle = sessionTitles[session.id] || "";
                      const displayTitle = customTitle || session.prompt;
                      const isEditing = editingSessionId === session.id;
                      const isActive = session.id === sessionRootId;
                      return (
                        <div key={session.id} className={`flex items-stretch gap-0.5 rounded-lg border transition ${isActive ? "border-slate-300 bg-white" : "border-transparent hover:bg-slate-100"}`}>
                          <button type="button" onClick={() => { if (!isEditing) setSelectedRunId(session.id); }} className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left">
                            <div className="flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[session.lastStatus].dot}`} />
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="w-full truncate rounded border border-slate-300 px-1 py-0 text-xs text-slate-700 outline-none focus:border-blue-400"
                                  defaultValue={displayTitle}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { saveSessionTitle(session.id, (e.target as HTMLInputElement).value); setEditingSessionId(""); }
                                    if (e.key === "Escape") setEditingSessionId("");
                                  }}
                                  onBlur={(e: React.FocusEvent<HTMLInputElement>) => { saveSessionTitle(session.id, e.target.value); setEditingSessionId(""); }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span className="truncate text-xs text-slate-700">{displayTitle}</span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 pl-3.5 text-[10px] text-slate-400">
                              <span>{session.count}轮</span><span>·</span><span>{formatDateTimeShort(session.lastAt)}</span>
                            </div>
                          </button>
                          {!isEditing && (
                            <button type="button" title="编辑标题" onClick={() => setEditingSessionId(session.id)} className="shrink-0 self-center rounded px-1 text-[10px] text-slate-300 hover:text-slate-500">✎</button>
                          )}
                          <button type="button" title="删除" onClick={() => void deleteSession(session.id)} className="shrink-0 self-center rounded px-1.5 text-[10px] text-slate-300 hover:text-red-500">×</button>
                        </div>
                      );
                    })}
                    <button type="button" onClick={() => { setSelectedRunId(""); setPrompt(""); }} className="mt-1 w-full rounded-md px-2.5 py-1 text-left text-[11px] font-medium text-slate-500 hover:bg-slate-100">＋ 新对话</button>
                  </div>
                ) : <p className="text-xs text-slate-400">暂无对话</p>}
              </div>
            </div>

            {/* ── Skills ── */}
            <div className="border-b border-slate-100">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">🧩 已下发技能 ({assignedSkills.length})</span>
                <button type="button" onClick={() => setExpandedSection(expandedSection === "skills" ? null : "skills")} className="rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-200">{expandedSection === "skills" ? "收起" : "展开"}</button>
              </div>
              <div className={`px-3 pb-3 ${expandedSection === "skills" ? "min-h-0 overflow-y-auto" : "overflow-hidden"}`}>
                {assignedSkills.length ? (
                  <div className="space-y-1.5">
                    {(expandedSection === "skills" ? assignedSkills : assignedSkills.slice(0, 2)).map((skill) => (
                      <div key={skill.id} className="rounded-lg border border-slate-100 bg-white px-2.5 py-2">
                        <div className="text-xs font-medium text-slate-800">{skill.name}</div>
                        {expandedSection === "skills" && skill.summary && <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-2">{skill.summary}</div>}
                        <div className="mt-0.5 text-[10px] text-slate-400">{skill.version ? `v${skill.version}` : ""}</div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-400">未下发技能</p>}
              </div>
            </div>

            {/* ── Knowledge ── */}
            <div>
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">📚 知识库 ({knowledgeItems.length})</span>
                <button type="button" onClick={() => setExpandedSection(expandedSection === "knowledge" ? null : "knowledge")} className="rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-200">{expandedSection === "knowledge" ? "收起" : "展开"}</button>
              </div>
              <div className={`px-3 pb-3 ${expandedSection === "knowledge" ? "min-h-0 overflow-y-auto" : "overflow-hidden"}`}>
                {knowledgeItems.length ? (
                  <div className="space-y-0.5">
                    {(expandedSection === "knowledge" ? knowledgeItems : knowledgeItems.slice(0, 3)).map((item) => (
                      <div key={item.id} className="rounded px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100">{item.title}{item.version ? <span className="ml-1 text-slate-400">v{item.version}</span> : null}</div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-400">暂无知识库</p>}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* ── Center ── */}
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        {error && <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
          {runChain.length > 0 ? (
            <div>
              {/* Load more history button */}
              {runChain.length > 0 && (
                <div className="flex justify-center py-3">
                  {hasMoreRuns ? (
                    <button
                      type="button"
                      onClick={() => loadMore()}
                      disabled={loadingMoreRef.current}
                      className="rounded-md border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {loadingMoreRef.current ? "加载中…" : "加载更多历史消息"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">没有更多消息</span>
                  )}
                </div>
              )}
              {runChain.map((run) => {
                const isLast = run.run_id === selectedRun?.run_id;
                const runEvents = eventsByRun[run.run_id] || [];
                const replyTexts = streamingAssistantTexts(runEvents);
                const replyFallback = runReplyFallback(run, runEvents);
                const hasReply = replyTexts.length > 0 || Boolean(replyFallback);
                const runRunning = (run.status === "running" || run.status === "queued") && !hasReply && !run.error;
                const attachments = runAttachmentPaths(run);
                const isHtmlRun = (run.artifact_manifest || []).some((a) => /\.html?$/i.test(a.path) && !a.path.startsWith(".evotown/"));
                return (
                  <div key={run.run_id}>
                    {/* User message */}
                    <div className="flex justify-end px-4 py-3">
                      <div className="max-w-[75%]">
                        <div className="flex items-center justify-end gap-2 mb-1">
                          <span className="text-[11px] text-slate-400">{formatDateTimeShort(run.created_at)}</span>
                          <span className="text-xs">👤</span>
                        </div>
                        <div className="rounded-2xl rounded-tr-md bg-slate-100 px-4 py-3 text-sm text-slate-800">
                          {run.prompt ? <p className="whitespace-pre-wrap">{run.prompt}</p> : null}
                          {attachments.length ? (
                            <div className={`space-y-2 ${run.prompt ? "mt-2" : ""}`}>
                              {attachments.map((path) => {
                                const name = path.split("/").pop() || path;
                                if (isImageAttachmentPath(path) && mediaBlobUrls[path]) {
                                  return <ClickableConversationImage key={path} src={mediaBlobUrls[path]} alt={name} onOpen={setLightboxImage} className="max-h-48 max-w-full rounded-lg border border-slate-200" />;
                                }
                                return <a key={path} href={`/api/v1/agents/${encodeURIComponent(agentId)}/files?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><span>📎</span><span className="truncate">{name}</span></a>;
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Agent reply */}
                    <div className="px-4 py-3">
                      {isHtmlRun && (
                        /* HTML tabs with URL bar */
                        <div className="mb-3">
                          <HtmlTabs
                            artifacts={(run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && /\.html?$/i.test(a.path))}
                            agentId={agentId}
                            htmlContents={htmlContents}
                          />
                        </div>
                      )}
                      {/* Agent message */}
                      <div className="max-w-[75%]">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs">🤖</span>
                            <span className="text-xs font-medium text-slate-600">Agent</span>
                            <span className="text-[11px] text-slate-400">{formatDateTimeFull(run.completed_at || run.created_at)}</span>
                          </div>
                          <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              {isLast && runRunning && <button type="button" onClick={() => void cancelRun(run.run_id)} disabled={busy} className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">取消</button>}
                            </div>
                            {runRunning ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-slate-500"><TypingDots /><span>Agent 正在执行…</span></div>
                                {(() => {
                                  const toolEvents = runEvents.filter(e => e.event_type === "tool_call" || e.event_type === "tool_result");
                                  const lastTool = toolEvents[toolEvents.length - 1];
                                  if (lastTool) {
                                    const info = describeEvent(lastTool);
                                    return <div className="flex items-center gap-1 text-[11px] text-slate-400"><span>{info.icon}</span><span>{info.detail}</span></div>;
                                  }
                                  return null;
                                })()}
                                <AssistantReplyBlocks texts={replyTexts} />
                              </div>
                            ) : isLast ? (
                              <div className="space-y-2">
                                <AssistantReplyBlocks texts={replyTexts} />
                                {!replyTexts.length && replyFallback ? (
                                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                                    <MarkdownContent>{replyFallback}</MarkdownContent>
                                  </div>
                                ) : null}
                                {run.status === "succeeded" && hasReply && (
                                  <div className="rounded-xl border border-green-200 bg-green-50/50 px-3 py-2 text-xs text-green-700">
                                    ✅ 执行完成
                                  </div>
                                )}
                                {run.status === "succeeded" && !hasReply && (
                                  <div className="rounded-xl border border-green-200 bg-green-50/50 px-3 py-2 text-xs text-green-700">
                                    ✅ 执行完成（无文本回复）
                                  </div>
                                )}
                                {run.status === "failed" && (
                                  <div className="rounded-xl border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700">
                                    ❌ 执行失败{(run.error ? `：${run.error.slice(0, 200)}` : "")}
                                  </div>
                                )}
                                {run.status === "cancelled" && (
                                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-700">
                                    ⏹ 已取消
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <AssistantReplyBlocks texts={replyTexts} />
                                {!replyTexts.length && replyFallback ? (
                                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                                    <MarkdownContent>{replyFallback}</MarkdownContent>
                                  </div>
                                ) : null}
                                {run.status === "succeeded" && !hasReply && (
                                  <div className="rounded-xl border border-green-200 bg-green-50/50 px-3 py-2 text-xs text-green-700">✅ 执行完成</div>
                                )}
                                {run.status === "failed" && (
                                  <div className="rounded-xl border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700">❌ 执行失败{(run.error ? `：${run.error.slice(0, 200)}` : "")}</div>
                                )}
                                {run.status === "cancelled" && (
                                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-700">⏹ 已取消</div>
                                )}
                              </div>
                            )}
                            {/* Webview inline — full width */}
                            {(() => {
                              const allText = [...replyTexts, replyFallback].filter(Boolean).join("\n");
                              return <WebviewIframes text={allText} />;
                            })()}
                            {/* Image/Video inline */}
                            {isLast && (run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)$/i.test(a.path)).length > 0 && (
                              <div className="mt-3 space-y-2">
                                {(run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)$/i.test(a.path)).map((a) => {
                                  const ext = a.path.split(".").pop()?.toLowerCase() || "";
                                  const isVideo = ext === "mp4" || ext === "webm";
                                  const blobUrl = mediaBlobUrls[a.path];
                                  if (isVideo) return <video key={a.path} controls className="max-h-80 max-w-full rounded-lg">{blobUrl ? <source src={blobUrl} type={`video/${ext}`} /> : null}</video>;
                                  return blobUrl ? <ClickableConversationImage key={a.path} src={blobUrl} alt={a.path.split("/").pop() || a.path} onOpen={setLightboxImage} className="max-h-80 max-w-full rounded-lg" /> : null;
                                })}
                              </div>
                            )}
                            {/* Toggles */}
                            {isLast && (run.log_excerpt || runEvents.length > 0 || ((run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && a.path !== ".mcp.json").length > 0)) && (
                              <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3">
                                {run.log_excerpt && <button type="button" onClick={() => setLogExpanded((v) => !v)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"><span>{logExpanded ? "▾" : "▸"}</span>执行日志</button>}
                                {runEvents.length > 0 && <button type="button" onClick={() => setEventsExpanded((v) => !v)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"><span>{eventsExpanded ? "▾" : "▸"}</span>事件时间线</button>}
                                {((run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && a.path !== ".mcp.json").length > 0) && <button type="button" onClick={() => setFilesExpanded((v) => !v)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"><span>{filesExpanded ? "▾" : "▸"}</span>文件 ({(run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && a.path !== ".mcp.json").length})</button>}
                              </div>
                            )}
                            {isLast && run.log_excerpt && logExpanded && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">{formatLog(run.log_excerpt)}</pre>}
                            {isLast && eventsExpanded && runEvents.length ? (
                              <div className="mt-2 space-y-1">{runEvents.map((ev) => { const info = describeEvent(ev); const time = ev.ts ? parseEvotownTimestamp(ev.ts) : null; return <div key={`${ev.id}-${ev.seq}`} className="flex items-center gap-2 text-xs"><span className="shrink-0 font-mono text-[10px] text-slate-300 w-[52px]">{time ? time.toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : ""}</span><span>{info.icon}</span><span className="text-slate-600">{info.title}</span>{info.detail ? <span className="truncate text-slate-400">· {info.detail}</span> : null}</div>; })}</div>
                            ) : null}
                            {isLast && filesExpanded && (
                              <div className="mt-2 space-y-1">{(run.artifact_manifest || []).filter((a) => !a.path.startsWith(".evotown/") && a.path !== ".mcp.json").map((a) => <a key={a.path} href={`/api/v1/agents/${encodeURIComponent(agentId)}/files?path=${encodeURIComponent(a.path)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><span>{fileMeta(a.path).icon}</span><span className="truncate flex-1">{a.path.split("/").pop() || a.path}</span><span className="shrink-0 text-slate-400">{formatBytes(a.bytes)}</span><span className="shrink-0 text-slate-300">↓</span></a>)}</div>
                            )}
                          </div>
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (loading || sessionLoading) && selectedRunId ? (
            <div className="space-y-4 p-4">
              {[0, 1].map((i) => (<div key={i} className="animate-pulse space-y-3"><div className="ml-auto h-16 w-2/3 max-w-[75%] rounded-2xl bg-slate-100" /><div className="h-24 w-4/5 max-w-[75%] rounded-2xl border border-slate-100 bg-white" /></div>))}
            </div>
          ) : loading ? (
            <div className="space-y-4 p-4">
              {[0, 1].map((i) => (<div key={i} className="animate-pulse space-y-3"><div className="ml-auto h-16 w-2/3 max-w-[75%] rounded-2xl bg-slate-100" /><div className="h-24 w-4/5 max-w-[75%] rounded-2xl border border-slate-100 bg-white" /></div>))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-2xl text-white">⌘</div>
                <div className="text-lg font-semibold text-slate-800">开始一段新的对话</div>
                <p className="mt-2 text-sm text-slate-500">在下方输入任务，Agent 会在该私有 agent 中执行。</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Input ── */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
          <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(event) => void handleAttachmentPick(event)} />
          {pendingAttachments.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map((item) => (
                <div key={item.localId} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm">
                  {item.kind === "image" && item.previewUrl ? <img src={item.previewUrl} alt={item.filename} className="h-10 w-10 rounded-md object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-base">📎</span>}
                  <span className="min-w-0"><span className="block max-w-[160px] truncate font-medium">{item.filename}</span><span className="text-[11px] text-slate-400">{formatBytes(item.bytes)}</span></span>
                  <button type="button" onClick={() => { setPendingAttachments((prev) => { const t = prev.find((p) => p.localId === item.localId); if (t?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(t.previewUrl); return prev.filter((p) => p.localId !== item.localId); }); }} className="rounded-md px-1.5 text-slate-400 hover:bg-slate-100">×</button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="rounded-2xl border border-slate-200 shadow-sm transition focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100">
            <textarea ref={textareaRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onCompositionStart={() => { imeComposingRef.current = true; }} onCompositionEnd={() => { imeComposingRef.current = false; }} onKeyDown={onPromptKeyDown} rows={1} placeholder="输入你的任务… (Enter 发送 · Shift+Enter 换行)" className="max-h-52 min-h-[3rem] w-full resize-none rounded-t-2xl px-4 pt-3 text-sm leading-relaxed outline-none" />
            <div className="flex items-center justify-between gap-2 px-3 pb-3">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || uploadingAttachments} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">📎 {uploadingAttachments ? "上传中…" : "附件"}</button>
              <button type="button" onClick={() => void startRun()} disabled={busy || uploadingAttachments || (!prompt.trim() && !pendingAttachments.length)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-900 disabled:opacity-50">{busy ? "提交中…" : "发送 →"}</button>
            </div>
          </div>
        </div>
      </main>

      {/* ── Right sidebar ── */}
      {!rightOpen && (
        <button type="button" onClick={() => setRightOpen(true)} className="absolute right-2 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-slate-200 hover:bg-slate-50" title="展开工作区文件"><svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
      )}
      {rightOpen && (
        <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">📂 工作区文件</span>
            <button type="button" onClick={() => setRightOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200" title="收起"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19l-7-7-7-7" /></svg></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
            <WorkspaceFileList
              entries={agentFiles}
              loading={agentFilesLoading}
              truncated={agentFilesTruncated}
              showSystemFiles={showSystemFiles}
              onToggleSystemFiles={() => setShowSystemFiles((value) => !value)}
              onOpenFile={(path) => void openFile(path)}
              fileLoadingPath={fileLoading}
              compact
            />
            {hasDevFiles ? (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center gap-1 min-w-0">
                  {devDirPath ? (
                    <button type="button" onClick={() => { const parent = devDirPath.split("/").slice(0, -1).join("/"); void loadDevDir(parent); }} className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800" title="返回上一层">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                  ) : null}
                  <span className="truncate text-[11px] font-medium text-slate-500">模板目录 /{devDirPath || ""}</span>
                </div>
                {devDirLoading ? <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-200" />)}</div>
                  : devDirFiles.length > 0 ? <div className="space-y-0.5">
                    {devDirFiles.map((f) => (f.is_dir ? <button key={f.path} type="button" onClick={() => void loadDevDir((devDirPath ? devDirPath + "/" : "") + f.path.replace(/\/$/, ""))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-200"><span>📁</span><span className="truncate text-slate-700">{f.name}</span></button>
                      : <button key={f.path} type="button" onClick={() => { const fullPath = [devDirPrefix, devDirPath, f.path].filter(Boolean).join("/"); void openFile(fullPath); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-200"><span>📄</span><span className="truncate text-slate-700">{f.name}</span><span className="shrink-0 text-[10px] text-slate-400">{formatBytes(f.size)}</span></button>))}
                  </div> : <p className="px-2 py-2 text-center text-xs text-slate-400">模板目录为空</p>}
              </div>
            ) : null}
          </div>
        </aside>
      )}

      {/* ── File viewer modal ── */}
      {fileViewer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setFileViewer(null)}>
          <div className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${contextArtifactPath(fileViewer.path) ? "max-w-4xl" : "max-w-2xl"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{fileViewer.path.split("/").pop() || fileViewer.path}</div><div className="truncate font-mono text-[11px] text-slate-400">{fileViewer.path}</div></div>
              <div className="flex items-center gap-3"><span className="text-[11px] text-slate-400">{formatBytes(fileViewer.size)}{fileViewer.truncated ? " · 已截断" : ""}</span><button type="button" onClick={() => setFileViewer(null)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">关闭</button></div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed text-slate-800">{fileViewer.content}</pre>
          </div>
        </div>
      )}
      <ImageLightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />

      {/* ── File error modal ── */}
      {fileError && <FileErrorModal err={fileError} onClose={() => setFileError(null)} />}

      {/* Agent profile drawer */}
      <GatewayDrawer open={profileDrawerOpen} title="智能体身份设定" onClose={() => setProfileDrawerOpen(false)}>
        {profileLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">加载中…</p>
        ) : profileData ? (
          <div className="space-y-5">
            {profileData.agent_type && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">类型</h4><p className="mt-1 text-sm text-slate-800">{profileData.agent_type}</p></div>}
            {profileData.soul && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">🧠 身份设定 (SOUL)</h4><div className="mt-1 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 max-h-60 overflow-y-auto">{profileData.soul}</div></div>}
            {profileData.paradigm && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">🔄 工作流 (Paradigm)</h4><div className="mt-1 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 max-h-60 overflow-y-auto">{profileData.paradigm}</div></div>}
            {profileData.standards && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">📏 工作规范 (Standards)</h4><div className="mt-1 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 max-h-60 overflow-y-auto">{profileData.standards}</div></div>}
            {profileData.default_model && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">🤖 默认模型</h4><p className="mt-1 text-sm font-mono text-slate-800">{profileData.default_model}</p></div>}
            {Array.isArray(profileData.default_skills) && profileData.default_skills.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">🧩 默认技能</h4><div className="mt-1 flex flex-wrap gap-1">{profileData.default_skills.map((s) => <span key={s} className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{s}</span>)}</div></div>}
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-400">暂无身份设定</p>}
      </GatewayDrawer>
    </div>
  );
}

// ── File error modal ────────────────────────────────────────────────────────

const KNOWN_ERRORS: Record<number, string> = {
  400: "请求参数错误，请联系管理员",
  401: "未授权访问，请重新登录",
  403: "无权限访问此文件",
  404: "文件不存在，可能已被移动或删除",
  413: "文件过大，无法打开",
  500: "服务器内部错误，请稍后重试",
  502: "网关错误，服务暂不可用",
  503: "服务暂不可用，请稍后重试",
};

function describeError(status: number | undefined, message: string): string {
  if (status && KNOWN_ERRORS[status]) return KNOWN_ERRORS[status];
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("network")) return "网络连接失败，请检查网络连接";
  if (lower.includes("not found")) return "文件不存在，可能已被移动或删除";
  if (lower.includes("permission") || lower.includes("forbidden")) return "权限不足，无法访问此文件";
  if (lower.includes("timeout")) return "请求超时，请稍后重试";
  return "";
}

function FileErrorModal({ err, onClose }: { err: { path: string; message: string; status?: number }; onClose: () => void }) {
  const zhDesc = describeError(err.status, err.message);
  const filename = err.path.split("/").pop() || err.path;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">无法打开文件</h3>
            <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{filename}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>

        {zhDesc && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            {zhDesc}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-medium text-slate-500 mb-0.5">原始错误</p>
          <p className="text-xs text-slate-700 font-mono break-all">{err.message}</p>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── WebviewIframes: detect webview URLs in text and embed as iframes ──────────

const WEBVIEW_URL_RE = /\/api\/v1\/webview\/([^\s)]+)/gi;

function WebviewIframes({ text }: { text: string }) {
  const urls = Array.from(text.matchAll(WEBVIEW_URL_RE), (m) => m[0]);
  if (!urls.length) return null;
  const unique = [...new Set(urls)];
  return (
    <div className="mt-3 space-y-3">
      {unique.map((url) => {
        const filename = url.split("/").pop() || url;
        return (
          <div key={url} className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
              <span className="flex items-center gap-2 text-xs">
                <span>🌐</span>
                <span className="font-medium text-slate-700">{filename}</span>
              </span>
              <a href={url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-700">
                新窗口打开 ↗
              </a>
            </div>
            <div className="w-full" style={{ height: "65vh", maxHeight: "560px" }}>
              <iframe src={url} className="w-full h-full border-0" title={filename} sandbox="allow-scripts allow-same-origin" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── HtmlTabs: tabbed HTML artifact viewer with URL bar ────────────────────────

type HtmlArtifact = { path: string; sha256: string; bytes: number };

function HtmlTabs({
  artifacts, agentId, htmlContents,
}: {
  artifacts: HtmlArtifact[];
  agentId: string;
  htmlContents: Record<string, string>;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const current = artifacts[activeIdx];
  if (!current) return null;

  const serveUrl = `/api/v1/agents/${encodeURIComponent(agentId)}/serve/${encodeURIComponent(current.path)}`;
  const filename = current.path.split("/").pop() || current.path;

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center bg-slate-50 border-b border-slate-100">
        <div className="flex-1 flex overflow-x-auto">
          {artifacts.map((a, i) => {
            const name = a.path.split("/").pop() || a.path;
            return (
              <button
                key={a.path}
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 px-3 py-2 text-xs border-b-2 transition-colors ${
                  i === activeIdx
                    ? "border-slate-800 text-slate-900 font-medium bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
        <a href={serveUrl} target="_blank" rel="noreferrer" className="shrink-0 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 border-l border-slate-200">
          新窗口打开 ↗
        </a>
      </div>
      {/* URL bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50/50 border-b border-slate-100 text-[10px] text-slate-400">
        <span className="shrink-0">🔗</span>
        <span className="truncate font-mono">{serveUrl}</span>
      </div>
      {/* Iframe */}
      <div className="w-full" style={{ height: "70vh", maxHeight: "600px" }}>
        {htmlContents[current.path] ? (
          <iframe
            srcDoc={htmlContents[current.path]}
            className="w-full h-full border-0"
            title={current.path}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-slate-400">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
