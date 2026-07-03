import { useEffect, useMemo, useState } from "react";

import { useLocale } from "../lib/i18n";
import { PublicSiteHeader } from "./PublicSiteHeader";
import { canAccessAdminConsole } from "../hooks/useAdminToken";

type KnowledgeSpace = {
  space_id: string;
  name: string;
  description?: string;
  team_id?: string;
};

type TreeDocument = {
  doc_id: string;
  title: string;
  folder_id?: string;
  publish_status: string;
};

type SearchResult = {
  doc_id: string;
  title: string;
  snippet?: string;
  heading?: string;
  source_type?: string;
  space_name?: string;
};

type PublicSource = {
  source_id: string;
  source_type: string;
  name: string;
  document_count: number;
  last_sync_at?: string;
};

type PublicDoc = {
  doc_id: string;
  title: string;
  content_text?: string;
  content_snippet?: string;
  space_name?: string;
  source_type?: string;
  url?: string;
};

const COPY = {
  zh: {
    eyebrow: "Enterprise Knowledge",
    title: "企业知识库",
    subtitle: "浏览已发布的内部文档与检索结果，供团队与 Agent 引用。",
    subtitleAdmin: "浏览已发布的内部文档与检索结果，供团队与 Agent 引用。管理同步与发布请至",
    subtitleEmployee: "浏览已发布的内部文档与检索结果，供团队与 Agent 引用。管理同步与发布请联系管理员。",
    manageLink: "企业后台",
    searchPlaceholder: "搜索文档标题与内容…",
    search: "搜索",
    stats: { spaces: "知识空间", sources: "数据源", docs: "索引文档" },
    spaces: "知识空间",
    sources: "已接入数据源",
    published: "已发布文档",
    noSpaces: "暂无知识空间",
    noSources: "暂无公开数据源",
    noDocs: "该空间暂无已发布文档",
    noResults: "未找到匹配内容",
    selectSpace: "选择左侧空间浏览文档",
    loading: "加载中…",
    loadFailed: "加载失败",
    draft: "草稿",
  },
  en: {
    eyebrow: "Enterprise Knowledge",
    title: "Knowledge Base",
    subtitle: "Browse published internal docs and search results for teams and Agents.",
    subtitleAdmin: "Browse published internal docs and search results for teams and Agents. Manage connectors and publishing in the",
    subtitleEmployee: "Browse published internal docs and search results for teams and Agents. Contact an admin to manage connectors and publishing.",
    manageLink: "Admin Console",
    searchPlaceholder: "Search titles and content…",
    search: "Search",
    stats: { spaces: "Spaces", sources: "Sources", docs: "Indexed docs" },
    spaces: "Knowledge Spaces",
    sources: "Connected Sources",
    published: "Published Documents",
    noSpaces: "No knowledge spaces yet",
    noSources: "No public sources yet",
    noDocs: "No published documents in this space",
    noResults: "No matching content",
    selectSpace: "Select a space to browse documents",
    loading: "Loading…",
    loadFailed: "Load failed",
    draft: "Draft",
  },
} as const;

async function publicFetch(url: string) {
  return fetch(url);
}

export function PublicKnowledgePage() {
  const { locale, setLocale } = useLocale();
  const copy = COPY[locale];
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [sources, setSources] = useState<PublicSource[]>([]);
  const [stats, setStats] = useState<{ indexed_documents?: number } | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [publishedDocs, setPublishedDocs] = useState<TreeDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [docDetail, setDocDetail] = useState<PublicDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      publicFetch("/api/v1/knowledge/spaces?limit=50").then((r) => r.json() as Promise<{ spaces?: KnowledgeSpace[] }>),
      publicFetch("/api/v1/knowledge/sources?limit=50").then((r) => r.json() as Promise<{ sources?: PublicSource[] }>),
      publicFetch("/api/v1/knowledge/stats").then((r) => (r.ok ? r.json() : null) as Promise<{ indexed_documents?: number } | null>),
    ])
      .then(([spaceData, sourceData, statsData]) => {
        const nextSpaces = Array.isArray(spaceData.spaces) ? spaceData.spaces : [];
        setSpaces(nextSpaces);
        setSources(Array.isArray(sourceData.sources) ? sourceData.sources : []);
        setStats(statsData);
        if (nextSpaces.length > 0) setActiveSpaceId((prev) => prev || nextSpaces[0].space_id);
      })
      .catch(() => setError(copy.loadFailed))
      .finally(() => setLoading(false));
  }, [copy.loadFailed]);

  useEffect(() => {
    if (!activeSpaceId) {
      setPublishedDocs([]);
      return;
    }
    publicFetch(`/api/v1/knowledge/spaces/${encodeURIComponent(activeSpaceId)}/tree`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ documents?: TreeDocument[] }>;
      })
      .then((data) => {
        const docs = (data.documents ?? []).filter((d) => d.publish_status === "published");
        setPublishedDocs(docs);
        setSelectedDocId((prev) => (prev && docs.some((d) => d.doc_id === prev) ? prev : docs[0]?.doc_id ?? ""));
      })
      .catch(() => setPublishedDocs([]));
  }, [activeSpaceId]);

  useEffect(() => {
    if (!selectedDocId) {
      setDocDetail(null);
      return;
    }
    publicFetch(`/api/v1/knowledge/documents/${encodeURIComponent(selectedDocId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ document?: PublicDoc }>;
      })
      .then((data) => setDocDetail(data.document ?? null))
      .catch(() => setDocDetail(null));
  }, [selectedDocId]);

  const runSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const res = await publicFetch(`/api/v1/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20`);
    if (!res.ok) {
      setError(`${copy.loadFailed} (${res.status})`);
      return;
    }
    const data = (await res.json()) as { results?: SearchResult[] };
    setSearchResults(Array.isArray(data.results) ? data.results : []);
  };

  const activeSpace = useMemo(() => spaces.find((s) => s.space_id === activeSpaceId), [spaces, activeSpaceId]);
  const showAdminLink = canAccessAdminConsole();

  return (
    <div
      className="min-h-screen bg-[#f6f8fc] text-slate-900"
      style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.06),transparent_24%)]" />
      <PublicSiteHeader locale={locale} onLocaleChange={setLocale} maxWidthClass="max-w-7xl mx-auto w-full" />

      <main className="relative mx-auto max-w-7xl px-5 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-600">{copy.eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">{copy.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {showAdminLink ? (
              <>
                {copy.subtitleAdmin}{" "}
                <a href="/dashboard" className="font-medium text-teal-700 hover:underline">
                  {copy.manageLink}
                </a>
                {locale === "zh" ? "。" : "."}
              </>
            ) : (
              copy.subtitleEmployee
            )}
          </p>
          <dl className="mt-5 flex flex-wrap gap-8 text-center">
            <div>
              <dd className="text-xl font-semibold tabular-nums text-slate-950">{spaces.length}</dd>
              <dt className="mt-0.5 text-xs text-slate-500">{copy.stats.spaces}</dt>
            </div>
            <div>
              <dd className="text-xl font-semibold tabular-nums text-slate-950">{sources.length}</dd>
              <dt className="mt-0.5 text-xs text-slate-500">{copy.stats.sources}</dt>
            </div>
            <div>
              <dd className="text-xl font-semibold tabular-nums text-slate-950">{stats?.indexed_documents ?? "—"}</dd>
              <dt className="mt-0.5 text-xs text-slate-500">{copy.stats.docs}</dt>
            </div>
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={copy.searchPlaceholder}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-teal-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100"
            />
            <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800">
              {copy.search}
            </button>
          </form>
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.map((item) => (
                <button
                  key={`${item.doc_id}-${item.heading ?? ""}`}
                  type="button"
                  onClick={() => setSelectedDocId(item.doc_id)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-teal-200 hover:bg-teal-50/40"
                >
                  <p className="font-medium text-slate-950">{item.title}</p>
                  {item.space_name && <p className="mt-0.5 text-xs text-slate-500">{item.space_name}</p>}
                  {item.snippet && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.snippet}</p>}
                </button>
              ))}
            </div>
          )}
          {searchQuery.trim() && searchResults.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">{copy.noResults}</p>
          )}
        </section>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1.2fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">{copy.spaces}</h2>
            {loading ? (
              <p className="mt-3 text-sm text-slate-500">{copy.loading}</p>
            ) : spaces.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{copy.noSpaces}</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {spaces.map((space) => (
                  <li key={space.space_id}>
                    <button
                      type="button"
                      onClick={() => setActiveSpaceId(space.space_id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                        activeSpaceId === space.space_id
                          ? "bg-teal-50 font-medium text-teal-900"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {space.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">
              {activeSpace ? `${copy.published} · ${activeSpace.name}` : copy.published}
            </h2>
            {publishedDocs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{activeSpaceId ? copy.noDocs : copy.selectSpace}</p>
            ) : (
              <ul className="mt-3 max-h-[420px] space-y-1 overflow-y-auto">
                {publishedDocs.map((doc) => (
                  <li key={doc.doc_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedDocId(doc.doc_id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                        selectedDocId === doc.doc_id
                          ? "bg-slate-100 font-medium text-slate-950"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {doc.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            {docDetail ? (
              <>
                <h2 className="text-lg font-semibold text-slate-950">{docDetail.title}</h2>
                {docDetail.space_name && <p className="mt-1 text-xs text-slate-500">{docDetail.space_name}</p>}
                <pre className="mt-4 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700 ring-1 ring-slate-100">
                  {docDetail.content_text?.trim() || docDetail.content_snippet?.trim() || "—"}
                </pre>
              </>
            ) : (
              <p className="text-sm text-slate-500">{copy.selectSpace}</p>
            )}
          </section>
        </div>

        {sources.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">{copy.sources}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((source) => (
                <div key={source.source_id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="font-medium text-slate-950">{source.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {source.source_type} · {source.document_count} docs
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
