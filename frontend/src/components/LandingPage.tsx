import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PublicSiteHeader } from "./PublicSiteHeader";
import { useLocale } from "../lib/i18n";
import { adminFetch, canAccessAdminConsole, isConsoleAuthenticated, isStaffEmployee } from "../hooks/useAdminToken";
import { STAFF_EMPLOYEE_HOME } from "../lib/staffRoutes";
import { formatDateTimeShort } from "../lib/datetime";
import { useSystemConfig } from "../hooks/useSystemConfig";

const MODULE_META = [
  { path: "/arena", accent: "from-blue-600 to-cyan-500" },
  { path: "/market", accent: "from-violet-600 to-indigo-500" },
  { path: "/knowledge", accent: "from-teal-600 to-emerald-500" },
  { path: "/dashboard", accent: "from-slate-700 to-slate-900" },
];

const COPY = {
  zh: {
    hero: {
      eyebrow: "Enterprise AI Control Plane",
      title: (
        <>
          企业 Agent
          <br />
          协作与治理平台
        </>
      ),
      body: "Evotown 将 Agent 运行监控、技能资产市场与企业控制台整合在一起。团队可以看清「谁在做什么」，沉淀可复用技能，并统一管理引擎、成本与风险。",
      primary: "进入控制台",
      market: "浏览 Skills 市场",
      arena: "打开协作地图",
    },
    overview: {
      title: "Platform Overview",
      items: [
        { label: "协作地图", value: "Live", note: "Agent 活动可视化" },
        { label: "Skills 市场", value: "Private", note: "企业内部技能分发" },
        { label: "引擎接入", value: "Multi", note: "OpenClaw / Hermes / SkillLite" },
        { label: "治理层", value: "Unified", note: "账号 · 成本 · 风控" },
      ],
    },
    modules: [
      { title: "协作地图", desc: "实时观察 Agent 团队任务、状态与协作关系，保留趣味可视化。", cta: "进入地图" },
      { title: "Skills 市场", desc: "浏览、安装和复用企业内部 Agent 技能包，支持 OpenClaw / Hermes / SkillLite。", cta: "浏览市场" },
      { title: "企业知识库", desc: "对接飞书、语雀等文档源，统一索引与检索，供 Agent 运行时引用。", cta: "浏览知识库" },
      { title: "企业控制台", desc: "引擎接入、运行记录、成本归因、风控事件与账号治理统一入口。", cta: "打开控制台" },
    ],
    capabilities: {
      title: "平台能力",
      desc: "从运行观测到技能沉淀，覆盖企业 Agent 落地常见环节。",
      items: [
        { label: "运行可观测", detail: "run 生命周期、事件流、产物与策略违规一屏掌握" },
        { label: "技能资产化", detail: "候选技能审核、版本沉淀、私有市场分发" },
        { label: "企业知识库", detail: "飞书 / 语雀 connector、统一检索与文档引用" },
        { label: "多引擎接入", detail: "OpenClaw、Hermes、SkillLite 与自定义 runtime 统一 ingest" },
        { label: "企业治理", detail: "账号体系、API Key、成本与风控闭环" },
      ],
    },
    chronicle: {
      title: "组织学习日志",
      empty: "暂无预览",
      cta: "查看运行日报",
    },
    footer: "监控 · 技能市场 · 治理控制台",
  },
  en: {
    hero: {
      eyebrow: "Enterprise AI Control Plane",
      title: (
        <>
          Enterprise Agent
          <br />
          Collaboration & Governance
        </>
      ),
      body: "Evotown brings Agent run observability, a private Skills market, and an enterprise console into one control plane. Teams can see who is doing what, promote reusable capabilities, and govern engines, cost, and risk.",
      primary: "Open Console",
      market: "Browse Skills Market",
      arena: "Open Collaboration Map",
    },
    overview: {
      title: "Platform Overview",
      items: [
        { label: "Collaboration Map", value: "Live", note: "Agent activity visualization" },
        { label: "Skills Market", value: "Private", note: "Internal skill distribution" },
        { label: "Engine Ingest", value: "Multi", note: "OpenClaw / Hermes / SkillLite" },
        { label: "Governance", value: "Unified", note: "Accounts · Cost · Risk" },
      ],
    },
    modules: [
      { title: "Collaboration Map", desc: "Observe Agent team tasks, status, and collaboration relationships in real time with a visual workspace.", cta: "Enter Map" },
      { title: "Skills Market", desc: "Browse, install, and reuse private Agent skill packages for OpenClaw, Hermes, and SkillLite.", cta: "Browse Market" },
      { title: "Knowledge Base", desc: "Connect Feishu, Yuque, and native docs into unified search and citations for Agent runtime use.", cta: "Browse Knowledge" },
      { title: "Enterprise Console", desc: "One place for engine ingest, run history, cost attribution, risk events, and account governance.", cta: "Open Console" },
    ],
    capabilities: {
      title: "Platform Capabilities",
      desc: "From run observability to skill promotion, Evotown covers the core steps for landing enterprise Agents.",
      items: [
        { label: "Run Observability", detail: "Track run lifecycle, event streams, artifacts, and policy violations in one view" },
        { label: "Skill Assetization", detail: "Review candidate skills, preserve versions, and distribute through a private market" },
        { label: "Enterprise Knowledge", detail: "Feishu / Yuque connectors, unified retrieval, and document citations" },
        { label: "Multi-engine Ingest", detail: "Unified ingest for OpenClaw, Hermes, SkillLite, and custom runtimes" },
        { label: "Enterprise Governance", detail: "Accounts, API keys, cost attribution, and risk workflows" },
      ],
    },
    chronicle: {
      title: "Organization Learning Log",
      empty: "No preview yet",
      cta: "View daily run report",
    },
    footer: "Observability · Skills Market · Governance Console",
  },
} as const;

export function LandingPage() {
  const navigate = useNavigate();
  const { locale, setLocale } = useLocale();
  const sysConfig = useSystemConfig();
  const copy = COPY[locale];
  const [latestChronicle, setLatestChronicle] = useState<{ preview: string; chapter_label: string; virtual_date: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<Array<{ agent_id: string; name: string; status: string; model_policy?: string; updated_at: string }>>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  // Override hardcoded hero/footer text with system config
  const heroTitle = sysConfig.portal_hero_title || "企业 Agent";
  const heroBody = sysConfig.portal_hero_desc || copy.hero.body;
  const footerText = sysConfig.portal_footer_text || "© 2025 Evotown · Enterprise Agent Platform";

  const consoleEntryPath = (): string => {
    if (!isConsoleAuthenticated()) return "/login";
    if (canAccessAdminConsole()) return "/dashboard";
    return STAFF_EMPLOYEE_HOME;
  };

  const resolveModulePath = (path: string): string => {
    if (path === "/dashboard" && isStaffEmployee()) return STAFF_EMPLOYEE_HOME;
    return path;
  };

  const primaryCtaLabel = isStaffEmployee()
    ? (locale === "zh" ? "进入智能体工作台" : "Open Agent Workspace")
    : copy.hero.primary;

  useEffect(() => {
    fetch("/api/chronicle")
      .then((r) => r.json())
      .then((d: { preview: string; chapter_label: string; virtual_date: string }[]) => {
        if (Array.isArray(d) && d.length > 0) setLatestChronicle(d[0]);
      })
      .catch(() => {});
  }, []);

  // 已登录用户加载自己的智能体（工作区）
  useEffect(() => {
    if (!isConsoleAuthenticated()) return;
    setWorkspacesLoading(true);
    adminFetch("/api/v1/agents?include_all=false&limit=50")
      .then((r) => r.json())
      .then((d) => setWorkspaces((d.workspaces || []) as typeof workspaces))
      .catch(() => setWorkspaces([]))
      .finally(() => setWorkspacesLoading(false));
  }, []);

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900"
      style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      <PublicSiteHeader locale={locale} onLocaleChange={setLocale} maxWidthClass="max-w-6xl mx-auto w-full" />

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-12 md:pt-16">
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">{copy.hero.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              {heroTitle}
              <br />
              协作与治理平台
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              {heroBody}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate(consoleEntryPath())}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-500"
              >
                {primaryCtaLabel}
              </button>
              <button
                type="button"
                onClick={() => navigate("/market")}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                {copy.hero.market}
              </button>
              <button
                type="button"
                onClick={() => navigate("/arena")}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                {copy.hero.arena}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{copy.overview.title}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {copy.overview.items.map((item) => (
                <div key={item.label} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950">{item.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 我的智能体 */}
        {isConsoleAuthenticated() && (
          <section className="mt-16">
            <h2 className="text-lg font-semibold text-slate-950">我的智能体</h2>
            <p className="mt-1 text-sm text-slate-500">你可以访问的智能体工作区</p>
            <div className="mt-5">
              {workspacesLoading ? (
                <div className="py-8 text-center text-sm text-slate-400">加载中…</div>
              ) : workspaces.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                  <p className="text-sm text-slate-500">暂无可用智能体</p>
                  <p className="mt-1 text-xs text-slate-400">联系管理员为您添加可用智能体</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {workspaces.map((ws) => (
                    <button
                      key={ws.agent_id}
                      type="button"
                      onClick={() => navigate(`/agent/agents/${encodeURIComponent(ws.agent_id)}`)}
                      className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium text-slate-950 truncate">{ws.name}</h3>
                        {ws.status === "archived" && (
                          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">已归档</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {ws.model_policy && (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            ws.model_policy === "routes_only"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}>
                            {ws.model_policy === "routes_only" ? "路由模式" : "全部模型"}
                          </span>
                        )}
                        <span>更新于 {formatDateTimeShort(ws.updated_at)}</span>
                      </div>
                      <span className="mt-4 inline-flex text-sm font-medium text-blue-600 group-hover:text-blue-500">
                        进入工作区 →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {copy.modules.map((mod, index) => (
            <button
              key={MODULE_META[index].path}
              type="button"
              onClick={() => navigate(resolveModulePath(MODULE_META[index].path))}
              className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className={`inline-flex rounded-xl bg-gradient-to-br ${MODULE_META[index].accent} px-3 py-1.5 text-xs font-medium text-white`}>
                {mod.title}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{mod.desc}</p>
              <span className="mt-5 inline-flex text-sm font-medium text-blue-600 group-hover:text-blue-500">
                {mod.cta} →
              </span>
            </button>
          ))}
        </section>

        <section className="mt-16 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{copy.capabilities.title}</h2>
          <p className="mt-2 text-sm text-slate-500">{copy.capabilities.desc}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {copy.capabilities.items.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-5">
                <p className="font-medium text-slate-950">{item.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {latestChronicle && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-950">{copy.chronicle.title}</h2>
              <span className="text-xs text-slate-500">
                {latestChronicle.chapter_label} · {latestChronicle.virtual_date}
              </span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{latestChronicle.preview || copy.chronicle.empty}</p>
            <button type="button" onClick={() => navigate("/chronicle")} className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-500">
              {copy.chronicle.cta} →
            </button>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>{footerText}</span>
          <span>{copy.footer}</span>
        </div>
      </footer>
    </div>
  );
}
