import { useEffect, useMemo, useState, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

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

const SOURCE_META: Record<KnowledgeSourceType, { label: Record<Locale, string>; className: string }> = {
  feishu: { label: { zh: "飞书", en: "Feishu" }, className: "border-blue-200 bg-blue-50 text-blue-700" },
  yuque: { label: { zh: "语雀", en: "Yuque" }, className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  custom: { label: { zh: "自定义", en: "Custom" }, className: "border-slate-200 bg-slate-50 text-slate-700" },
  native: { label: { zh: "Native", en: "Native" }, className: "border-violet-200 bg-violet-50 text-violet-700" },
};

const KNOWLEDGE_COPY = {
  zh: {
    stats: {
      nativeSpaces: ["Native 空间", "平台自管知识库"],
      indexedDocs: ["索引文档", "含 connector + native"],
      indexedChunks: ["索引分块", "Citation chunks"],
      activeSources: ["活跃源", "Native / Feishu / Yuque"],
    },
    tabs: { native: "Native 知识库", connectors: "Connector 同步" },
    messages: {
      loadSpacesFailed: "加载空间失败",
      loadDocFailed: "加载文档失败",
      fillSpace: "请填写 space_id 和名称。",
      createSpaceFailed: "创建空间失败",
      spaceCreated: "Native 空间已创建。",
      createFolderFailed: "创建文件夹失败",
      folderCreated: "文件夹已创建。",
      fillDoc: "请填写标题和 slug。",
      saveFailed: "保存失败",
      createFailed: "创建失败",
      published: "文档已发布并重建分块索引。",
      draftSaved: "草稿已保存。",
      newDocTemplate: "# 新文档\n\n",
      searchFailed: "检索失败",
      loadFailed: "加载失败",
      syncFailed: "同步失败",
      synced: "已同步",
      invalidConfig: "config JSON 无效",
      connectorCreated: "Connector 已创建",
    },
    native: {
      spacesTitle: "知识空间",
      spaceName: "空间名称",
      createSpace: "新建空间",
      tree: "目录树",
      addDoc: "+ 文档",
      folderName: "文件夹名称",
      createFolder: "新建文件夹",
      editDoc: "编辑文档",
      newDoc: "新建文档",
      editorSubtitle: "Markdown 内容；发布后自动分块并进入 citation 检索",
      saveDraft: "保存草稿",
      publish: "发布",
      title: "标题",
      folderOptional: "folder_id（可选）",
      author: "作者",
    },
    search: {
      title: "分块检索（Citation）",
      subtitle: "返回 chunk + 文档引用，供 Agent RAG 使用",
      placeholder: "搜索...",
      button: "搜索",
    },
    connectors: {
      title: "外部 Connector",
      subtitle: "飞书 / 语雀 / ingest",
      refresh: "刷新",
      sync: "同步",
      addTitle: "添加 Connector",
      customIngest: "自定义 ingest",
      name: "名称",
      create: "创建",
      docs: "docs",
    },
  },
  en: {
    stats: {
      nativeSpaces: ["Native Spaces", "Platform-managed KB"],
      indexedDocs: ["Indexed Docs", "connector + native"],
      indexedChunks: ["Indexed Chunks", "Citation chunks"],
      activeSources: ["Active Sources", "Native / Feishu / Yuque"],
    },
    tabs: { native: "Native Knowledge", connectors: "Connector Sync" },
    messages: {
      loadSpacesFailed: "Failed to load spaces",
      loadDocFailed: "Failed to load document",
      fillSpace: "Please fill in space_id and name.",
      createSpaceFailed: "Failed to create space",
      spaceCreated: "Native space created.",
      createFolderFailed: "Failed to create folder",
      folderCreated: "Folder created.",
      fillDoc: "Please fill in title and slug.",
      saveFailed: "Save failed",
      createFailed: "Create failed",
      published: "Document published and citation chunks rebuilt.",
      draftSaved: "Draft saved.",
      newDocTemplate: "# New document\n\n",
      searchFailed: "Search failed",
      loadFailed: "Load failed",
      syncFailed: "Sync failed",
      synced: "Synced",
      invalidConfig: "Invalid config JSON",
      connectorCreated: "Connector created",
    },
    native: {
      spacesTitle: "Knowledge Spaces",
      spaceName: "Space name",
      createSpace: "Create Space",
      tree: "Directory Tree",
      addDoc: "+ Document",
      folderName: "Folder name",
      createFolder: "Create Folder",
      editDoc: "Edit Document",
      newDoc: "New Document",
      editorSubtitle: "Markdown content; publishing automatically chunks it for citation search",
      saveDraft: "Save Draft",
      publish: "Publish",
      title: "Title",
      folderOptional: "folder_id (optional)",
      author: "Author",
    },
    search: {
      title: "Chunk Search (Citation)",
      subtitle: "Return chunks and document citations for Agent RAG",
      placeholder: "Search...",
      button: "Search",
    },
    connectors: {
      title: "External Connectors",
      subtitle: "Feishu / Yuque / ingest",
      refresh: "Refresh",
      sync: "Sync",
      addTitle: "Add Connector",
      customIngest: "Custom ingest",
      name: "Name",
      create: "Create",
      docs: "docs",
    },
  },
} as const;

type KnowledgeCopy = (typeof KNOWLEDGE_COPY)[Locale];

export function KnowledgePanel({ locale = "zh" }: { locale?: Locale }) {
  const copy = KNOWLEDGE_COPY[locale];
  const [tab, setTab] = useState<"native" | "connectors">("native");
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [message, setMessage] = useState("");

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label={copy.stats.nativeSpaces[0]} value={stats?.native_spaces ?? "-"} note={copy.stats.nativeSpaces[1]} />
        <StatCard label={copy.stats.indexedDocs[0]} value={stats?.indexed_documents ?? "-"} note={copy.stats.indexedDocs[1]} />
        <StatCard label={copy.stats.indexedChunks[0]} value={stats?.indexed_chunks ?? "-"} note={copy.stats.indexedChunks[1]} />
        <StatCard label={copy.stats.activeSources[0]} value={stats?.active_sources ?? "-"} note={copy.stats.activeSources[1]} />
      </section>

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "native"} onClick={() => setTab("native")}>{copy.tabs.native}</TabButton>
        <TabButton active={tab === "connectors"} onClick={() => setTab("connectors")}>{copy.tabs.connectors}</TabButton>
      </div>

      <SearchSection copy={copy} locale={locale} onMessage={setMessage} />
      {tab === "native" ? <NativeKnowledgeSection copy={copy} onMessage={setMessage} onStats={setStats} /> : <ConnectorSection copy={copy} locale={locale} onMessage={setMessage} onStats={setStats} />}
    </div>
  );
}

function NativeKnowledgeSection({ copy, onMessage, onStats }: { copy: KnowledgeCopy; onMessage: (m: string) => void; onStats: (s: KnowledgeStats) => void }) {
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
    loadSpaces().catch(() => onMessage(copy.messages.loadSpacesFailed));
    loadStats().catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSpaceId) loadTree(activeSpaceId);
  }, [activeSpaceId]);

  const openDoc = async (docId: string) => {
    setSelectedDocId(docId);
    const res = await adminFetch(`/api/v1/knowledge/documents/${encodeURIComponent(docId)}`);
    if (!res.ok) {
      onMessage(`${copy.messages.loadDocFailed}: ${res.status}`);
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
      onMessage(copy.messages.fillSpace);
      return;
    }
    const res = await adminFetch("/api/v1/knowledge/spaces", {
      method: "POST",
      body: JSON.stringify(newSpace),
    });
    if (!res.ok) {
      onMessage(`${copy.messages.createSpaceFailed}: ${res.status}`);
      return;
    }
    onMessage(copy.messages.spaceCreated);
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
      onMessage(`${copy.messages.createFolderFailed}: ${res.status}`);
      return;
    }
    onMessage(copy.messages.folderCreated);
    setNewFolder({ folder_id: "", name: "", parent_folder_id: "" });
    loadTree(activeSpaceId);
  };

  const saveDoc = async (publish = false) => {
    if (!activeSpaceId) return;
    if (!editor.title.trim() || !editor.slug.trim()) {
      onMessage(copy.messages.fillDoc);
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
        onMessage(`${copy.messages.saveFailed}: ${res.status}`);
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
        onMessage(`${copy.messages.createFailed}: ${res.status}`);
        return;
      }
      const data = (await res.json()) as { document?: NativeDocument };
      if (data.document?.doc_id) setSelectedDocId(data.document.doc_id);
    }
    onMessage(publish ? copy.messages.published : copy.messages.draftSaved);
    loadTree(activeSpaceId);
    loadStats();
  };

  const newDoc = () => {
    setSelectedDocId("");
    setEditor({ title: "", slug: "", folder_id: "", content_md: copy.messages.newDocTemplate, author: "", publish_status: "draft" });
  };

  const rootDocs = useMemo(
    () => (tree?.documents ?? []).filter((doc) => !doc.folder_id),
    [tree?.documents],
  );

  return (
    <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="p-4">
        <SectionHeader title={copy.native.spacesTitle} subtitle="Evotown Native KB" />
        <select className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={activeSpaceId} onChange={(e) => setActiveSpaceId(e.target.value)}>
          {spaces.map((space) => (
            <option key={space.space_id} value={space.space_id}>{space.name}</option>
          ))}
        </select>
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder="space_id" value={newSpace.space_id} onChange={(e) => setNewSpace({ ...newSpace, space_id: e.target.value })} />
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder={copy.native.spaceName} value={newSpace.name} onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })} />
          <button type="button" onClick={createSpace} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50">{copy.native.createSpace}</button>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{copy.native.tree}</span>
          <button type="button" onClick={newDoc} className="text-xs font-medium text-blue-600">{copy.native.addDoc}</button>
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
          <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" placeholder={copy.native.folderName} value={newFolder.name} onChange={(e) => setNewFolder({ ...newFolder, name: e.target.value })} />
          <button type="button" onClick={createFolder} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50">{copy.native.createFolder}</button>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader
          title={selectedDocId ? copy.native.editDoc : copy.native.newDoc}
          subtitle={copy.native.editorSubtitle}
          action={
            <div className="flex gap-2">
              <button type="button" onClick={() => saveDoc(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">{copy.native.saveDraft}</button>
              <button type="button" onClick={() => saveDoc(true)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">{copy.native.publish}</button>
            </div>
          }
        />
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.native.title} value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono" placeholder="slug" value={editor.slug} disabled={!!selectedDocId} onChange={(e) => setEditor({ ...editor, slug: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.native.folderOptional} value={editor.folder_id} onChange={(e) => setEditor({ ...editor, folder_id: e.target.value })} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.native.author} value={editor.author} onChange={(e) => setEditor({ ...editor, author: e.target.value })} />
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

function SearchSection({ copy, locale, onMessage }: { copy: KnowledgeCopy; locale: Locale; onMessage: (m: string) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const runSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const res = await adminFetch(`/api/v1/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20`);
    if (!res.ok) {
      onMessage(`${copy.messages.searchFailed}: ${res.status}`);
      return;
    }
    const data = (await res.json()) as { results?: SearchResult[] };
    setSearchResults(Array.isArray(data.results) ? data.results : []);
  };

  return (
    <Card className="p-5">
      <SectionHeader title={copy.search.title} subtitle={copy.search.subtitle} />
      <div className="flex flex-col gap-3 md:flex-row">
        <input className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.search.placeholder} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
        <button type="button" onClick={runSearch} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">{copy.search.button}</button>
      </div>
      {searchResults.length > 0 && (
        <div className="mt-4 space-y-3">
          {searchResults.map((item) => (
            <div key={item.chunk_id ?? item.doc_id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-950">{item.title}</span>
                {item.source_type && SOURCE_META[item.source_type as KnowledgeSourceType] && (
                  <Badge className={SOURCE_META[item.source_type as KnowledgeSourceType].className}>{SOURCE_META[item.source_type as KnowledgeSourceType].label[locale]}</Badge>
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

function ConnectorSection({ copy, locale, onMessage, onStats }: { copy: KnowledgeCopy; locale: Locale; onMessage: (m: string) => void; onStats: (s: KnowledgeStats) => void }) {
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
      .catch((err) => onMessage(err instanceof Error ? err.message : copy.messages.loadFailed))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const syncSource = async (source: KnowledgeSource) => {
    const res = await adminFetch(`/api/v1/knowledge/sources/${encodeURIComponent(source.source_id)}/sync`, { method: "POST" });
    if (!res.ok) return onMessage(`${copy.messages.syncFailed}: ${res.status}`);
    onMessage(`${copy.messages.synced} ${source.name}`);
    load();
  };

  const createSource = async () => {
    let config: Record<string, unknown>;
    try { config = JSON.parse(createForm.config_json) as Record<string, unknown>; } catch { return onMessage(copy.messages.invalidConfig); }
    const res = await adminFetch("/api/v1/knowledge/sources", {
      method: "POST",
      body: JSON.stringify({ ...createForm, config }),
    });
    if (!res.ok) return onMessage(`${copy.messages.createFailed}: ${res.status}`);
    onMessage(copy.messages.connectorCreated);
    load();
  };

  return (
    <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-5">
        <SectionHeader title={copy.connectors.title} subtitle={copy.connectors.subtitle} action={<button type="button" onClick={load} className="text-sm text-blue-600">{loading ? "..." : copy.connectors.refresh}</button>} />
        <div className="space-y-3">
          {sources.map((source) => (
            <div key={source.source_id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{source.name}</div>
                  <div className="text-xs text-slate-500">{source.source_id} · {source.document_count} {copy.connectors.docs}</div>
                </div>
                <button type="button" onClick={() => syncSource(source)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">{copy.connectors.sync}</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <SectionHeader title={copy.connectors.addTitle} />
        <div className="space-y-3">
          <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={createForm.source_type} onChange={(e) => setCreateForm({ ...createForm, source_type: e.target.value as KnowledgeSourceType })}>
            <option value="feishu">{SOURCE_META.feishu.label[locale]}</option>
            <option value="yuque">{SOURCE_META.yuque.label[locale]}</option>
            <option value="custom">{copy.connectors.customIngest}</option>
          </select>
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="source_id" value={createForm.source_id} onChange={(e) => setCreateForm({ ...createForm, source_id: e.target.value })} />
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.connectors.name} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
          <textarea className="h-24 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" value={createForm.config_json} onChange={(e) => setCreateForm({ ...createForm, config_json: e.target.value })} />
          <button type="button" onClick={createSource} className="w-full rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white">{copy.connectors.create}</button>
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

