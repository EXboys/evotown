import { useEffect, useState, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";

type KnowledgeSourceType = "feishu" | "yuque" | "custom";

type KnowledgeSource = {
  source_id: string;
  source_type: KnowledgeSourceType;
  name: string;
  tenant_id?: string;
  team_id?: string;
  config?: Record<string, unknown>;
  status: "active" | "paused";
  last_sync_at?: string;
  last_sync_status?: string;
  last_sync_message?: string;
  document_count: number;
};

type KnowledgeDocument = {
  doc_id: string;
  source_id: string;
  title: string;
  url: string;
  space_name?: string;
  snippet?: string;
  tags?: string[];
  indexed_at?: string;
  source_type?: string;
  score?: number;
};

type KnowledgeStats = {
  active_sources: number;
  indexed_documents: number;
  by_source_type: Record<string, number>;
};

const SOURCE_META: Record<KnowledgeSourceType, { label: string; className: string; hint: string }> = {
  feishu: {
    label: "飞书",
    className: "border-blue-200 bg-blue-50 text-blue-700",
    hint: "app_id, app_secret, space_id（或 demo: true）",
  },
  yuque: {
    label: "语雀",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    hint: "token, login, book（或 demo: true）",
  },
  custom: {
    label: "自定义",
    className: "border-slate-200 bg-slate-50 text-slate-700",
    hint: "通过 Connector ingest 推送文档",
  },
};

export function KnowledgePanel() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [searchResults, setSearchResults] = useState<KnowledgeDocument[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [createForm, setCreateForm] = useState({
    source_id: "",
    source_type: "feishu" as KnowledgeSourceType,
    name: "",
    team_id: "",
    config_json: '{"demo": true}',
  });

  const load = () => {
    setLoading(true);
    Promise.all([
      adminFetch("/api/v1/knowledge/sources/manage?limit=100").then((r) => r.json() as Promise<{ sources?: KnowledgeSource[] }>),
      adminFetch("/api/v1/knowledge/documents?limit=30").then((r) => r.json() as Promise<{ documents?: KnowledgeDocument[] }>),
      adminFetch("/api/v1/knowledge/stats").then((r) => r.json() as Promise<KnowledgeStats>),
    ])
      .then(([sourceData, docData, statsData]) => {
        setSources(Array.isArray(sourceData.sources) ? sourceData.sources : []);
        setDocuments(Array.isArray(docData.documents) ? docData.documents : []);
        setStats(statsData);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "加载知识库失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const syncSource = async (source: KnowledgeSource) => {
    const res = await adminFetch(`/api/v1/knowledge/sources/${encodeURIComponent(source.source_id)}/sync`, { method: "POST" });
    if (!res.ok) {
      setMessage(`同步失败：${res.status}`);
      return;
    }
    const data = (await res.json()) as { sync?: { message?: string; document_count?: number } };
    setMessage(`已同步 ${source.name}，索引 ${data.sync?.document_count ?? 0} 篇文档。`);
    load();
  };

  const createSource = async () => {
    if (!createForm.source_id.trim() || !createForm.name.trim()) {
      setMessage("请填写 source_id 和名称。");
      return;
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(createForm.config_json) as Record<string, unknown>;
    } catch {
      setMessage("config JSON 格式无效。");
      return;
    }
    const res = await adminFetch("/api/v1/knowledge/sources", {
      method: "POST",
      body: JSON.stringify({
        source_id: createForm.source_id.trim(),
        source_type: createForm.source_type,
        name: createForm.name.trim(),
        team_id: createForm.team_id.trim(),
        config,
      }),
    });
    if (!res.ok) {
      setMessage(`创建失败：${res.status}`);
      return;
    }
    setMessage("知识源已创建。");
    setCreateForm({ source_id: "", source_type: "feishu", name: "", team_id: "", config_json: '{"demo": true}' });
    load();
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const res = await adminFetch(`/api/v1/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20`);
    if (!res.ok) {
      setMessage(`检索失败：${res.status}`);
      return;
    }
    const data = (await res.json()) as { results?: KnowledgeDocument[] };
    setSearchResults(Array.isArray(data.results) ? data.results : []);
  };

  const deleteSource = async (source: KnowledgeSource) => {
    if (!window.confirm(`确定删除知识源「${source.name}」及其索引文档？`)) return;
    const res = await adminFetch(`/api/v1/knowledge/sources/${encodeURIComponent(source.source_id)}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage(`删除失败：${res.status}`);
      return;
    }
    setMessage(`已删除 ${source.source_id}。`);
    load();
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="活跃知识源" value={stats?.active_sources ?? "-"} note="Feishu / Yuque / Custom" />
        <StatCard label="已索引文档" value={stats?.indexed_documents ?? "-"} note="FTS5 全文检索" />
        <StatCard label="飞书源" value={stats?.by_source_type?.feishu ?? 0} note="Lark Wiki connector" />
        <StatCard label="语雀源" value={stats?.by_source_type?.yuque ?? 0} note="Yuque Open API" />
      </section>

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}

      <Card className="p-5">
        <SectionHeader
          title="统一检索"
          subtitle="Agent runtime 通过 GET /api/v1/knowledge/search 查询企业文档"
          action={
            <button type="button" onClick={runSearch} className="text-sm font-medium text-blue-600 hover:text-blue-700">
              检索
            </button>
          }
        />
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="搜索文档标题与正文，例如 onboarding、定价、runbook..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <button type="button" onClick={runSearch} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            搜索
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-4 space-y-3">
            {searchResults.map((doc) => (
              <DocumentRow key={doc.doc_id} doc={doc} />
            ))}
          </div>
        )}
      </Card>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-5">
          <SectionHeader
            title="知识源 Connector"
            subtitle="按客户文档系统配置飞书 / 语雀；无凭证时可启用 demo 模式"
            action={
              <button type="button" onClick={load} className="text-sm font-medium text-blue-600">
                {loading ? "刷新中..." : "刷新"}
              </button>
            }
          />
          <div className="space-y-3">
            {sources.length ? (
              sources.map((source) => (
                <div key={source.source_id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-950">{source.name}</span>
                        <Badge className={SOURCE_META[source.source_type].className}>{SOURCE_META[source.source_type].label}</Badge>
                        <Badge className={source.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                          {source.status}
                        </Badge>
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{source.source_id}</div>
                      <div className="mt-2 text-sm text-slate-600">
                        {source.document_count} 篇文档
                        {source.last_sync_at ? ` · 上次同步 ${source.last_sync_at}` : ""}
                        {source.last_sync_status ? ` · ${source.last_sync_status}` : ""}
                      </div>
                      {source.last_sync_message && <div className="mt-1 text-xs text-slate-500">{source.last_sync_message}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => syncSource(source)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                        同步
                      </button>
                      {!source.source_id.endsWith("-demo") && (
                        <button type="button" onClick={() => deleteSource(source)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState>暂无知识源，请添加飞书或语雀 connector。</EmptyState>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="添加知识源" subtitle={SOURCE_META[createForm.source_type].hint} />
          <div className="space-y-3">
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={createForm.source_type}
              onChange={(e) => setCreateForm({ ...createForm, source_type: e.target.value as KnowledgeSourceType })}
            >
              <option value="feishu">飞书知识库</option>
              <option value="yuque">语雀知识库</option>
              <option value="custom">自定义（仅 ingest）</option>
            </select>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="source_id，例如 feishu-hr" value={createForm.source_id} onChange={(e) => setCreateForm({ ...createForm, source_id: e.target.value })} />
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="显示名称" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="team_id（可选）" value={createForm.team_id} onChange={(e) => setCreateForm({ ...createForm, team_id: e.target.value })} />
            <textarea className="h-28 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" value={createForm.config_json} onChange={(e) => setCreateForm({ ...createForm, config_json: e.target.value })} />
            <button type="button" onClick={createSource} className="w-full rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              创建并可在列表中同步
            </button>
          </div>
        </Card>
      </section>

      <Card className="p-5">
        <SectionHeader title="最近索引文档" subtitle="Connector sync 或 ingest 写入的文档摘要" />
        <div className="space-y-3">
          {documents.length ? documents.map((doc) => <DocumentRow key={doc.doc_id} doc={doc} />) : <EmptyState>暂无文档，请先同步知识源。</EmptyState>}
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader title="Connector Ingest" subtitle="外部 connector 使用 EVOTOWN_ENGINE_INGEST_TOKEN 推送文档" />
        <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">{`POST /api/v1/knowledge/documents/ingest
Authorization: Bearer $EVOTOWN_ENGINE_INGEST_TOKEN

{
  "source_id": "custom-crm",
  "documents": [{
    "external_id": "crm-pricing",
    "title": "CRM 定价策略",
    "url": "https://...",
    "content_text": "...",
    "tags": ["crm"]
  }]
}`}</pre>
      </Card>
    </div>
  );
}

function DocumentRow({ doc }: { doc: KnowledgeDocument }) {
  const type = doc.source_type as KnowledgeSourceType | undefined;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-950">{doc.title}</span>
        {type && SOURCE_META[type] && <Badge className={SOURCE_META[type].className}>{SOURCE_META[type].label}</Badge>}
      </div>
      {doc.space_name && <div className="mt-1 text-xs text-slate-500">{doc.space_name}</div>}
      {doc.snippet && <p className="mt-2 text-sm text-slate-600">{doc.snippet}</p>}
      {doc.url && (
        <a href={doc.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-blue-600 hover:text-blue-700">
          查看原文 →
        </a>
      )}
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{note}</div>
    </div>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className ?? ""}`}>{children}</div>;
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">{children}</div>;
}

