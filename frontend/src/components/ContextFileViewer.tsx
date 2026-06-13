import { useMemo, useState, type ReactNode } from "react";
import { MarkdownContent } from "./MarkdownContent";

type ContextFileViewerProps = {
  path: string;
  content: string;
};

type ViewMode = "structured" | "raw";

export function contextArtifactPath(path: string): boolean {
  return path.startsWith(".evotown/") || path === ".mcp.json";
}

export function contextArtifactMeta(path: string): {
  title: string;
  subtitle: string;
  icon: string;
  badgeClass: string;
} {
  const base = path.split("/").pop() || path;
  const map: Record<string, { title: string; subtitle: string; icon: string; badgeClass: string }> = {
    "AGENT_CONTEXT.md": {
      title: "Agent 上下文",
      subtitle: "运行说明 · 技能与知识索引",
      icon: "📋",
      badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
    },
    "skills_manifest.json": {
      title: "Skills 清单",
      subtitle: "已注入的技能包与选择模式",
      icon: "🧩",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    },
    "knowledge_context.json": {
      title: "知识库检索",
      subtitle: "本次 prompt 命中的知识片段",
      icon: "📚",
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    "mcp_context.json": {
      title: "MCP / 数据库",
      subtitle: "数据库连接器与工具说明",
      icon: "🔌",
      badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
    },
    "conversation_context.md": {
      title: "对话续接",
      subtitle: "上一轮 prompt 与结果摘要",
      icon: "💬",
      badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
    },
    ".mcp.json": {
      title: "MCP 服务配置",
      subtitle: "Claude Code MCP server 定义",
      icon: "⚙️",
      badgeClass: "border-slate-200 bg-slate-100 text-slate-700",
    },
  };
  return (
    map[base] || {
      title: base,
      subtitle: path,
      icon: "📁",
      badgeClass: "border-slate-200 bg-slate-50 text-slate-600",
    }
  );
}

function tryParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function MetaGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  const visible = items.filter((item) => item.value);
  if (!visible.length) return null;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {visible.map((item) => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-[11px] font-medium text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 break-all text-sm text-slate-800">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SkillsManifestView({ data }: { data: Record<string, unknown> }) {
  const skills = asArray(data.skills).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  return (
    <div className="space-y-4">
      <MetaGrid
        items={[
          { label: "Bundle", value: str(data.bundle_id) },
          { label: "选择模式", value: str(data.selection_mode) },
          { label: "版本", value: str(data.version) },
          { label: "技能数量", value: String(skills.length) },
        ]}
      />
      <Section title={`Skills (${skills.length})`}>
        {skills.length ? (
          <div className="space-y-2">
            {skills.map((skill, index) => {
              const id = str(skill.skill_id) || `skill-${index}`;
              return (
                <div key={id} className="rounded-lg border border-amber-200/80 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{str(skill.name) || id}</span>
                    <code className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">{id}</code>
                  </div>
                  {str(skill.summary) || str(skill.description) ? (
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {str(skill.summary) || str(skill.description)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">未挂载技能。</p>
        )}
      </Section>
    </div>
  );
}

function KnowledgeContextView({ data }: { data: Record<string, unknown> }) {
  const results = asArray(data.results).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const tool = asRecord(data.tool);
  return (
    <div className="space-y-4">
      <Section title="检索 Query">
        <p className="text-sm leading-relaxed text-slate-800">{str(data.query) || "（空）"}</p>
        {tool ? (
          <p className="mt-2 text-xs text-slate-500">
            工具 <code className="rounded bg-white px-1 py-0.5">{str(tool.name)}</code>
            {str(tool.endpoint) ? ` · ${str(tool.endpoint)}` : ""}
          </p>
        ) : null}
      </Section>
      <Section title={`命中结果 (${results.length})`}>
        {results.length ? (
          <div className="space-y-2">
            {results.map((hit, index) => {
              const title = str(hit.title) || str(hit.doc_id) || `结果 ${index + 1}`;
              const body = str(hit.content) || str(hit.snippet) || str(hit.text);
              const score = hit.score ?? hit.rank;
              return (
                <div key={`${title}-${index}`} className="rounded-lg border border-emerald-200/80 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 font-medium text-slate-900">{title}</div>
                    {score != null ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        score {typeof score === "number" ? score.toFixed(3) : str(score)}
                      </span>
                    ) : null}
                  </div>
                  {str(hit.source_id) ? (
                    <div className="mt-1 text-[11px] text-slate-400">来源 {str(hit.source_id)}</div>
                  ) : null}
                  {body ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{body}</p> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">未命中知识库片段。</p>
        )}
      </Section>
    </div>
  );
}

function McpContextView({ data }: { data: Record<string, unknown> }) {
  const connections = asArray(data.connections).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const toolSkill = str(data.tool_skill);
  return (
    <div className="space-y-4">
      <MetaGrid
        items={[
          { label: "选择模式", value: str(data.selection_mode) },
          { label: "关联 Skill", value: toolSkill },
          { label: "连接器数量", value: String(connections.length) },
        ]}
      />
      <Section title={`连接器 (${connections.length})`}>
        {connections.length ? (
          <div className="space-y-2">
            {connections.map((conn, index) => {
              const id = str(conn.connection_id) || str(conn.name) || `conn-${index}`;
              return (
                <div key={id} className="rounded-lg border border-sky-200/80 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{str(conn.name) || id}</span>
                    {str(conn.db_type) ? (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">{str(conn.db_type)}</span>
                    ) : null}
                    {str(conn.permission) ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        {str(conn.permission)}
                      </span>
                    ) : null}
                  </div>
                  {str(conn.mcp_server_url) ? (
                    <div className="mt-2 break-all font-mono text-xs text-slate-500">{str(conn.mcp_server_url)}</div>
                  ) : null}
                  {str(conn.usage) ? <p className="mt-2 text-sm text-slate-600">{str(conn.usage)}</p> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">未配置 MCP 连接器。</p>
        )}
      </Section>
    </div>
  );
}

function McpServersView({ data }: { data: Record<string, unknown> }) {
  const servers = asRecord(data.mcpServers) || {};
  const entries = Object.entries(servers);
  return (
    <Section title={`MCP Servers (${entries.length})`}>
      {entries.length ? (
        <div className="space-y-2">
          {entries.map(([name, value]) => {
            const server = asRecord(value);
            return (
              <div key={name} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="font-medium text-slate-900">{name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {str(server?.type) || "http"}
                  {str(server?.url) ? ` · ${str(server?.url)}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500">无 MCP server 条目。</p>
      )}
    </Section>
  );
}

function JsonTreeNode({ name, value, depth = 0 }: { name?: string; value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (value === null || typeof value !== "object") {
    return (
      <div className="flex gap-2 py-0.5 text-xs" style={{ paddingLeft: depth * 12 }}>
        {name ? <span className="shrink-0 text-slate-500">{name}:</span> : null}
        <span className="break-all font-mono text-slate-800">{JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <div style={{ paddingLeft: depth ? 12 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 py-0.5 text-left text-xs font-medium text-slate-700 hover:text-indigo-700"
      >
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        {name ? <span>{name}</span> : <span className="text-slate-500">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>}
      </button>
      {open ? (
        <div>
          {entries.map(([key, child]) => (
            <JsonTreeNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StructuredContextView({ path, content }: { path: string; content: string }) {
  const parsed = useMemo(() => tryParseJson(content), [content]);
  const base = path.split("/").pop() || path;

  if (path.toLowerCase().endsWith(".md")) {
    return <MarkdownContent>{content}</MarkdownContent>;
  }

  const record = asRecord(parsed);
  if (!record) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-800">{content}</pre>
    );
  }

  if (base === "skills_manifest.json") return <SkillsManifestView data={record} />;
  if (base === "knowledge_context.json") return <KnowledgeContextView data={record} />;
  if (base === "mcp_context.json") return <McpContextView data={record} />;
  if (base === ".mcp.json" || path.endsWith(".mcp.json")) return <McpServersView data={record} />;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <JsonTreeNode value={record} />
    </div>
  );
}

export function ContextFileViewer({ path, content }: ContextFileViewerProps) {
  const [mode, setMode] = useState<ViewMode>("structured");
  const meta = contextArtifactMeta(path);
  const canStructure = path.toLowerCase().endsWith(".json") || path.toLowerCase().endsWith(".md");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.badgeClass}`}>
          <span aria-hidden>{meta.icon}</span>
          {meta.title}
        </span>
        {canStructure ? (
          <div className="ml-auto inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setMode("structured")}
              className={`rounded-md px-2.5 py-1 font-medium ${mode === "structured" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              结构化
            </button>
            <button
              type="button"
              onClick={() => setMode("raw")}
              className={`rounded-md px-2.5 py-1 font-medium ${mode === "raw" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              原始
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4">
        {mode === "raw" || !canStructure ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-800">
            {path.toLowerCase().endsWith(".json") ? prettyJson(content) : content}
          </pre>
        ) : (
          <StructuredContextView path={path} content={content} />
        )}
      </div>
    </div>
  );
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** 上下文文件展示顺序（侧栏用）。 */
export function sortContextArtifacts<T extends { path: string }>(items: T[]): T[] {
  const order = [
    ".evotown/AGENT_CONTEXT.md",
    ".evotown/skills_manifest.json",
    ".evotown/knowledge_context.json",
    ".evotown/mcp_context.json",
    ".evotown/conversation_context.md",
    ".mcp.json",
  ];
  const rank = new Map(order.map((path, index) => [path, index]));
  return [...items].sort((a, b) => {
    const ai = rank.get(a.path) ?? 100 + a.path.localeCompare(b.path);
    const bi = rank.get(b.path) ?? 100 + b.path.localeCompare(a.path);
    return ai - bi;
  });
}
