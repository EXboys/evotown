import { useEffect, useMemo, useState, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";

type KnowledgeSourceType = "feishu" | "yuque" | "custom" | "native";

type KnowledgeSource = {
  source_id: string;
  source_type: KnowledgeSourceType;
  name: string;
  status: "active" | "paused";
  last_sync_at?: string;
  last_sync_status?: string;
  document_count: number;
};

type KnowledgeSpace = {
  space_id: string;
  name: string;
  description?: string;
  team_id?: string;
  source_id: string;
};

type TreeFolder = {
  folder_id: string;
  name: string;
  parent_folder_id?: string;
  children?: TreeFolder[];
};

type TreeDocument = {
  doc_id: string;
  title: string;
  folder_id?: string;
  publish_status: "draft" | "published" | "deprecated";
  version?: number;
  external_id?: string;
};

type NativeDocument = {
  doc_id: string;
  external_id?: string;
  title: string;
  content_text: string;
  folder_id?: string;
  publish_status: "draft" | "published" | "deprecated";
  version?: number;
  author?: string;
  tags?: string[];
};

type SearchResult = {
  chunk_id?: string;
  doc_id: string;
  title: string;
  snippet?: string;
  heading?: string;
  chunk_index?: number;
  source_type?: string;
  space_name?: string;
  result_type?: string;
  citation?: {
    doc_id: string;
    title: string;
    heading?: string;
    chunk_index?: number;
    char_start?: number;
    char_end?: number;
  };
};

type KnowledgeStats = {
  active_sources: number;
  indexed_documents: number;
  indexed_chunks?: number;
  native_spaces?: number;
  by_source_type: Record<string, number>;
};

const SOURCE_META: Record<KnowledgeSourceType, { label: string; className: string }> = {
  feishu: { label: "飞书", className: "border-blue-200 bg-blue-50 text-blue-700" },
  yuque: { label: "语雀", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  custom: { label: "自定义", className: "border-slate-200 bg-slate-50 text-slate-700" },
  native: { label: "Native", className: "border-violet-200 bg-violet-50 text-violet-700" },
};

export function KnowledgePanel() {
  const [tab, setTab] = useState<"native" | "connectors">("native");
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [message, setMessage] = useState("");

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Native 空间" value={stats?.native_spaces ?? "-"} note="平台自管知识库" />
        <StatCard label="索引文档" value={stats?.indexed_documents ?? "-"} note="含 connector + native" />
        <StatCard label="索引分块" value={stats?.indexed_chunks ?? "-"} note="Citation chunks" />
        <StatCard label="活跃源" value={stats?.active_sources ?? "-"} note="Native / Feishu / Yuque" />
      </section>

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "native"} onClick={() => setTab("native")}>Native 知识库</TabButton>
        <TabButton active={tab === "connectors"} onClick={() => setTab("connectors")}>Connector 同步</TabButton>
      </div>

      <SearchSection onMessage={setMessage} />
      {tab === "native" ? <NativeKnowledgeSection onMessage={setMessage} onStats={setStats} /> : <ConnectorSection onMessage={setMessage} onStats={setStats} />}
    </div>
  );
}

function NativeKnowledgeSection({ onMessage, onStats }: { onMessage: (m: string) => void; onStats: (s: KnowledgeStats) => void }) {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [tree, setTree] = useState<{ folders: TreeFolder[]; documents: TreeDocument[] } | null>(null);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [editor, setEditor] = useState({ title: "", slug: "", folder_id: "", content_md: "", author: "", publish_status: "draft" as NativeDocument["publish_status"] });
  const [newSpace, setNewSpace] = useState({ space_id: "", name: "", description: "" });
  const [newFolder, setNewFolder] = useState({ folder_id: "", name: "", parent_folder_id: "" });

  const loadSpaces = () =>
    adminFetch("/api/v1/knowledge/spaces?limit=50")
      .then((r) => r.json() as Promise<{ spaces?: KnowledgeSpace[] }>)
      .then((data) => {
        const list = Array.isArray(data.spaces) ? data.spaces : [];
        setSpaces(list);
        if (!activeSpaceId && list.length) setActiveSpaceId(list[0].space_id);
      });

  const loadTree = (spaceId: string) => {
    if (!spaceId) return;
    adminFetch(`/api/v1/knowledge/spaces/${encodeURIComponent(spaceId)}/tree`)
      .then((r) => r.json() as Promise<{ folders?: TreeFolder[]; documents?: TreeDocument[] }>)
      .then((data) => setTree({ folders: data.folders ?? [], documents: data.documents ?? [] }));
  };

  const loadStats = () => adminFetch("/api/v1/knowledge/stats").then((r) => r.json() as Promise<KnowledgeStats>).then(onStats);

  useEffect(() => {
    loadSpaces().catch(() => onMessage("加载空间失败"));
    loadStats().catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSpaceId) loadTree(activeSpaceId);
  }, [activeSpaceId]);

  const openDoc = async (docId: string) => {
    setSelectedDocId(docId);
    const res = await adminFetch(`/api/v1/knowledge/documents/${encodeURIComponent(docId)}`);
    if (!res.ok) {
      onMessage(`加载文档失败：${res.status}`);
      return;
    }
    const data = (await res.json()) as { document?: NativeDocument };
    const doc = data.document;
    if (!doc) return;
    setEditor({
      title: doc.title,
      slug: doc.external_id ?? doc.doc_id.split(":").pop() ?? "",
      folder_id: doc.folder_id ?? "",
      content_md: doc.content_text ?? "",
      author: doc.author ?? "",
      publish_status: doc.publish_status ?? "draft",
    });
  };

  const createSpace = async () => {
    if (!newSpace.space_id.trim() || !newSpace.name.trim()) {
      onMessage("请填写 space_id 和名称。");
      return;
    }
    const res = await adminFetch("/api/v1/knowledge/spaces", {
      method: "POST",
      body: JSON.stringify(newSpace),
    });
    if (!res.ok) {
      onMessage(`创建空间失败：${res.status}`);
      return;
    }
    onMessage("Native 空间已创建。");
    setNewSpace({ space_id: "", name: "", description: "" });
    await loadSpaces();
    loadStats();
  };

  const createFolder = async () => {
    if (!activeSpaceId || !newFolder.folder_id.trim() || !newFolder.name.trim()) return;
    const res = await adminFetch(`/api/v1/knowledge/spaces/${encodeURIComponent(activeSpaceId)}/folders`, {
      method: "POST",
      body: JSON.stringify(newFolder),
    });
    if (!res.ok) {
      onMessage(`创建文件夹失败：${res.status}`);
      return;
    }
    onMessage("文件夹已创建。");
    setNewFolder({ folder_id: "", name: "", parent_folder_id: "" });
    loadTree(activeSpaceId);
  };

  const saveDoc = async (publish = false) => {
    if (!activeSpaceId) return;
    if (!editor.title.trim() || !editor.slug.trim()) {
      onMessage("请填写标题和 slug。");
      return;
    }
    if (selectedDocId) {
      const res = await adminFetch(`/api/v1/knowledge/native-docs/${encodeURIComponent(selectedDocId)}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editor.title,
          folder_id: editor.folder_id,
          content_md: editor.content_md,
          author: editor.author,
          publish_status: publish ? "published" : editor.publish_status,
        }),
      });
      if (!res.ok) {
        onMessage(`保存失败：${res.status}`);
        return;
      }
    } else {
      const res = await adminFetch(`/api/v1/knowledge/spaces/${encodeURIComponent(activeSpaceId)}/docs`, {
        method: "POST",
        body: JSON.stringify({
          slug: editor.slug,
          title: editor.title,
          folder_id: editor.folder_id,
          content_md: editor.content_md,
          author: editor.author,
          publish_status: publish ? "published" : "draft",
        }),
      });
      if (!res.ok) {
        onMessage(`创建失败：${res.status}`);
        return;
      }
      const data = (await res.json()) as { document?: NativeDocument };
      if (data.document?.doc_id) setSelectedDocId(data.document.doc_id);
    }
    onMessage(publish ? "文档已发布并重建分块索引。" : "草稿已保存。");
    loadTree(activeSpaceId);
    loadStats();
  };

  const newDoc = () => {
    setSelectedDocId("");
    setEditor({ title: "", slug: "", folder_id: "", content_md: "# 新文档\n\n", author: "", publish_status: "draft" });
  };

  const rootDocs = useMemo(
    () => (tree?.documents ?? []).filter((doc) => !doc.folder_id),
    [tree?.documents],
  );

  return (
    <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="p-4">
        <SectionHeader title="知识空间" subtitle="Evotown Native KB" />
        <select className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={activeSpaceId} onChange={(e) => setActiveSpaceId(e.target.value)}>
          {spaces.map((space) => (
            <option key={space.space_id} value={space.space_id}>{space.name}</option>
          ))}
        </select>
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder="space_id" value={newSpace.space_id} onChange={(e) => setNewSpace({ ...newSpace, space_id: e.target.value })} />
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder="空间名称" value={newSpace.name} onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })} />
          <button type="button" onClick={createSpace} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50">新建空间</button>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">目录树</span>
          <button type="button" onClick={newDoc} className="text-xs font-medium text-blue-600">+ 文档</button>
        </div>
        <div className="mt-2 max-h-[420px] space-y-1 overflow-y-auto text-sm">
          {tree?.folders.map((folder) => (
            <FolderNode key={folder.folder_id} folder={folder} documents={tree.documents} selectedDocId={selectedDocId} onSelect={openDoc} />
          ))}
          {rootDocs.map((doc) => (
            <DocNode key={doc.doc_id} doc={doc} selected={selectedDocId === doc.doc_id} onSelect={() => openDoc(doc.doc_id)} />
          ))}
        </div>
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder="folder_id" value={newFolder.folder_id} onChange={(e) => setNewFolder({ ...newFolder, folder_id: e.target.value })} />
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder="文件夹名称" value={newFolder.name} onChange={(e) => setNewFolder({ ...newFolder, name: e.target.value })} />
          <button type="button" onClick={createFolder} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50">新建文件夹</button>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader
          title={selectedDocId ? "编辑文档" : "新建文档"}
          subtitle="Markdown 内容；发布后自动分块并进入 citation 检索"
          action={
            <div className="flex gap-2">
              <button type="button" onClick={() => saveDoc(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">保存草稿</button>
              <button type="button" onClick={() => saveDoc(true)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">发布</button>
            </div>
          }
        />
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="标题" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono" placeholder="slug" value={editor.slug} disabled={!!selectedDocId} onChange={(e) => setEditor({ ...editor, slug: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="folder_id（可选）" value={editor.folder_id} onChange={(e) => setEditor({ ...editor, folder_id: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="作者" value={editor.author} onChange={(e) => setEditor({ ...editor, author: e.target.value })} />
        </div>
        <textarea className="mt-3 h-[420px] w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-sm leading-relaxed" value={editor.content_md} onChange={(e) => setEditor({ ...editor, content_md: e.target.value })} />
      </Card>
    </section>
  );
}

function FolderNode({
  folder,
  documents,
  selectedDocId,
  onSelect,
  depth = 0,
}: {
  folder: TreeFolder;
  documents: TreeDocument[];
  selectedDocId: string;
  onSelect: (docId: string) => void;
  depth?: number;
}) {
  const docs = documents.filter((doc) => doc.folder_id === folder.folder_id);
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div className="py-1 font-medium text-slate-700">📁 {folder.name}</div>
      {docs.map((doc) => (
        <DocNode key={doc.doc_id} doc={doc} selected={selectedDocId === doc.doc_id} onSelect={() => onSelect(doc.doc_id)} depth={depth + 1} />
      ))}
      {(folder.children ?? []).map((child) => (
        <FolderNode key={child.folder_id} folder={child} documents={documents} selectedDocId={selectedDocId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

function DocNode({ doc, selected, onSelect, depth = 0 }: { doc: TreeDocument; selected: boolean; onSelect: () => void; depth?: number }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ paddingLeft: depth * 12 }}
      className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${selected ? "bg-violet-50 text-violet-800" : "text-slate-600 hover:bg-slate-50"}`}
    >
      📄 {doc.title}
      <span className="ml-2 text-xs text-slate-400">{doc.publish_status}</span>
    </button>
  );
}

function SearchSection({ onMessage }: { onMessage: (m: string) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const runSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const res = await adminFetch(`/api/v1/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20`);
    if (!res.ok) {
      onMessage(`检索失败：${res.status}`);
      return;
    }
    const data = (await res.json()) as { results?: SearchResult[] };
    setSearchResults(Array.isArray(data.results) ? data.results : []);
  };

  return (
    <Card className="p-5">
      <SectionHeader title="分块检索（Citation）" subtitle="返回 chunk + 文档引用，供 Agent RAG 使用" />
      <div className="flex flex-col gap-3 md:flex-row">
        <input className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="搜索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
        <button type="button" onClick={runSearch} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">搜索</button>
      </div>
      {searchResults.length > 0 && (
        <div className="mt-4 space-y-3">
          {searchResults.map((item) => (
            <div key={item.chunk_id ?? item.doc_id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-950">{item.title}</span>
                {item.source_type && SOURCE_META[item.source_type as KnowledgeSourceType] && (
                  <Badge className={SOURCE_META[item.source_type as KnowledgeSourceType].className}>{SOURCE_META[item.source_type as KnowledgeSourceType].label}</Badge>
                )}
                {item.heading && <span className="text-xs text-slate-500">{item.heading}</span>}
              </div>
              {item.snippet && <p className="mt-2 text-sm text-slate-600">{item.snippet}</p>}
              {item.citation && (
                <div className="mt-2 rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-500">
                  citation: {item.citation.doc_id} · chunk {item.citation.chunk_index ?? 0}
                  {item.citation.char_start != null ? ` · [${item.citation.char_start}, ${item.citation.char_end}]` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ConnectorSection({ onMessage, onStats }: { onMessage: (m: string) => void; onStats: (s: KnowledgeStats) => void }) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [createForm, setCreateForm] = useState({ source_id: "", source_type: "feishu" as KnowledgeSourceType, name: "", team_id: "", config_json: '{"demo": true}' });

  const load = () => {
    setLoading(true);
    Promise.all([
      adminFetch("/api/v1/knowledge/sources/manage?limit=100").then((r) => r.json() as Promise<{ sources?: KnowledgeSource[] }>),
      adminFetch("/api/v1/knowledge/stats").then((r) => r.json() as Promise<KnowledgeStats>),
    ])
      .then(([sourceData, statsData]) => {
        setSources(Array.isArray(sourceData.sources) ? sourceData.sources.filter((s) => s.source_type !== "native") : []);
        onStats(statsData);
      })
      .catch((err) => onMessage(err instanceof Error ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const syncSource = async (source: KnowledgeSource) => {
    const res = await adminFetch(`/api/v1/knowledge/sources/${encodeURIComponent(source.source_id)}/sync`, { method: "POST" });
    if (!res.ok) return onMessage(`同步失败：${res.status}`);
    onMessage(`已同步 ${source.name}`);
    load();
  };

  const createSource = async () => {
    let config: Record<string, unknown>;
    try { config = JSON.parse(createForm.config_json) as Record<string, unknown>; } catch { return onMessage("config JSON 无效"); }
    const res = await adminFetch("/api/v1/knowledge/sources", {
      method: "POST",
      body: JSON.stringify({ ...createForm, config }),
    });
    if (!res.ok) return onMessage(`创建失败：${res.status}`);
    onMessage("Connector 已创建");
    load();
  };

  return (
    <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-5">
        <SectionHeader title="外部 Connector" subtitle="飞书 / 语雀 / ingest" action={<button type="button" onClick={load} className="text-sm text-blue-600">{loading ? "..." : "刷新"}</button>} />
        <div className="space-y-3">
          {sources.map((source) => (
            <div key={source.source_id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{source.name}</div>
                  <div className="text-xs text-slate-500">{source.source_id} · {source.document_count} docs</div>
                </div>
                <button type="button" onClick={() => syncSource(source)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">同步</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <SectionHeader title="添加 Connector" />
        <div className="space-y-3">
          <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={createForm.source_type} onChange={(e) => setCreateForm({ ...createForm, source_type: e.target.value as KnowledgeSourceType })}>
            <option value="feishu">飞书</option>
            <option value="yuque">语雀</option>
            <option value="custom">自定义 ingest</option>
          </select>
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="source_id" value={createForm.source_id} onChange={(e) => setCreateForm({ ...createForm, source_id: e.target.value })} />
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="名称" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
          <textarea className="h-24 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" value={createForm.config_json} onChange={(e) => setCreateForm({ ...createForm, config_json: e.target.value })} />
          <button type="button" onClick={createSource} className="w-full rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white">创建</button>
        </div>
      </Card>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-4 py-2 text-sm font-medium ${active ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
      {children}
    </button>
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

