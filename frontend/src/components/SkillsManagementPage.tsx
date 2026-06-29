import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import { SkillAccountAssignSection, SkillBundlePublishSection } from "./SkillsDispatchSections";

// ── Types ──────────────────────────────────────────────────────────────────

type SkillRecord = {
  skill_id: string; name: string; description: string; version: string;
  runtime_targets: string[]; package_url?: string; package_sha256?: string;
  status: "draft" | "pending" | "approved" | "deprecated" | "rejected";
  visibility: string; team_id?: string; tags?: string[];
  source_type?: "enterprise" | "external"; source_run_id?: string;
  updated_at?: string; created_at?: string;
  versions?: Array<{ version: string; description: string; created_at: string }>;
  test_runs?: TestRun[];
};

type SkillCandidate = { candidate_id: string; name: string; description?: string; status: string; runtime_target: string; };

type TestRun = { id: number; skill_id: string; run_id: string; test_prompt: string; run_status: string; run_result: string; created_at: string; };

type WorkspaceSkill = { skill_id: string; name: string; description: string; scripts: string[]; };

type SkillsTab = "all" | "draft" | "pending" | "approved" | "deprecated";
type SkillsPageSection = "library" | "publish" | "assign";

// ── Shared helpers ──────────────────────────────────────────────────────────

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-medium uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div><div className="mt-0.5 text-xs text-slate-400">{note}</div></div>;
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "草稿", className: "border-slate-200 bg-slate-100 text-slate-600" },
  pending: { label: "待审核", className: "border-amber-200 bg-amber-50 text-amber-700" },
  approved: { label: "已通过", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "已拒绝", className: "border-red-200 bg-red-50 text-red-700" },
  deprecated: { label: "已废弃", className: "border-slate-200 bg-slate-100 text-slate-500" },
};

const SOURCE_LABEL: Record<string, string> = { enterprise: "企业技能", external: "外部导入" };

// ── Component ──────────────────────────────────────────────────────────────

export function SkillsManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get("section");
  const initialSection: SkillsPageSection =
    sectionFromUrl === "publish" || sectionFromUrl === "assign" || sectionFromUrl === "library"
      ? sectionFromUrl
      : "library";

  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<SkillsTab>("all");
  const [pageSection, setPageSection] = useState<SkillsPageSection>(initialSection);
  const [filters, setFilters] = useState({ query: "", source_type: "", tag: "" });

  const setSection = (next: SkillsPageSection) => {
    setPageSection(next);
    const params = new URLSearchParams(searchParams);
    if (next === "library") params.delete("section");
    else params.set("section", next);
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    if (sectionFromUrl === "publish" || sectionFromUrl === "assign" || sectionFromUrl === "library") {
      setPageSection(sectionFromUrl);
    }
  }, [sectionFromUrl]);

  // Detail
  const [detailSkill, setDetailSkill] = useState<SkillRecord | null>(null);

  // Modals
  const [uploadOpen, setUploadOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testSkillId, setTestSkillId] = useState("");
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairSkillId, setRepairSkillId] = useState("");
  const [repairSkillName, setRepairSkillName] = useState("");

  const loadSkills = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (tab !== "all") params.set("status_filter", tab);
      if (filters.source_type) params.set("source_type", filters.source_type);
      if (filters.tag) params.set("tag", filters.tag);
      if (filters.query) params.set("query", filters.query);
      const res = await adminFetch(`/api/v1/skills?${params}`);
      const data = await res.json().catch(() => ({}));
      setSkills((data.skills || []) as SkillRecord[]);
    } catch (err) { setError(err instanceof Error ? err.message : "加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadSkills(); }, [tab, filters.source_type]);

  const handleSearch = (e: FormEvent) => { e.preventDefault(); loadSkills(); };

  const openDetail = async (skillId: string) => {
    try {
      const res = await adminFetch(`/api/v1/skills/${encodeURIComponent(skillId)}`);
      const data = await res.json();
      setDetailSkill(data.skill as SkillRecord);
    } catch { /* ignore */ }
  };

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleSubmit = async (skillId: string) => {
    try { await adminFetch(`/api/v1/skills/${encodeURIComponent(skillId)}/submit`, { method: "POST" }); setMessage("已提交审核"); loadSkills(); }
    catch (err) { setError(err instanceof Error ? err.message : "提交失败"); }
  };

  const handleDeprecate = async (skillId: string) => {
    try {
      await adminFetch(`/api/v1/skills/${encodeURIComponent(skillId)}/deprecate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "", reviewer: "admin" }) });
      setMessage("技能已废弃"); loadSkills();
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  };

  const handleReview = async (candidateId: string, decision: "approved" | "rejected") => {
    try {
      await adminFetch(`/api/v1/skill-candidates/${encodeURIComponent(candidateId)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reviewer: "admin", reason: decision === "approved" ? "审核通过" : "审核拒绝", visibility: "team" }) });
      setMessage(decision === "approved" ? "审核通过" : "已拒绝"); loadSkills();
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  };

  // ── Counts ───────────────────────────────────────────────────────────────

  const counts = { all: skills.length, draft: 0, pending: 0, approved: 0, rejected: 0, deprecated: 0 };
  skills.forEach((s) => { const key = s.status as keyof typeof counts; if (key in counts) (counts as Record<string, number>)[key]++; });

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Dispatch entry — always visible at top */}
      <div className="sticky top-0 z-10 -mx-1 rounded-2xl border-2 border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-violet-950">技能下发</h2>
            <p className="mt-0.5 text-sm text-violet-800/80">
              审核通过后在此下发：云端 Agent 用「账号下发」，本机 OpenClaw 用「发布 Bundle」。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSection("assign")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
                pageSection === "assign"
                  ? "bg-indigo-600 text-white ring-2 ring-indigo-300"
                  : "bg-white text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50"
              }`}
            >
              👤 账号下发（云端 Agent）
            </button>
            <button
              type="button"
              onClick={() => setSection("publish")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
                pageSection === "publish"
                  ? "bg-violet-600 text-white ring-2 ring-violet-300"
                  : "bg-white text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50"
              }`}
            >
              📦 发布 Bundle（本机 sync）
            </button>
            <button
              type="button"
              onClick={() => setSection("library")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                pageSection === "library"
                  ? "bg-slate-800 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              技能库
            </button>
          </div>
        </div>
      </div>

      {pageSection === "publish" ? <SkillBundlePublishSection /> : null}
      {pageSection === "assign" ? <SkillAccountAssignSection /> : null}

      {pageSection === "library" ? (
      <>
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">上传、审核、测试技能包。通过后点击上方 <strong className="text-indigo-700">账号下发</strong> 或 <strong className="text-violet-700">发布 Bundle</strong>。</p>
        <div className="flex gap-2">
          <button type="button" onClick={loadSkills} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{loading ? "刷新中…" : "刷新"}</button>
          <button type="button" onClick={() => { setExtractOpen(true); setError(""); }} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100">⬇ 提取技能</button>
          <button type="button" onClick={() => { setUploadOpen(true); setError(""); }} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">+ 上传技能</button>
        </div>
      </div>

      {counts.approved > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <span>已有 <strong>{counts.approved}</strong> 个已通过技能，可下发给员工使用。</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSection("assign")} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">去账号下发 →</button>
            <button type="button" onClick={() => setSection("publish")} className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50">去发布 Bundle →</button>
          </div>
        </div>
      ) : null}
      {/* Stat cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="全部" value={counts.all} note="总技能数" />
        <StatCard label="草稿" value={counts.draft} note="待完善" />
        <StatCard label="待审核" value={counts.pending} note="候选" />
        <StatCard label="已通过" value={counts.approved} note="可下发" />
        <StatCard label="已废弃" value={counts.deprecated} note="deprecated" />
      </section>

      {/* Messages */}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}<button onClick={() => setMessage("")} className="ml-2 text-emerald-500 hover:text-emerald-700">✕</button></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button onClick={() => setError("")} className="ml-2 text-red-500 hover:text-red-700">✕</button></div>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {(["all", "draft", "pending", "approved", "deprecated"] as SkillsTab[]).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${tab === item ? "border border-b-white border-slate-200 bg-white text-slate-950 -mb-px" : "text-slate-500 hover:text-slate-800"}`}>
            {STATUS_META[item]?.label || (item === "all" ? "全部" : item)}
            {item !== "all" && counts[item] > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{counts[item]}</span>}
          </button>
        ))}
      </div>

      {/* Filter bar + table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={handleSearch} className="mb-4 flex flex-wrap gap-2">
          <input className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="搜索名称或描述" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.source_type} onChange={(e) => setFilters({ ...filters, source_type: e.target.value })}>
            <option value="">全部来源</option><option value="enterprise">企业技能</option><option value="external">外部导入</option>
          </select>
          <input className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="tag" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })} />
          <button type="submit" className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white">筛选</button>
        </form>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">加载中…</div>
        ) : skills.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">暂无技能。点击「提取技能」从 Agent 工作区提取，或「上传技能」导入外部包。</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">技能</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">来源</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">Runtime</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="w-36 px-3 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {skills.map((skill) => (
                  <tr key={skill.skill_id} className="cursor-pointer hover:bg-slate-50/50" onClick={() => openDetail(skill.skill_id)}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">{skill.name}</div>
                      <div className="font-mono text-xs text-slate-500">{skill.skill_id} · v{skill.version}</div>
                      {skill.description && <div className="text-xs text-slate-400 line-clamp-1">{skill.description}</div>}
                      {skill.tags?.length ? <div className="text-xs text-slate-400">{skill.tags.join(", ")}</div> : null}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-600 lg:table-cell">{SOURCE_LABEL[skill.source_type || ""] || skill.source_type || "—"}</td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-600 md:table-cell">{skill.runtime_targets?.join(", ") || "all"}</td>
                    <td className="px-3 py-2.5"><Badge className={STATUS_META[skill.status]?.className || ""}>{STATUS_META[skill.status]?.label || skill.status}</Badge></td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => openDetail(skill.skill_id)} className="text-xs text-slate-500 hover:text-slate-800">详情</button>
                        {skill.status === "draft" && <button type="button" onClick={() => handleSubmit(skill.skill_id)} className="text-xs text-emerald-600 hover:text-emerald-800">提交审核</button>}
                        {skill.status === "pending" && (
                          <>
                            <button type="button" onClick={() => { setTestSkillId(skill.skill_id); setTestOpen(true); }} className="text-xs text-sky-600 hover:text-sky-800">测试</button>
                            <button type="button" onClick={() => handleReview(`review_${skill.skill_id}`.slice(0, 128), "approved")} className="text-xs text-emerald-600 hover:text-emerald-800">通过</button>
                            <button type="button" onClick={() => handleReview(`review_${skill.skill_id}`.slice(0, 128), "rejected")} className="text-xs text-red-600 hover:text-red-800">拒绝</button>
                          </>
                        )}
                        {skill.status === "approved" && (
                          <>
                            <button type="button" onClick={() => { setTestSkillId(skill.skill_id); setTestOpen(true); }} className="text-xs text-sky-600 hover:text-sky-800">测试</button>
                            <button type="button" onClick={() => { setRepairSkillId(skill.skill_id); setRepairSkillName(skill.name); setRepairOpen(true); }} className="text-xs text-amber-600 hover:text-amber-800">修复</button>
                            <button type="button" onClick={() => handleDeprecate(skill.skill_id)} className="text-xs text-red-600 hover:text-red-800">废弃</button>
                          </>
                        )}
                        {skill.status === "rejected" && <button type="button" onClick={() => handleSubmit(skill.skill_id)} className="text-xs text-amber-600 hover:text-amber-800">重新提交</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detailSkill && <DetailDrawer skill={detailSkill} onClose={() => setDetailSkill(null)} onTest={() => { setTestSkillId(detailSkill.skill_id); setTestOpen(true); }} onReview={(d) => handleReview(`review_${detailSkill.skill_id}`.slice(0, 128), d)} />}

      {/* Modals */}
      {extractOpen && <ExtractModal onClose={() => setExtractOpen(false)} onDone={(msg) => { setMessage(msg); loadSkills(); }} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onDone={(msg) => { setMessage(msg); loadSkills(); }} />}
      {testOpen && <TestModal skillId={testSkillId} onClose={() => setTestOpen(false)} onDone={(msg) => { setMessage(msg); }} />}
      {repairOpen && <RepairModal skillId={repairSkillId} skillName={repairSkillName} onClose={() => setRepairOpen(false)} onDone={(msg) => { setMessage(msg); }} />}
      </>
      ) : null}
    </div>
  );
}

// ── Detail Drawer ───────────────────────────────────────────────────────────

function DetailDrawer({ skill, onClose, onTest, onReview }: { skill: SkillRecord; onClose: () => void; onTest: () => void; onReview: (d: "approved" | "rejected") => void; }) {
  const [detailTab, setDetailTab] = useState<"content" | "versions" | "tests">("content");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{skill.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>
        <div className="px-4 py-3 space-y-1 text-xs text-slate-600 border-b border-slate-100 shrink-0">
          <div className="flex gap-4"><span>版本: {skill.version}</span><span>来源: {SOURCE_LABEL[skill.source_type || ""] || "—"}</span><Badge className={STATUS_META[skill.status]?.className || ""}>{STATUS_META[skill.status]?.label || skill.status}</Badge></div>
          <p className="text-slate-500">{skill.description || "暂无描述"}</p>
          {(skill.tags || []).length > 0 && <div className="flex gap-1 flex-wrap">{(skill.tags || []).map((t: string) => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600">{t}</span>)}</div>}
        </div>
        {skill.status === "pending" && (
          <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 shrink-0 bg-amber-50">
            <span className="text-xs text-amber-700 font-medium">待审核</span>
            <button onClick={onTest} className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100">🧪 运行测试</button>
            <button onClick={() => onReview("approved")} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100">✓ 通过</button>
            <button onClick={() => onReview("rejected")} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">✗ 拒绝</button>
          </div>
        )}
        <div className="flex border-b border-slate-200 shrink-0">
          {(["content", "versions", "tests"] as const).map((t) => (
            <button key={t} onClick={() => setDetailTab(t)} className={`px-4 py-2 text-xs border-b-2 transition-colors ${detailTab === t ? "border-slate-950 text-slate-950 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t === "content" ? "内容" : t === "versions" ? "版本" : "测试记录"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {detailTab === "content" && (
            <div className="space-y-3">
              <div><p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">描述</p><pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">{skill.description || "暂无"}</pre></div>
              <dl className="text-xs space-y-1 text-slate-600"><div className="flex gap-2"><dt className="text-slate-400 w-20 shrink-0">技能ID</dt><dd className="font-mono">{skill.skill_id}</dd></div><div className="flex gap-2"><dt className="text-slate-400 w-20 shrink-0">版本</dt><dd>{skill.version}</dd></div><div className="flex gap-2"><dt className="text-slate-400 w-20 shrink-0">创建</dt><dd>{skill.created_at ? formatDateTimeShort(skill.created_at) : "—"}</dd></div></dl>
            </div>
          )}
          {detailTab === "versions" && (
            <div className="space-y-2">
              {(skill.versions || []).length === 0 ? (
                <p className="text-xs text-slate-500">暂无版本历史</p>
              ) : (
                (skill.versions || []).map((v, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-900">v{v.version}</span>
                      <span className="text-[10px] text-slate-500">{v.created_at ? formatDateTimeShort(v.created_at) : ""}</span>
                    </div>
                    {v.description && <p className="text-[11px] text-slate-600 mt-1">{v.description}</p>}
                  </div>
                ))
              )}
            </div>
          )}
          {detailTab === "tests" && (
            <div className="space-y-2">
              {(skill.test_runs || []).length === 0 ? (
                <p className="text-xs text-slate-500">暂无测试记录</p>
              ) : (
                (skill.test_runs || []).map((tr) => {
                  const runColor = tr.run_status === "succeeded" ? "text-emerald-600" : tr.run_status === "failed" ? "text-red-600" : "text-slate-600";
                  const badgeClass = tr.run_status === "succeeded" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : tr.run_status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-100 text-slate-600";
                  const badgeLabel = tr.run_status === "succeeded" ? "✓ 通过" : tr.run_status === "failed" ? "✗ 失败" : tr.run_status;
                  return (
                    <div key={tr.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-mono ${runColor}`}>{tr.run_id}</span>
                        <Badge className={badgeClass}>{badgeLabel}</Badge>
                      </div>
                      {tr.run_result && <pre className="mt-2 text-[10px] text-slate-500 bg-slate-50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">{tr.run_result.slice(0, 500)}</pre>}
                      <p className="text-[10px] text-slate-400 mt-1">{tr.created_at ? formatDateTimeShort(tr.created_at) : ""}</p>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Extract Modal ───────────────────────────────────────────────────────────

function ExtractModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void; }) {
  const [accountId, setAccountId] = useState("");
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scan = async () => {
    if (!accountId.trim()) return; setLoading(true); setError(""); setSkills([]);
    try {
      const res = await adminFetch(`/api/v1/accounts/${encodeURIComponent(accountId.trim())}/workspace-skills`);
      const data = await res.json();
      setSkills((data.skills || []) as WorkspaceSkill[]);
    } catch (err) { setError(err instanceof Error ? err.message : "扫描失败"); }
    finally { setLoading(false); }
  };

  const confirm = async () => {
    let count = 0;
    for (const sid of selected) {
      const ws = skills.find((s) => s.skill_id === sid); if (!ws) continue;
      try { await adminFetch("/api/v1/skills/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_id: ws.skill_id, name: ws.name || ws.skill_id, description: ws.description || "", source_type: "enterprise" }) }); count++; } catch { /* skip dup */ }
    }
    onDone(`已提取 ${count} 个技能到草稿箱`); onClose();
  };

  const toggle = (id: string) => { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); setSelected(next); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">提取工作区技能</h3>
        <div className="flex gap-2"><input type="text" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="网关账号 ID" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" onKeyDown={(e) => { if (e.key === "Enter") scan(); }} /><button onClick={scan} disabled={loading || !accountId.trim()} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{loading ? "扫描中…" : "扫描"}</button></div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {skills.length > 0 && <div className="space-y-1.5 max-h-64 overflow-y-auto">{skills.map((s) => <label key={s.skill_id} className="flex items-start gap-2 p-2 rounded border border-slate-200 cursor-pointer hover:bg-slate-50"><input type="checkbox" checked={selected.has(s.skill_id)} onChange={() => toggle(s.skill_id)} className="mt-0.5" /><div><p className="text-xs font-medium text-slate-900">{s.name}</p><p className="text-[10px] text-slate-500">{s.description || "无描述"}</p></div></label>)}</div>}
        {skills.length === 0 && !loading && accountId && <p className="text-xs text-slate-500 text-center">未发现技能</p>}
        <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button><button onClick={confirm} disabled={selected.size === 0} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">提取选中 ({selected.size})</button></div>
      </div>
    </div>
  );
}

// ── Upload Modal ────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const r = String(reader.result || ""); resolve(r.includes(",") ? r.split(",")[1] : r); }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void; }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");

  const upload = async () => {
    if (!file) return; setLoading(true); setError("");
    try {
      const b64 = await fileToBase64(file);
      const skillId = file.name.replace(/\.zip$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      await adminFetch("/api/v1/skill-packages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_id: skillId, name: name || skillId, description: desc, version: "1.0.0", runtime_targets: ["openclaw", "hermes", "skilllite", "custom"], visibility: "team", tags: tags.split(",").map((s) => s.trim()).filter(Boolean), filename: file.name, content_base64: b64 }) });
      onDone("技能包上传成功"); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "上传失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">上传技能包</h3>
        <div><label className="text-xs text-slate-500 mb-1 block">ZIP 文件 *</label><input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:text-sm file:font-medium file:border file:border-slate-200 file:bg-white file:text-slate-700 hover:file:bg-slate-50" /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="技能名称" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">描述</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">标签（逗号分隔）</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="network, integration" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button><button onClick={upload} disabled={!file || loading} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{loading ? "上传中…" : "上传"}</button></div>
      </div>
    </div>
  );
}

// ── Test Modal ──────────────────────────────────────────────────────────────

function TestModal({ skillId, onClose, onDone }: { skillId: string; onClose: () => void; onDone: (msg: string) => void; }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { adminFetch("/api/v1/accounts?limit=200").then((r) => r.json().catch(() => ({}))).then((d) => setAccounts((d.accounts || []) as Array<{ id: string; name: string }>)).catch(() => {}); }, []);

  const run = async () => {
    if (!accountId) return; setLoading(true); setError(""); setResult("");
    try {
      const res = await adminFetch(`/api/v1/skills/${encodeURIComponent(skillId)}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test_account_id: accountId, test_prompt: prompt }) });
      const data = await res.json();
      setResult(`测试已触发！Run ID: ${data.run_id}\n工作区: ${data.agent_id}\n前往 Coding Agent 页查看运行结果。`);
      onDone("测试任务已下发");
    } catch (err) { setError(err instanceof Error ? err.message : "测试失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">🧪 技能测试运行</h3>
        <div><label className="text-xs text-slate-500 mb-1 block">选择测试账号</label><select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">-- 选择账号 --</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}</select></div>
        <div><label className="text-xs text-slate-500 mb-1 block">测试 Prompt（选填）</label><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" /></div>
        {result && <pre className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{result}</pre>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">关闭</button><button onClick={run} disabled={loading || !accountId} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">{loading ? "下发中…" : "开始测试"}</button></div>
      </div>
    </div>
  );
}

// ── Repair Modal ────────────────────────────────────────────────────────────

function RepairModal({ skillId, skillName, onClose, onDone }: { skillId: string; skillName: string; onClose: () => void; onDone: (msg: string) => void; }) {
  const [agents, setAgents] = useState<Array<{ agent_id: string; display_name: string }>>([]);
  const [agentId, setAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { fetch("/agents").then((r) => r.json().catch(() => ({}))).then((d) => setAgents((d.agents || []) as Array<{ agent_id: string; display_name: string }>)).catch(() => {}); }, []);

  const repair = async () => {
    if (!agentId) return; setLoading(true); setError(""); setResult("");
    try {
      const res = await adminFetch(`/agents/${encodeURIComponent(agentId)}/repair-skills/stream?skill_names=${encodeURIComponent(skillId)}`, { method: "POST" });
      if (res.ok && res.body) {
        const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
        while (true) { const { done, value } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? ""; for (const line of lines) { if (!line.trim()) continue; try { const obj = JSON.parse(line); if (obj.t === "log") setResult((prev) => prev + obj.m + "\n"); if (obj.t === "done") setResult((prev) => prev + (obj.ok ? "✅ 修复完成\n" : "❌ 修复失败\n")); } catch { setResult((prev) => prev + line + "\n"); } } }
      }
      onDone("技能修复已触发");
    } catch (err) { setError(err instanceof Error ? err.message : "修复失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">🔧 修复技能：{skillName}</h3>
        <p className="text-xs text-slate-500">选择智能体通过 LLM 重新生成技能文件</p>
        <div><label className="text-xs text-slate-500 mb-1 block">选择智能体</label><select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">-- 选择智能体 --</option>{agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.display_name || a.agent_id}</option>)}</select></div>
        {result && <pre className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">{result}</pre>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">关闭</button><button onClick={repair} disabled={loading || !agentId} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">{loading ? "修复中…" : "开始修复"}</button></div>
      </div>
    </div>
  );
}
