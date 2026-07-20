import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";

// ── Types ──────────────────────────────────────────────────────────────────

type SkillRecord = {
  skill_id: string; name: string; description: string; version: string;
  runtime_targets: string[]; package_url?: string; package_sha256?: string;
  status: "draft" | "pending" | "approved" | "deprecated" | "rejected";
  visibility: string; team_id?: string; tags?: string[];
  source_type?: "enterprise" | "external" | "workspace"; source_run_id?: string;
  updated_at?: string; created_at?: string;
  versions?: Array<{ version: string; description: string; version_notes?: string; status?: string; created_at: string }>;
  test_runs?: TestRun[];
  pending_version?: { version_id: number; version: string; status: string; submitted_by_agent_id?: string; submitted_by_agent_name?: string; submitted_by_account?: string; submitted_at?: string } | null;
  latest_version?: { version_id: number; version: string; status: string } | null;
  required_skills?: Array<{ skill_id: string; name: string; version: string }>;
};

type SkillCandidate = { candidate_id: string; name: string; description?: string; status: string; runtime_target: string; };

type TestRun = { id: number; skill_id: string; run_id: string; test_prompt: string; run_status: string; run_result: string; created_at: string; };

type WorkspaceSkill = { skill_id: string; name: string; description: string; scripts: string[]; };

type SkillsTab = "all" | "draft" | "pending" | "approved" | "deprecated";

type CategoryTab = "employee" | "department" | "dedicated";

type DeployAgentInfo = {
  agent_id: string;
  agent_name: string;
  category: string;
  deployed: boolean;
  version: string;
  is_latest: boolean;
  selected?: boolean;
};

// ── Shared helpers ───────────────────────────────────────────────────────

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

const CATEGORY_LABELS: Record<string, string> = {
  employee: "员工", department: "部门", dedicated: "专属",
};

// ── Component ──────────────────────────────────────────────────────────────

export function SkillsManagementPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<SkillsTab>("all");
  const [filters, setFilters] = useState({ query: "", source_type: "", tag: "" });

  // Detail
  const [detailSkill, setDetailSkill] = useState<SkillRecord | null>(null);

  // Modals
  const [uploadOpen, setUploadOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  // Deploy
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploySkillId, setDeploySkillId] = useState("");
  const [deploySkillName, setDeploySkillName] = useState("");
  const [deployMarketVersion, setDeployMarketVersion] = useState("");
  const [deployAgents, setDeployAgents] = useState<DeployAgentInfo[]>([]);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployMessage, setDeployMessage] = useState("");
  const [deployCategory, setDeployCategory] = useState<CategoryTab>("employee");

  // Undeploy
  const [undeployOpen, setUndeployOpen] = useState(false);
  const [undeploySkillId, setUndeploySkillId] = useState("");
  const [undeploySkillName, setUndeploySkillName] = useState("");
  const [undeployAgents, setUndeployAgents] = useState<DeployAgentInfo[]>([]);
  const [undeployBusy, setUndeployBusy] = useState(false);
  const [undeployMessage, setUndeployMessage] = useState("");

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

  const handleDeprecate = async (skillId: string) => {
    try {
      await adminFetch(`/api/v1/skills/${encodeURIComponent(skillId)}/deprecate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "", reviewer: "admin" }) });
      setMessage("技能已废弃"); loadSkills();
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  };

  const handleReview = async (versionId: number, decision: "approved" | "rejected") => {
    try {
      await adminFetch(`/api/v1/skill-versions/${versionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reviewer: "admin", reason: decision === "approved" ? "审核通过" : "审核拒绝" }) });
      setMessage(decision === "approved" ? "审核通过" : "已拒绝"); loadSkills();
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  };

  // ── Deploy ──────────────────────────────────────────────────────────────

  const openDeploy = async (skill: SkillRecord) => {
    setDeploySkillId(skill.skill_id);
    setDeploySkillName(skill.name);
    setDeployMarketVersion(skill.version);
    setDeployMessage("");
    setDeployCategory("employee");
    setDeployBusy(true);
    setDeployOpen(true);
    try {
      const res = await adminFetch(`/api/v1/skills/${encodeURIComponent(skill.skill_id)}/agent-deployments`);
      const data = await res.json();
      const deployments = (data.deployments || []) as DeployAgentInfo[];
      setDeployAgents(deployments);
    } catch { setDeployAgents([]); }
    finally { setDeployBusy(false); }
  };

  const doDeploy = async () => {
    const selected = deployAgents.filter(a => a.selected);
    if (!selected.length) { setDeployMessage("请选择目标 Agent"); return; }
    setDeployBusy(true); setDeployMessage("");
    const results: string[] = [];
    for (const agent of selected) {
      try {
        const res = await adminFetch(`/api/v1/agents/${encodeURIComponent(agent.agent_id)}/skills`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: [deploySkillId], force: true, mode: "append" }),
        });
        const d = await res.json();
        const deployResult = d.deploy_results?.[0];
        results.push(agent.agent_name + ": " + (deployResult?.deployed ? "已下发" : deployResult?.reason || "失败"));
      } catch { results.push(agent.agent_name + ": 请求失败"); }
    }
    setDeployMessage(results.join("\n"));
    setDeployBusy(false);
    if (results.some(r => r.includes("已下发"))) loadSkills();
  };

  // ── Undeploy ────────────────────────────────────────────────────────────

  const openUndeploy = async (skill: SkillRecord) => {
    setUndeploySkillId(skill.skill_id);
    setUndeploySkillName(skill.name);
    setUndeployMessage("");
    setUndeployBusy(true);
    setUndeployOpen(true);
    try {
      const res = await adminFetch(`/api/v1/skills/${encodeURIComponent(skill.skill_id)}/agent-deployments`);
      const data = await res.json();
      const deployments = (data.deployments || []) as DeployAgentInfo[];
      // Only show deployed agents
      setUndeployAgents(deployments.filter(d => d.deployed));
    } catch { setUndeployAgents([]); }
    finally { setUndeployBusy(false); }
  };

  const doUndeploy = async () => {
    const selected = undeployAgents.filter(a => a.selected);
    if (!selected.length) { setUndeployMessage("请选择要取消下发的 Agent"); return; }
    setUndeployBusy(true); setUndeployMessage("");
    const results: string[] = [];
    for (const agent of selected) {
      try {
        const res = await adminFetch(
          `/api/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/${encodeURIComponent(undeploySkillId)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          results.push(agent.agent_name + ": 已取消");
        } else {
          const body = await res.json().catch(() => ({}));
          results.push(agent.agent_name + ": " + ((body as { detail?: string }).detail || "失败"));
        }
      } catch { results.push(agent.agent_name + ": 请求失败"); }
    }
    setUndeployMessage(results.join("\n"));
    setUndeployBusy(false);
    if (results.some(r => r.includes("已取消"))) loadSkills();
  };

  // ── Counts ──────────────────────────────────────────────────────────────

  const counts = {
    all: skills.length,
    draft: skills.filter(s => s.status === "draft").length,
    pending: skills.filter(s => s.status === "pending").length,
    approved: skills.filter(s => s.status === "approved").length,
    deprecated: skills.filter(s => s.status === "deprecated").length,
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-950">技能管理</h2>
        <p className="text-sm text-slate-500">统一技能管理：Agent 创建 → 草稿 → 审核 → 入池 → 下发。企业技能 / 外部导入合流管理。审核操作直接在列表行完成，提交通道仅限 Agent 内部 MCP。</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => { setExtractOpen(true); setError(""); }} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100">⬇ 提取技能</button>
          <button type="button" onClick={() => { setUploadOpen(true); setError(""); }} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">+ 上传技能</button>
        </div>
      </div>

      {/* Stats + filters */}
      <div className="grid gap-4 sm:grid-cols-5">
        <StatCard label="全部" value={counts.all} note="总技能数" />
        <StatCard label="草稿" value={counts.draft} note="" />
        <StatCard label="待审核" value={counts.pending} note="" />
        <StatCard label="已通过" value={counts.approved} note="" />
        <StatCard label="已废弃" value={counts.deprecated} note="" />
      </div>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(["all", "draft", "pending", "approved", "deprecated"] as SkillsTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
              {t === "all" ? "全部" : t === "draft" ? "草稿" : t === "pending" ? "待审核" : t === "approved" ? "已通过" : "已废弃"}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <select value={filters.source_type} onChange={(e) => setFilters({ ...filters, source_type: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600">
            <option value="">全部来源</option><option value="enterprise">企业技能</option><option value="external">外部导入</option>
          </select>
          <input value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} placeholder="搜索..." className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs" />
          <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">搜索</button>
        </form>
      </div>

      {/* Messages */}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message} <button onClick={() => setMessage("")} className="ml-2 text-emerald-400 hover:text-emerald-600">✕</button></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error} <button onClick={() => setError("")} className="ml-2 text-red-400 hover:text-red-600">✕</button></div>}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">加载中…</div>
        ) : skills.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">暂无技能。点击「提取技能」从 Agent 工作区提取，或「上传技能」导入外部包。</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">技能</th>
                <th className="hidden px-3 py-2.5 lg:table-cell">来源</th>
                <th className="px-3 py-2.5">状态</th>
                <th className="px-3 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {skills.map((skill) => (
                <tr key={skill.skill_id} className="cursor-pointer hover:bg-slate-50" onClick={() => openDetail(skill.skill_id)}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-800">{skill.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{skill.skill_id} · v{skill.version}</div>
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-slate-600 lg:table-cell">{SOURCE_LABEL[skill.source_type || ""] || skill.source_type || "—"}</td>
                  <td className="px-3 py-2.5"><Badge className={STATUS_META[skill.status]?.className || ""}>{STATUS_META[skill.status]?.label || skill.status}</Badge></td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {skill.pending_version ? (
                        /* Has a version awaiting review — show approve/reject directly on row */
                        <>
                          <button type="button" onClick={() => handleReview(skill.pending_version!.version_id, "approved")} className="text-xs text-emerald-600 hover:text-emerald-800">通过</button>
                          <button type="button" onClick={() => handleReview(skill.pending_version!.version_id, "rejected")} className="text-xs text-red-600 hover:text-red-800">拒绝</button>
                        </>
                      ) : skill.status === "draft" ? (
                        /* Draft, not yet submitted for review (submission via agent MCP only) */
                        <button type="button" onClick={() => openDetail(skill.skill_id)} className="text-xs text-slate-500 hover:text-slate-800">详情</button>
                      ) : skill.status === "approved" ? (
                        /* Approved: all actions spread out */
                        <>
                          <button type="button" onClick={() => openDeploy(skill)} className="text-xs text-indigo-600 hover:text-indigo-800">下发</button>
                          <button type="button" onClick={() => openUndeploy(skill)} className="text-xs text-red-600 hover:text-red-800">取消下发</button>
                          <button type="button" onClick={() => handleDeprecate(skill.skill_id)} className="text-xs text-red-600 hover:text-red-800">废弃</button>
                        </>
                      ) : skill.status === "rejected" ? (
                        /* Rejected: view only, resubmit via agent MCP */
                        <button type="button" onClick={() => openDetail(skill.skill_id)} className="text-xs text-slate-500 hover:text-slate-800">详情</button>
                      ) : skill.status === "deprecated" ? (
                        <button type="button" onClick={() => openDetail(skill.skill_id)} className="text-xs text-slate-500 hover:text-slate-800">详情</button>
                      ) : (
                        /* pending (old flow, no pending_version) or any unknown state */
                        <button type="button" onClick={() => openDetail(skill.skill_id)} className="text-xs text-slate-500 hover:text-slate-800">详情</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail drawer */}
      {detailSkill && <DetailDrawer skill={detailSkill} onClose={() => setDetailSkill(null)} />}

      {/* Modals */}
      {extractOpen && <ExtractModal onClose={() => setExtractOpen(false)} onDone={(msg) => { setMessage(msg); loadSkills(); }} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onDone={(msg) => { setMessage(msg); loadSkills(); }} />}
      {deployOpen && (
        <DeployModalV2
          skillName={deploySkillName}
          marketVersion={deployMarketVersion}
          agents={deployAgents}
          busy={deployBusy}
          message={deployMessage}
          category={deployCategory}
          onCategoryChange={setDeployCategory}
          onAgentToggle={(agentId) => setDeployAgents(prev => prev.map(a => a.agent_id === agentId ? { ...a, selected: !a.selected } : a))}
          onDeploy={doDeploy}
          onClose={() => setDeployOpen(false)}
        />
      )}
      {undeployOpen && (
        <UndeployModal
          skillName={undeploySkillName}
          agents={undeployAgents}
          busy={undeployBusy}
          message={undeployMessage}
          onAgentToggle={(agentId) => setUndeployAgents(prev => prev.map(a => a.agent_id === agentId ? { ...a, selected: !a.selected } : a))}
          onUndeploy={doUndeploy}
          onClose={() => setUndeployOpen(false)}
        />
      )}
    </div>
  );
}

// ── Detail Drawer ───────────────────────────────────────────────────────────

function DetailDrawer({ skill, onClose }: { skill: SkillRecord; onClose: () => void }) {
  const [detailTab, setDetailTab] = useState<"content" | "versions" | "logs">("content");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
        {/* Header: name + status badge */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{skill.name}</h3>
            <Badge className={STATUS_META[skill.status]?.className || ""}>{STATUS_META[skill.status]?.label || skill.status}</Badge>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg shrink-0">✕</button>
        </div>

        {/* Info bar: version · source · date */}
        <div className="px-4 py-2.5 border-b border-slate-100 shrink-0 space-y-2">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="font-mono text-slate-700">v{skill.version}</span>
            <span className="text-slate-300">·</span>
            <span>{SOURCE_LABEL[skill.source_type || ""] || "—"}</span>
            <span className="text-slate-300">·</span>
            <span>{skill.created_at ? formatDateTimeShort(skill.created_at) : "—"}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 select-all">ID: {skill.skill_id}</div>
          {skill.description && (
            <p className="text-xs text-slate-600 leading-relaxed">{skill.description}</p>
          )}
          {(skill.tags || []).length > 0 && (
            <div className="flex gap-1 flex-wrap">{(skill.tags || []).map((t: string) => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600">{t}</span>)}</div>
          )}
        </div>

        {/* Pending version card (info only, no action buttons) */}
        {skill.pending_version && (
          <div className="px-4 py-2.5 border-b border-slate-100 shrink-0 bg-amber-50/50">
            <div className="text-xs text-amber-800 font-medium mb-1">待审核版本</div>
            <div className="flex items-center gap-3 text-xs text-amber-700">
              <span className="font-mono">v{skill.pending_version.version}</span>
              <span>提交者: <span className="font-medium">{skill.pending_version.submitted_by_agent_name || skill.pending_version.submitted_by_agent_id || "—"}</span></span>
              {skill.pending_version.submitted_at && (
                <span className="text-amber-500">{formatDateTimeShort(skill.pending_version.submitted_at)}</span>
              )}
            </div>
          </div>
        )}
        {!skill.pending_version && skill.status === "pending" && (
          <div className="px-4 py-2 border-b border-slate-100 shrink-0 bg-amber-50">
            <span className="text-xs text-amber-700">待审核（旧流程，无版本审核信息）</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0">
          {(["content", "versions", "logs"] as const).map((t) => (
            <button key={t} onClick={() => setDetailTab(t)} className={`px-4 py-2 text-xs border-b-2 transition-colors ${detailTab === t ? "border-slate-950 text-slate-950 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t === "content" ? "内容" : t === "versions" ? "版本历史" : "调用日志"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {detailTab === "content" && (
            <div className="space-y-4 text-xs text-slate-600">
              {/* Description */}
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase mb-1.5">技能描述</div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {skill.description || "暂无描述"}
                </div>
              </div>
              {/* Dependencies */}
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase mb-1.5">依赖技能</div>
                {(skill.required_skills || []).length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {(skill.required_skills || []).map((dep) => (
                      <div key={dep.skill_id} className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
                        <span className="text-xs font-medium text-indigo-700">{dep.name}</span>
                        {dep.version && <span className="text-[10px] font-mono text-indigo-400">v{dep.version}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">无</p>
                )}
              </div>
            </div>
          )}
          {detailTab === "versions" && (
            <div className="space-y-2">
              {(skill.versions || []).length === 0 && <p className="text-xs text-slate-400">暂无版本记录</p>}
              {(skill.versions || []).map((v, i) => {
                const isPending = v.status === "pending";
                const isCurrent = !isPending && (skill.versions || []).findIndex(x => x.status === "approved") === i;
                return (
                <div key={i} className={`rounded-lg border p-2.5 text-xs ${isCurrent ? "border-slate-300 bg-slate-50" : "border-slate-200"}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-700">v{v.version}</span>
                    {isCurrent && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">当前</Badge>}
                    {isPending && <Badge className="border-amber-200 bg-amber-50 text-amber-700">审核中</Badge>}
                  </div>
                  <div className="text-slate-400 mt-0.5">{v.created_at ? formatDateTimeShort(v.created_at) : "—"}</div>
                  {(v.version_notes || v.description) && <p className="text-slate-500 mt-1">{v.version_notes || v.description}</p>}
                </div>
                );
              })}
            </div>
          )}
          {detailTab === "logs" && (
            <div className="space-y-2">
              {(skill.test_runs || []).length === 0 && <p className="text-xs text-slate-400">暂无调用记录</p>}
              {(skill.test_runs || []).map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 font-medium ${
                      r.run_status === "succeeded" ? "text-emerald-600" : r.run_status === "failed" ? "text-red-600" : "text-slate-500"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        r.run_status === "succeeded" ? "bg-emerald-500" : r.run_status === "failed" ? "bg-red-500" : "bg-slate-400"
                      }`} />
                      {r.run_status === "succeeded" ? "成功" : r.run_status === "failed" ? "失败" : r.run_status}
                    </span>
                    <span className="text-slate-400">{r.created_at ? formatDateTimeShort(r.created_at) : "—"}</span>
                  </div>
                  {r.test_prompt && <p className="text-slate-600 bg-slate-50 rounded p-2 leading-relaxed">{r.test_prompt}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Extract Modal ───────────────────────────────────────────────────────────

function ExtractModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void; }) {
  const [agents, setAgents] = useState<Array<{ agent_id: string; name: string }>>([]);
  const [agentId, setAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => { adminFetch("/api/v1/agents?limit=200").then((r) => r.json().catch(() => ({}))).then((d) => setAgents((d.agents || []) as Array<{ agent_id: string; name: string }>)).catch(() => {}); }, []);

  const extract = async () => {
    if (!agentId) return; setLoading(true);
    try {
      const res = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/workspace-skills`);
      const data = await res.json().catch(() => ({}));
      const skills = (data.skills || []) as WorkspaceSkill[];
      let count = 0;
      for (const skill of skills) {
        await adminFetch("/api/v1/skills/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_id: skill.skill_id, name: skill.name, description: skill.description, source_type: "workspace", agent_id: agentId }) });
        count++;
      }
      onDone(`已提取 ${count} 个技能到草稿箱`); onClose();
    } catch (err) { setResult(err instanceof Error ? err.message : "提取失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">⬇ 从 Agent 提取技能</h3>
        <p className="text-xs text-slate-500">扫描选定 Agent 工作区中的技能目录，导入到技能草稿箱。</p>
        <div><select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">-- 选择 Agent --</option>{agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.name || a.agent_id}</option>)}</select></div>
        {result && <p className="text-xs text-red-600">{result}</p>}
        <div className="flex justify-end gap-2 pt-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button><button onClick={extract} disabled={loading || !agentId} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{loading ? "提取中…" : "提取"}</button></div>
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

// ── Deploy Modal V2 (new: tabs + deployed/undeployed groups) ───────────────

function DeployModalV2({
  skillName, marketVersion, agents, busy, message, category,
  onCategoryChange, onAgentToggle, onDeploy, onClose,
}: {
  skillName: string; marketVersion: string; agents: DeployAgentInfo[];
  busy: boolean; message: string; category: CategoryTab;
  onCategoryChange: (v: CategoryTab) => void;
  onAgentToggle: (agentId: string) => void;
  onDeploy: () => void;
  onClose: () => void;
}) {
  const filtered = agents.filter(a => a.category === category);
  const deployed = filtered.filter(a => a.deployed);
  const notDeployed = filtered.filter(a => !a.deployed);
  const totalSelected = agents.filter(a => a.selected).length;
  const willUpdate = deployed.filter(a => a.selected && !a.is_latest).length;
  const willDeploy = notDeployed.filter(a => a.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-900">下发技能 · {skillName}</h3>
            <p className="text-xs text-slate-500">市场版本 v{marketVersion}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-5 py-2 border-b border-slate-100 shrink-0">
          {(Object.entries(CATEGORY_LABELS) as [CategoryTab, string][]).map(([cat, label]) => {
            const count = agents.filter(a => a.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => onCategoryChange(cat)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${category === cat ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"}`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* Summary line */}
        {(willUpdate > 0 || willDeploy > 0) && (
          <div className="px-5 py-2 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-700 shrink-0">
            {willUpdate > 0 && <span>{willUpdate} 个将更新 · </span>}
            {willDeploy > 0 && <span>{willDeploy} 个将下发</span>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {deployed.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">已下发 — 勾选 = 更新到 v{marketVersion}</p>
              <div className="space-y-1">
                {deployed.map(a => (
                  <label key={a.agent_id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${a.is_latest ? "opacity-50 cursor-not-allowed" : a.selected ? "border-indigo-200 bg-indigo-50/50 cursor-pointer" : "border-slate-100 hover:bg-slate-50 cursor-pointer"}`}>
                    <input type="checkbox" checked={a.selected} onChange={() => onAgentToggle(a.agent_id)} disabled={a.is_latest} className="accent-indigo-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800 truncate">{a.agent_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{a.agent_id}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {a.is_latest ? (
                        <span className="text-xs text-slate-400">v{a.version} (最新)</span>
                      ) : (
                        <span className="text-xs text-amber-600 font-medium">v{a.version} → v{marketVersion}</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {notDeployed.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">未下发 — 勾选 = 首次下发</p>
              <div className="space-y-1">
                {notDeployed.map(a => (
                  <label key={a.agent_id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition ${a.selected ? "border-indigo-200 bg-indigo-50/50" : "border-slate-100 hover:bg-slate-50"}`}>
                    <input type="checkbox" checked={a.selected} onChange={() => onAgentToggle(a.agent_id)} className="accent-indigo-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800 truncate">{a.agent_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{a.agent_id}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs text-slate-400">未安装</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {message && (
          <div className={`px-5 py-3 border-t shrink-0 text-sm font-medium whitespace-pre-wrap ${
            message.includes("失败") || message.includes("请求失败")
              ? "bg-red-50 text-red-700 border-red-100"
              : message.includes("已下发")
                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                : "bg-amber-50 text-amber-700 border-amber-100"
          }`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0">
          <span className="text-xs text-slate-400">已选 {totalSelected} 个 Agent</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button onClick={onDeploy} disabled={busy || totalSelected === 0} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "下发中…" : `确认下发 (${totalSelected})`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Undeploy Modal ─────────────────────────────────────────────────────────

function UndeployModal({
  skillName, agents, busy, message,
  onAgentToggle, onUndeploy, onClose,
}: {
  skillName: string; agents: DeployAgentInfo[];
  busy: boolean; message: string;
  onAgentToggle: (agentId: string) => void;
  onUndeploy: () => void;
  onClose: () => void;
}) {
  const selected = agents.filter(a => a.selected);
  const count = selected.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-900">取消下发 · {skillName}</h3>
            <p className="text-xs text-slate-500">以下 Agent 已安装此技能，勾选后将删除文件并解绑</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        {count > 0 && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700 shrink-0">
            ⚠ 将删除 {count} 个 Agent 的技能文件 + 绑定关系
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {agents.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">暂无可取消下发的 Agent</p>
          ) : (
            agents.map(a => (
              <label key={a.agent_id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition ${a.selected ? "border-red-200 bg-red-50/50" : "border-slate-100 hover:bg-slate-50"}`}>
                <input type="checkbox" checked={a.selected} onChange={() => onAgentToggle(a.agent_id)} className="accent-red-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 truncate">{a.agent_name}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">{a.agent_id}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs text-slate-500">v{a.version}</span>
                </div>
              </label>
            ))
          )}
        </div>

        {message && (
          <div className={`px-5 py-3 border-t shrink-0 text-sm font-medium whitespace-pre-wrap ${
            message.includes("失败") || message.includes("请求失败")
              ? "bg-red-50 text-red-700 border-red-100"
              : message.includes("已取消")
                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                : "bg-amber-50 text-amber-700 border-amber-100"
          }`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0">
          <span className="text-xs text-slate-400">已选 {count}/{agents.length} 个 Agent</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button onClick={onUndeploy} disabled={busy || count === 0} className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy ? "取消下发中…" : `确认取消 (${count})`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
