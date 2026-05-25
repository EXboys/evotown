import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const MODULES = [
  {
    title: "协作地图",
    desc: "实时观察 Agent 团队任务、状态与协作关系，保留趣味可视化。",
    path: "/arena",
    cta: "进入地图",
    accent: "from-blue-600 to-cyan-500",
  },
  {
    title: "Skills 市场",
    desc: "浏览、安装和复用企业内部 Agent 技能包，支持 OpenClaw / Hermes / SkillLite。",
    path: "/market",
    cta: "浏览市场",
    accent: "from-violet-600 to-indigo-500",
  },
  {
    title: "企业知识库",
    desc: "对接飞书、语雀等文档源，统一索引与检索，供 Agent 运行时引用。",
    path: "/knowledge",
    cta: "管理知识库",
    accent: "from-teal-600 to-emerald-500",
  },
  {
    title: "企业控制台",
    desc: "引擎接入、运行记录、成本归因、风控事件与账号治理统一入口。",
    path: "/dashboard",
    cta: "打开控制台",
    accent: "from-slate-700 to-slate-900",
  },
];

const CAPABILITIES = [
  { label: "运行可观测", detail: "run 生命周期、事件流、产物与策略违规一屏掌握" },
  { label: "技能资产化", detail: "候选技能审核、版本沉淀、私有市场分发" },
  { label: "企业知识库", detail: "飞书 / 语雀 connector、统一检索与文档引用" },
  { label: "多引擎接入", detail: "OpenClaw、Hermes、SkillLite 与自定义 runtime 统一 ingest" },
  { label: "企业治理", detail: "账号体系、API Key、成本与风控闭环" },
];

export function LandingPage() {
  const navigate = useNavigate();
  const [latestChronicle, setLatestChronicle] = useState<{ preview: string; chapter_label: string; virtual_date: string } | null>(null);

  useEffect(() => {
    fetch("/api/chronicle")
      .then((r) => r.json())
      .then((d: { preview: string; chapter_label: string; virtual_date: string }[]) => {
        if (Array.isArray(d) && d.length > 0) setLatestChronicle(d[0]);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900"
      style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <button type="button" onClick={() => navigate("/")} className="flex items-center gap-3 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-white">E</span>
            <span>
              <span className="block text-sm font-semibold text-slate-950">Evotown</span>
              <span className="block text-xs text-slate-500">Enterprise Agent Platform</span>
            </span>
          </button>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <button type="button" onClick={() => navigate("/market")} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">Skills 市场</button>
            <button type="button" onClick={() => navigate("/knowledge")} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">知识库</button>
            <button type="button" onClick={() => navigate("/dashboard")} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">控制台</button>
            <button type="button" onClick={() => navigate("/runs")} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">Runs</button>
            <button type="button" onClick={() => navigate("/login")} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">登录</button>
          </nav>
          <button
            type="button"
            onClick={() => navigate("/arena")}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            协作地图
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-12 md:pt-16">
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Enterprise AI Control Plane</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              企业 Agent
              <br />
              协作与治理平台
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              Evotown 将 Agent 运行监控、技能资产市场与企业控制台整合在一起。
              团队可以看清「谁在做什么」，沉淀可复用技能，并统一管理引擎、成本与风险。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-500"
              >
                进入控制台
              </button>
              <button
                type="button"
                onClick={() => navigate("/market")}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                浏览 Skills 市场
              </button>
              <button
                type="button"
                onClick={() => navigate("/arena")}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                打开协作地图
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Platform Overview</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                { label: "协作地图", value: "Live", note: "Agent 活动可视化" },
                { label: "Skills 市场", value: "Private", note: "企业内部技能分发" },
                { label: "引擎接入", value: "Multi", note: "OpenClaw / Hermes / SkillLite" },
                { label: "治理层", value: "Unified", note: "账号 · 成本 · 风控" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950">{item.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {MODULES.map((mod) => (
            <button
              key={mod.path}
              type="button"
              onClick={() => navigate(mod.path)}
              className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className={`inline-flex rounded-xl bg-gradient-to-br ${mod.accent} px-3 py-1.5 text-xs font-medium text-white`}>
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
          <h2 className="text-lg font-semibold text-slate-950">平台能力</h2>
          <p className="mt-2 text-sm text-slate-500">从运行观测到技能沉淀，覆盖企业 Agent 落地常见环节。</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {CAPABILITIES.map((item) => (
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
              <h2 className="text-sm font-semibold text-slate-950">组织学习日志</h2>
              <span className="text-xs text-slate-500">
                {latestChronicle.chapter_label} · {latestChronicle.virtual_date}
              </span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{latestChronicle.preview || "暂无预览"}</p>
            <button type="button" onClick={() => navigate("/chronicle")} className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-500">
              查看 Chronicle →
            </button>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2025 Evotown · Enterprise Agent Platform</span>
          <span>监控 · 技能市场 · 治理控制台</span>
        </div>
      </footer>
    </div>
  );
}
