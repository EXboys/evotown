import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { adminFetch, canAccessAdminConsole, isConsoleAuthenticated } from "../../hooks/useAdminToken";
import { PublicSiteHeader } from "../PublicSiteHeader";
import { EasyInstallWizard } from "./EasyInstallWizard";
import { manifestUrl } from "../../lib/employeeConfig";
import { useLocale, type Locale } from "../../lib/i18n";

type MarketSkill = {
  skill_id: string;
  name: string;
  description?: string;
  version: string;
  runtime_targets: string[];
  tags?: string[];
  visibility?: string;
  team_id?: string;
  package_url?: string;
  package_bytes?: number;
  download_count?: number;
  readme?: string;
  dependencies?: string[];
  source_run_id?: string;
  updated_at?: string;
  versions?: Array<{
    version: string;
    description?: string;
    readme?: string;
    dependencies?: string[];
    package_bytes?: number;
    source_run_id?: string;
    created_at?: string;
  }>;
};

const RUNTIME_META: Record<string, { label: string; className: string }> = {
  openclaw: { label: "OpenClaw", className: "bg-sky-50 text-sky-700 ring-sky-100" },
  hermes: { label: "Hermes", className: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  skilllite: { label: "SkillLite", className: "bg-amber-50 text-amber-700 ring-amber-100" },
  custom: { label: "Custom", className: "bg-slate-100 text-slate-700 ring-slate-200" },
};

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const MARKET_COPY = {
  zh: {
    catalog: {
      eyebrow: "Skills Market",
      title: "企业 Agent 技能目录",
      descPrefix: "浏览、搜索已发布技能。上传与审核请至",
      descEmployee: "浏览、搜索已发布技能。上传与审核请联系管理员。",
      admin: "管理后台",
      stats: { skills: "技能", downloads: "下载", runtimes: "Runtime" },
      searchPlaceholder: "搜索技能名称、描述...",
      tagPlaceholder: "标签",
      allRuntime: "全部 Runtime",
      search: "搜索",
      allSkills: "全部技能",
      results: (count: number) => `${count} 个结果`,
      emptyTitle: "暂无已发布技能",
      emptyDesc: "管理员可在 /skills 上传并审核技能包。",
      noDescription: "暂无描述",
      downloads: (count: number) => `${count} 次下载`,
      team: "团队",
      loadFailed: "加载失败",
    },
    detail: {
      notFound: "未找到该技能或已下线。",
      back: "返回市场",
      loading: "加载技能详情...",
      noDescription: "暂无描述",
      release: "Current Release",
      downloads: "下载次数",
      packageSize: "包大小",
      sourceRun: "来源 run",
      downloadSignedIn: "下载 Skill 包",
      downloadLogin: "登录后下载",
      downloadStarted: "下载已开始。",
      downloadFailed: "下载失败",
      loginForDownload: "请登录并使用含 console.read 的 evk_ Key。",
      readmeEmpty: "暂无 README。管理员可在上传包时补充 readme 字段。",
      installTitle: "安装方式",
      installDescPrefix: "推荐在",
      installDescLink: "市场首页",
      installDescSuffix: "使用「傻瓜式接入」一键安装；已安装的企业包会自动包含本技能（需 IT 已发布 Bundle）。",
      singleInstall: "只装这一个技能（无需 sync 全量 bundle）：",
      manualDownload: "或在网页登录后点击右侧「下载 Skill 包」手动解压。",
      collapseYaml: "▾ 收起 manifest YAML",
      showYaml: "▸ 查看 manifest / package_url 高级配置",
      versions: "版本历史",
      noVersions: "暂无历史版本记录。",
      dependencies: "依赖",
    },
  },
  en: {
    catalog: {
      eyebrow: "Skills Market",
      title: "Enterprise Agent Skills Catalog",
      descPrefix: "Browse and search published skills. Upload and review from",
      descEmployee: "Browse and search published skills. Contact an admin to upload or review packages.",
      admin: "Admin Console",
      stats: { skills: "Skills", downloads: "Downloads", runtimes: "Runtimes" },
      searchPlaceholder: "Search skill name or description...",
      tagPlaceholder: "Tag",
      allRuntime: "All Runtimes",
      search: "Search",
      allSkills: "All Skills",
      results: (count: number) => `${count} results`,
      emptyTitle: "No published skills yet",
      emptyDesc: "Admins can upload and review skill packages from /skills.",
      noDescription: "No description",
      downloads: (count: number) => `${count} downloads`,
      team: "Team",
      loadFailed: "Load failed",
    },
    detail: {
      notFound: "Skill not found or deprecated.",
      back: "Back to Market",
      loading: "Loading skill details...",
      noDescription: "No description",
      release: "Current Release",
      downloads: "Downloads",
      packageSize: "Package size",
      sourceRun: "Source run",
      downloadSignedIn: "Download Skill Package",
      downloadLogin: "Log in to Download",
      downloadStarted: "Download started.",
      downloadFailed: "Download failed",
      loginForDownload: "Please log in with an evk_ key that includes console.read.",
      readmeEmpty: "No README yet. Admins can provide a readme field when uploading the package.",
      installTitle: "Install",
      installDescPrefix: "Use the",
      installDescLink: "Market home",
      installDescSuffix: "one-click setup for the recommended flow. Installed enterprise bundles include this skill after IT publishes the Bundle.",
      singleInstall: "Install only this skill without syncing the full bundle:",
      manualDownload: "Or log in on the web and click Download Skill Package on the right.",
      collapseYaml: "▾ Collapse manifest YAML",
      showYaml: "▸ Show manifest / package_url advanced config",
      versions: "Version History",
      noVersions: "No version history yet.",
      dependencies: "Dependencies",
    },
  },
} as const;

type MarketCopy = (typeof MARKET_COPY)[Locale];

function skillInitial(name: string) {
  return (name.trim()[0] || "S").toUpperCase();
}

function RuntimeBadge({ runtime }: { runtime: string }) {
  const meta = RUNTIME_META[runtime] || RUNTIME_META.custom;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function MarketShell({ children, locale, onLocaleChange }: { children: ReactNode; locale: Locale; onLocaleChange: (locale: Locale) => void }) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-900" style={{ fontFamily: FONT }}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_24%)]" />
      <PublicSiteHeader
        locale={locale}
        onLocaleChange={onLocaleChange}
        variant="market"
        maxWidthClass="max-w-7xl mx-auto w-full"
        loginReturnPath={pathname}
      />
      <main className="relative mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}

function MarketCatalog() {
  const { locale, setLocale } = useLocale();
  const copy = MARKET_COPY[locale];
  const [skills, setSkills] = useState<MarketSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ query: "", tag: "", runtime_target: "" });

  const load = (next = filters) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (next.query.trim()) params.set("query", next.query.trim());
    if (next.tag.trim()) params.set("tag", next.tag.trim());
    if (next.runtime_target) params.set("runtime_target", next.runtime_target);
    fetch(`/api/v1/market/skills?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${copy.catalog.loadFailed} (${r.status})`);
        return r.json() as Promise<{ skills?: MarketSkill[] }>;
      })
      .then((data) => setSkills(Array.isArray(data.skills) ? data.skills : []))
      .catch((err) => setError(err instanceof Error ? err.message : copy.catalog.loadFailed))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const tags = useMemo(() => {
    const set = new Set<string>();
    skills.forEach((skill) => skill.tags?.forEach((tag) => set.add(tag)));
    return Array.from(set).slice(0, 14);
  }, [skills]);

  const stats = useMemo(() => ({
    total: skills.length,
    downloads: skills.reduce((sum, s) => sum + (s.download_count ?? 0), 0),
    runtimes: new Set(skills.flatMap((s) => s.runtime_targets)).size,
  }), [skills]);

  const showAdminLink = canAccessAdminConsole();

  return (
    <MarketShell locale={locale} onLocaleChange={setLocale}>
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">{copy.catalog.eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">{copy.catalog.title}</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-600">
            {showAdminLink ? (
              <>
                {copy.catalog.descPrefix}{" "}
                <Link to="/skills" className="font-medium text-violet-700 hover:underline">{copy.catalog.admin}</Link>.
              </>
            ) : (
              copy.catalog.descEmployee
            )}
          </p>
        </div>
        <dl className="flex shrink-0 gap-6 text-center sm:gap-8">
          {[
            { label: copy.catalog.stats.skills, value: stats.total },
            { label: copy.catalog.stats.downloads, value: stats.downloads },
            { label: copy.catalog.stats.runtimes, value: stats.runtimes },
          ].map((item) => (
            <div key={item.label}>
              <dd className="text-xl font-semibold tabular-nums text-slate-950">{item.value}</dd>
              <dt className="mt-0.5 text-xs text-slate-500">{item.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_288px] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <form
          className="grid gap-3 lg:grid-cols-[1.4fr_0.7fr_0.7fr_auto]"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            placeholder={copy.catalog.searchPlaceholder}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <input
            value={filters.tag}
            onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            placeholder={copy.catalog.tagPlaceholder}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <select
            value={filters.runtime_target}
            onChange={(e) => setFilters({ ...filters, runtime_target: e.target.value })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">{copy.catalog.allRuntime}</option>
            <option value="openclaw">OpenClaw</option>
            <option value="hermes">Hermes</option>
            <option value="skilllite">SkillLite</option>
            <option value="custom">Custom</option>
          </select>
          <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800">
            {copy.catalog.search}
          </button>
        </form>

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  const next = { ...filters, tag };
                  setFilters(next);
                  load(next);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                  filters.tag === tag
                    ? "bg-violet-600 text-white ring-violet-600"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div>
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-950">{copy.catalog.allSkills}</h2>
          {!loading && (
            <span className="text-sm text-slate-500">{copy.catalog.results(skills.length)}</span>
          )}
        </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <p className="text-base font-medium text-slate-700">{copy.catalog.emptyTitle}</p>
          <p className="mt-2 text-sm text-slate-500">{copy.catalog.emptyDesc}</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => (
            <Link
              key={skill.skill_id}
              to={`/market/${encodeURIComponent(skill.skill_id)}`}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 text-lg font-semibold text-violet-700">
                  {skillInitial(skill.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate text-lg font-semibold text-slate-950 group-hover:text-blue-700">{skill.name}</h2>
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                      v{skill.version}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-slate-400">{skill.skill_id}</p>
                </div>
              </div>

              <p className="mt-4 line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-slate-600">
                {skill.description || copy.catalog.noDescription}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {skill.runtime_targets.slice(0, 3).map((runtime) => (
                  <RuntimeBadge key={runtime} runtime={runtime} />
                ))}
              </div>

              {skill.tags && skill.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {skill.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
                <span>{copy.catalog.downloads(skill.download_count ?? 0)}</span>
                <span>{skill.team_id ? `${copy.catalog.team} · ${skill.team_id}` : skill.visibility || "company"}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      </div>
        </div>

        <aside className="mt-6 lg:mt-0 lg:sticky lg:top-[5.5rem] lg:self-start">
          <EasyInstallWizard layout="sidebar" locale={locale} />
        </aside>
      </div>
    </MarketShell>
  );
}

async function marketFetch(url: string, init: RequestInit = {}) {
  return adminFetch(url, init);
}

function MarketSkillDetail() {
  const { locale, setLocale } = useLocale();
  const copy = MARKET_COPY[locale];
  const { skillId = "" } = useParams();
  const navigate = useNavigate();
  const [skill, setSkill] = useState<MarketSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showAdvancedInstall, setShowAdvancedInstall] = useState(false);
  const signedIn = isConsoleAuthenticated();

  useEffect(() => {
    if (!skillId) return;
    setLoading(true);
    fetch(`/api/v1/market/skills/${encodeURIComponent(skillId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${copy.detail.notFound} (${r.status})`);
        return r.json() as Promise<{ skill?: MarketSkill }>;
      })
      .then((data) => setSkill(data.skill ?? null))
      .catch(() => setSkill(null))
      .finally(() => setLoading(false));
  }, [skillId]);

  const download = async () => {
    if (!skill) return;
    if (!signedIn) {
      navigate(`/login?return=${encodeURIComponent(`/market/${skill.skill_id}`)}`);
      return;
    }
    const res = await marketFetch(`/api/v1/market/skills/${encodeURIComponent(skill.skill_id)}/download`);
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { detail?: string };
        detail = body.detail ? `：${body.detail}` : "";
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403) {
        setMessage(`${copy.detail.downloadFailed} (${res.status})${detail}. ${copy.detail.loginForDownload}`);
      } else {
        setMessage(`${copy.detail.downloadFailed} (${res.status})${detail}`);
      }
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.skill_id}.skill.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage(copy.detail.downloadStarted);
  };

  if (loading) {
    return (
      <MarketShell locale={locale} onLocaleChange={setLocale}>
        <div className="rounded-2xl border border-slate-200 bg-white py-20 text-center text-sm text-slate-500">{copy.detail.loading}</div>
      </MarketShell>
    );
  }

  if (!skill) {
    return (
      <MarketShell locale={locale} onLocaleChange={setLocale}>
        <div className="rounded-2xl border border-slate-200 bg-white py-20 text-center">
          <p className="text-slate-700">{copy.detail.notFound}</p>
          <Link to="/market" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500">
            {copy.detail.back}
          </Link>
        </div>
      </MarketShell>
    );
  }

  const installSnippet = `skills_market:
  manifest_url: ${manifestUrl(window.location.origin, "openclaw")}
  auth_header: Authorization
  auth_prefix: "Bearer "
  auth_token: \${EVOTOWN_API_KEY}

# Single package install (usually sync pulls the bundle)
package_url: /api/v1/market/skills/${skill.skill_id}/download
skill_id: ${skill.skill_id}
version: ${skill.version}`;

  return (
    <MarketShell locale={locale} onLocaleChange={setLocale}>
      <Link to="/market" className="mb-6 inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800">
        ← {copy.detail.back}
      </Link>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_288px] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-blue-50 p-8 md:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 to-blue-600 text-2xl font-semibold text-white shadow-sm">
                {skillInitial(skill.name)}
              </div>
              <div>
                <p className="font-mono text-xs text-slate-400">{skill.skill_id}</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{skill.name}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{skill.description || copy.detail.noDescription}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {skill.runtime_targets.map((runtime) => (
                    <RuntimeBadge key={runtime} runtime={runtime} />
                  ))}
                  {skill.tags?.map((tag) => (
                    <span key={tag} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{copy.detail.release}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">v{skill.version}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <div className="flex justify-between"><span>{copy.detail.downloads}</span><span>{skill.download_count ?? 0}</span></div>
                <div className="flex justify-between"><span>{copy.detail.packageSize}</span><span>{skill.package_bytes ? `${skill.package_bytes} B` : "builtin"}</span></div>
                {skill.source_run_id && (
                  <div className="flex justify-between gap-3"><span>{copy.detail.sourceRun}</span><span className="truncate font-mono text-xs">{skill.source_run_id}</span></div>
                )}
              </div>
              <button
                type="button"
                onClick={download}
                className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500"
              >
                {signedIn ? copy.detail.downloadSignedIn : copy.detail.downloadLogin}
              </button>
              {message && <p className="mt-3 text-xs text-emerald-600">{message}</p>}
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-slate-200 lg:grid-cols-2">
          <div className="bg-white p-6 md:p-8">
            <h2 className="text-base font-semibold text-slate-950">README</h2>
            <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-5 text-sm leading-7 text-slate-700 ring-1 ring-slate-100">
              {skill.readme?.trim() || copy.detail.readmeEmpty}
            </pre>
          </div>

          <div className="bg-white p-6 md:p-8">
            <h2 className="text-base font-semibold text-slate-950">{copy.detail.installTitle}</h2>
            <p className="mt-2 text-sm text-slate-600">
              {copy.detail.installDescPrefix}{" "}
              <Link to="/market" className="font-medium text-violet-700 hover:underline">
                {copy.detail.installDescLink}
              </Link>{" "}
              {copy.detail.installDescSuffix}
            </p>
            <p className="mt-3 text-sm text-slate-600">
              {copy.detail.singleInstall}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-emerald-100">
              {`source ~/.config/evotown/evotown.agent.env
evotown-agent-setup.py install ${skill.skill_id}`}
            </pre>
            <p className="mt-2 text-sm text-slate-600">
              {copy.detail.manualDownload}
            </p>
            <button
              type="button"
              onClick={() => setShowAdvancedInstall((v) => !v)}
              className="mt-4 text-xs font-medium text-violet-700 hover:text-violet-900"
            >
              {showAdvancedInstall ? copy.detail.collapseYaml : copy.detail.showYaml}
            </button>
            {showAdvancedInstall && (
              <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-cyan-100">
                {installSnippet}
              </pre>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <h2 className="text-base font-semibold text-slate-950">{copy.detail.versions}</h2>
        {(skill.versions?.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{copy.detail.noVersions}</p>
        ) : (
          <div className="mt-5 space-y-3">
            {skill.versions?.map((version, index) => (
              <div
                key={`${skill.skill_id}-${version.version}`}
                className={`rounded-2xl border p-4 ${index === 0 ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-slate-50/60"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-950">v{version.version}</span>
                    {index === 0 && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">latest</span>}
                  </div>
                  <span className="text-xs text-slate-500">{version.created_at || "-"}</span>
                </div>
                {version.description && <p className="mt-2 text-sm text-slate-600">{version.description}</p>}
                {version.dependencies?.length ? (
                  <p className="mt-2 text-xs text-slate-500">{copy.detail.dependencies}: {version.dependencies.join(", ")}</p>
                ) : null}
                {version.source_run_id ? (
                  <p className="mt-1 font-mono text-xs text-slate-500">source_run: {version.source_run_id}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {skill.dependencies?.length ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">{copy.detail.dependencies}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {skill.dependencies.map((dep) => (
              <span key={dep} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                {dep}
              </span>
            ))}
          </div>
        </section>
      ) : null}
        </div>

        <aside className="mt-6 lg:mt-0 lg:sticky lg:top-[5.5rem] lg:self-start">
          <EasyInstallWizard layout="sidebar" locale={locale} />
        </aside>
      </div>
    </MarketShell>
  );
}

export function SkillsMarketPage() {
  const { skillId } = useParams();
  if (skillId) return <MarketSkillDetail />;
  return <MarketCatalog />;
}
