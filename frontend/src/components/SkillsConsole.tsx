import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { GatewayDrawer } from "./gateway/GatewayDrawer";
import { adminFetch } from "../hooks/useAdminToken";

type SkillRecord = {
  skill_id: string;
  name: string;
  description?: string;
  version: string;
  runtime_targets: string[];
  package_url?: string;
  package_sha256?: string;
  package_bytes?: number;
  status: "approved" | "deprecated";
  visibility: "private" | "team" | "company";
  team_id?: string;
  tags?: string[];
  updated_at?: string;
};

type SkillCandidate = {
  candidate_id: string;
  engine_id: string;
  runtime_target: string;
  name: string;
  description?: string;
  team_id?: string;
  status: "pending" | "approved" | "rejected";
};

type BundleManifest = {
  bundle_id: string;
  version: string;
  channel: string;
  skills: Array<{ skill_id: string; name: string; version: string; package_url: string }>;
  signature: string;
  published_at: string;
};

type SkillsTab = "catalog" | "review" | "publish" | "discover";

type StarterCatalogEntry = {
  catalog_id: string;
  skill_id: string;
  name: string;
  description?: string;
  version: string;
  runtime_targets: string[];
  risk_level: "low" | "medium" | "high";
  tags?: string[];
  source?: { type?: string; repo?: string };
  imported?: boolean;
  enterprise_status?: string;
};

type EcosystemCatalogEntry = {
  catalog_id: string;
  name: string;
  description?: string;
  install_ref?: string;
  skills_sh_url?: string;
  install_count?: number;
  runtime_targets: string[];
  risk_level: "low" | "medium" | "high";
  tags?: string[];
  source?: { owner?: string; repo?: string; skill?: string };
  imported?: boolean;
  pending_review?: boolean;
};

type DiscoverSection = "starter" | "ecosystem";

type UploadForm = {
  skill_id: string;
  name: string;
  version: string;
  runtime_targets: string;
  visibility: string;
  team_id: string;
  tags: string;
  description: string;
};

const EMPTY_UPLOAD: UploadForm = {
  skill_id: "",
  name: "",
  version: "1.0.0",
  runtime_targets: "openclaw,hermes,skilllite",
  visibility: "team",
  team_id: "",
  tags: "",
  description: "",
};

const TABS: { id: SkillsTab; label: string; desc: string }[] = [
  { id: "discover", label: "发现", desc: "精选 / 生态" },
  { id: "catalog", label: "技能库", desc: "已发布" },
  { id: "review", label: "审核", desc: "候选" },
  { id: "publish", label: "发布", desc: "Bundle" },
];

const RISK_META: Record<string, { label: string; className: string }> = {
  low: { label: "低风险", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  medium: { label: "中风险", className: "border-amber-200 bg-amber-50 text-amber-700" },
  high: { label: "高风险", className: "border-red-200 bg-red-50 text-red-700" },
};

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{note}</div>
    </div>
  );
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export function SkillsConsole() {
  const [tab, setTab] = useState<SkillsTab>("discover");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadForm>(EMPTY_UPLOAD);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const [discoverSection, setDiscoverSection] = useState<DiscoverSection>("starter");
  const [starterSkills, setStarterSkills] = useState<StarterCatalogEntry[]>([]);
  const [ecosystemSkills, setEcosystemSkills] = useState<EcosystemCatalogEntry[]>([]);
  const [ecosystemMeta, setEcosystemMeta] = useState<{ source?: string; fetched_at?: string }>({});
  const [ecosystemQuery, setEcosystemQuery] = useState("");
  const [discoverLoading, setDiscoverLoading] = useState(false);

  const [filters, setFilters] = useState({ query: "", tag: "", runtime_target: "", status_filter: "" });
  const [bundlePublish, setBundlePublish] = useState({ bundle_id: "default-agent-skills", channel: "stable", version: "" });
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  const buildSkillsUrl = (nextFilters = filters) => {
    const params = new URLSearchParams({ limit: "200" });
    if (nextFilters.query.trim()) params.set("query", nextFilters.query.trim());
    if (nextFilters.tag.trim()) params.set("tag", nextFilters.tag.trim());
    if (nextFilters.runtime_target.trim()) params.set("runtime_target", nextFilters.runtime_target.trim());
    if (nextFilters.status_filter) params.set("status_filter", nextFilters.status_filter);
    return `/api/v1/skills?${params.toString()}`;
  };

  const loadMarket = (nextFilters = filters) => {
    setLoading(true);
    setError("");
    Promise.all([
      adminFetch("/api/v1/skill-bundles/default-agent-skills/manifest").then((r) => r.json() as Promise<{ manifest?: BundleManifest }>),
      adminFetch(buildSkillsUrl(nextFilters)).then((r) => r.json() as Promise<{ skills?: SkillRecord[] }>),
      adminFetch("/api/v1/skill-candidates?limit=200").then((r) => r.json() as Promise<{ candidates?: SkillCandidate[] }>),
    ])
      .then(([bundleData, skillData, candidateData]) => {
        const nextManifest = bundleData.manifest ?? null;
        const nextSkills = Array.isArray(skillData.skills) ? skillData.skills : [];
        setManifest(nextManifest);
        setSkills(nextSkills);
        setCandidates(Array.isArray(candidateData.candidates) ? candidateData.candidates : []);
        if (nextManifest?.skills?.length) {
          const approvedIds = new Set(nextSkills.filter((item) => item.status === "approved").map((item) => item.skill_id));
          setSelectedSkillIds(new Set(nextManifest.skills.map((item) => item.skill_id).filter((id) => approvedIds.has(id))));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDiscover = (section = discoverSection, query = ecosystemQuery) => {
    setDiscoverLoading(true);
    setError("");
    const starterReq = adminFetch("/api/v1/skill-catalog/starter").then((r) => r.json() as Promise<{ skills?: StarterCatalogEntry[] }>);
    const ecoParams = new URLSearchParams({ limit: "100" });
    if (query.trim()) ecoParams.set("query", query.trim());
    const ecosystemReq = adminFetch(`/api/v1/skill-catalog/ecosystem?${ecoParams}`).then(
      (r) => r.json() as Promise<{ skills?: EcosystemCatalogEntry[]; catalog?: { source?: string; fetched_at?: string } }>,
    );
    Promise.all([starterReq, ecosystemReq])
      .then(([starterData, ecosystemData]) => {
        setStarterSkills(Array.isArray(starterData.skills) ? starterData.skills : []);
        setEcosystemSkills(Array.isArray(ecosystemData.skills) ? ecosystemData.skills : []);
        setEcosystemMeta(ecosystemData.catalog ?? {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载发现目录失败"))
      .finally(() => setDiscoverLoading(false));
  };

  useEffect(() => {
    if (tab === "discover") loadDiscover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const pending = candidates.filter((item) => item.status === "pending");
  const approvedSkills = skills.filter((item) => item.status === "approved");
  const approvedCount = skills.filter((item) => item.status !== "deprecated").length;
  const deprecatedCount = skills.filter((item) => item.status === "deprecated").length;

  const closeUpload = () => {
    setUploadOpen(false);
    setUploadForm(EMPTY_UPLOAD);
    setUploadFile(null);
  };

  const submitUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!uploadFile) {
      setError("请选择 .skill.zip 包");
      return;
    }
    if (!uploadForm.skill_id.trim() || !uploadForm.name.trim()) {
      setError("请填写 skill_id 与名称");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const content_base64 = await fileToBase64(uploadFile);
      const res = await adminFetch("/api/v1/skill-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...uploadForm,
          runtime_targets: uploadForm.runtime_targets.split(",").map((v) => v.trim()).filter(Boolean),
          tags: uploadForm.tags.split(",").map((v) => v.trim()).filter(Boolean),
          filename: uploadFile.name,
          content_base64,
        }),
      });
      if (!res.ok) throw new Error(`上传失败 (${res.status})`);
      setMessage("Skill 包已上传，请在「发布」Tab 勾选并发布 Bundle。");
      closeUpload();
      setTab("publish");
      loadMarket();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const reviewCandidate = async (candidate: SkillCandidate, decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/skill-candidates/${encodeURIComponent(candidate.candidate_id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reviewer: "admin",
          reason: decision === "approved" ? "approved from console" : "rejected from console",
          visibility: candidate.team_id ? "team" : "company",
          promotion_channel: decision === "approved" ? "stable" : undefined,
        }),
      });
      if (!res.ok) throw new Error(`审核失败 (${res.status})`);
      setMessage(decision === "approved" ? "已批准并进入市场" : "已拒绝");
      loadMarket();
    } catch (err) {
      setError(err instanceof Error ? err.message : "审核失败");
    } finally {
      setBusy(false);
    }
  };

  const downloadSkillPackage = async (skill: SkillRecord) => {
    if (!skill.package_url) return;
    const res = await adminFetch(skill.package_url);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.skill_id}.skill.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deprecateSkill = async (skill: SkillRecord) => {
    if (!window.confirm(`确定下线「${skill.name}」？`)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/skills/${encodeURIComponent(skill.skill_id)}/deprecate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "deprecated from console", reviewer: "admin" }),
      });
      if (!res.ok) throw new Error(`下线失败 (${res.status})`);
      setMessage(`已下线 ${skill.skill_id}`);
      loadMarket();
    } catch (err) {
      setError(err instanceof Error ? err.message : "下线失败");
    } finally {
      setBusy(false);
    }
  };

  const publishBundle = async (includeAllApproved: boolean) => {
    const skill_ids = includeAllApproved ? [] : Array.from(selectedSkillIds);
    if (!includeAllApproved && !skill_ids.length) {
      setError("请至少选择一个 skill");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch(`/api/v1/skill-bundles/${encodeURIComponent(bundlePublish.bundle_id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: bundlePublish.channel,
          version: bundlePublish.version.trim() || null,
          skill_ids,
          include_all_approved: includeAllApproved,
        }),
      });
      const data = await res.json() as { detail?: string; manifest?: BundleManifest };
      if (!res.ok) throw new Error(data.detail || `发布失败 (${res.status})`);
      setMessage(`Bundle 已发布 ${data.manifest?.bundle_id}@${data.manifest?.version}`);
      loadMarket();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleSkillSelection = (skillId: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const importStarter = async (catalogId: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/skill-catalog/starter/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalog_id: catalogId, auto_approve: true }),
      });
      const data = await res.json() as { detail?: string; skill?: SkillRecord };
      if (!res.ok) throw new Error(data.detail || `导入失败 (${res.status})`);
      setMessage(`已导入精选技能 ${data.skill?.name ?? catalogId}`);
      loadMarket();
      loadDiscover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const importAllStarters = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/skill-catalog/starter/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_all: true, auto_approve: true }),
      });
      const data = await res.json() as { detail?: string; count?: number };
      if (!res.ok) throw new Error(data.detail || `导入失败 (${res.status})`);
      setMessage(`已导入 ${data.count ?? 0} 个 Evotown 精选技能，可在「发布」Tab 写入 Bundle。`);
      setTab("publish");
      loadMarket();
      loadDiscover();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量导入失败");
    } finally {
      setBusy(false);
    }
  };

  const syncEcosystem = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/skill-catalog/ecosystem/sync", { method: "POST" });
      const data = await res.json() as { detail?: string; count?: number; source?: string };
      if (!res.ok) throw new Error(data.detail || `同步失败 (${res.status})`);
      setMessage(`生态索引已同步（${data.count ?? 0} 条，来源 ${data.source ?? "bundled"}）`);
      loadDiscover("ecosystem");
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  };

  const importEcosystem = async (catalogId: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/skill-catalog/ecosystem/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalog_id: catalogId, runtime_target: "skilllite" }),
      });
      const data = await res.json() as { detail?: string; candidate?: SkillCandidate };
      if (!res.ok) throw new Error(data.detail || `导入失败 (${res.status})`);
      setMessage(`「${data.candidate?.name ?? catalogId}」已提交审核，请至「审核」Tab 处理。`);
      setTab("review");
      loadMarket();
      loadDiscover("ecosystem");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const starterPendingCount = starterSkills.filter((s) => !s.imported).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">
          私有 SkillHub：上传 → 审核 → 发布 Bundle → 员工通过 manifest 拉取。
          <Link to="/market" className="ml-2 font-medium text-violet-600 hover:text-violet-700">打开市场前台 →</Link>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => loadMarket()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {loading ? "刷新中…" : "刷新"}
          </button>
          <button type="button" onClick={() => { setUploadOpen(true); setError(""); }} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">
            上传 Skill 包
          </button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="可用" value={approvedCount} note="approved" />
        <StatCard label="已下线" value={deprecatedCount} note="deprecated" />
        <StatCard label="待审核" value={pending.length} note="候选" />
        <StatCard label="Bundle" value={manifest?.skills.length ?? "—"} note={manifest ? `${manifest.bundle_id}@${manifest.version}` : "未发布"} />
      </section>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error && !uploadOpen && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.id ? "border border-b-white border-slate-200 bg-white text-slate-950 -mb-px" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {item.label}
            <span className="ml-2 hidden text-xs font-normal text-slate-400 sm:inline">{item.desc}</span>
            {item.id === "review" && pending.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{pending.length}</span>
            )}
            {item.id === "discover" && starterPendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-800">{starterPendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "discover" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDiscoverSection("starter")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${discoverSection === "starter" ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Evotown 精选
              </button>
              <button
                type="button"
                onClick={() => setDiscoverSection("ecosystem")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${discoverSection === "ecosystem" ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                开放生态
              </button>
            </div>
            {discoverSection === "starter" ? (
              <button type="button" disabled={busy} onClick={importAllStarters} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                一键导入全部精选
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  placeholder="搜索生态技能…"
                  value={ecosystemQuery}
                  onChange={(e) => setEcosystemQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadDiscover("ecosystem", ecosystemQuery)}
                />
                <button type="button" onClick={() => loadDiscover("ecosystem", ecosystemQuery)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700">
                  搜索
                </button>
                <button type="button" disabled={busy} onClick={syncEcosystem} className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm font-medium text-violet-700 disabled:opacity-50">
                  同步索引
                </button>
              </div>
            )}
          </div>

          {discoverSection === "starter" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-4 text-sm text-slate-500">
                Evotown 内置 arena_skills 精选包，可直接导入企业技能库（approved），无需审核。
              </p>
              {discoverLoading ? (
                <p className="py-12 text-center text-sm text-slate-500">加载中…</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {starterSkills.map((entry) => {
                    const risk = RISK_META[entry.risk_level] ?? RISK_META.medium;
                    return (
                      <article key={entry.catalog_id} className="flex flex-col rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-slate-950">{entry.name}</h3>
                            <p className="mt-1 font-mono text-xs text-slate-400">{entry.skill_id}</p>
                          </div>
                          <Badge className={risk.className}>{risk.label}</Badge>
                        </div>
                        <p className="mt-2 flex-1 text-sm text-slate-600 line-clamp-3">{entry.description}</p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {entry.runtime_targets.slice(0, 3).map((rt) => (
                            <Badge key={rt} className="border-slate-200 bg-slate-50 text-slate-600">{rt}</Badge>
                          ))}
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-2">
                          {entry.imported ? (
                            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">已导入</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">未导入</span>
                          )}
                          <button
                            type="button"
                            disabled={busy || entry.imported}
                            onClick={() => importStarter(entry.catalog_id)}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {entry.imported ? "已在库中" : "导入到企业库"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {discoverSection === "ecosystem" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-1 text-sm text-slate-500">
                开放 Agent Skills 生态（skills.sh 策展索引）。导入后进入「审核」Tab，批准后方可发布 Bundle。
              </p>
              {ecosystemMeta.fetched_at && (
                <p className="mb-4 text-xs text-slate-400">
                  索引来源 {ecosystemMeta.source ?? "bundled"} · 更新于 {formatDate(ecosystemMeta.fetched_at)}
                </p>
              )}
              {discoverLoading ? (
                <p className="py-12 text-center text-sm text-slate-500">加载中…</p>
              ) : !ecosystemSkills.length ? (
                <p className="py-12 text-center text-sm text-slate-500">没有匹配的生态技能</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {ecosystemSkills.map((entry) => {
                    const risk = RISK_META[entry.risk_level] ?? RISK_META.medium;
                    const sourceLabel = entry.source?.owner && entry.source?.repo
                      ? `${entry.source.owner}/${entry.source.repo}`
                      : entry.install_ref ?? "—";
                    return (
                      <article key={entry.catalog_id} className="flex flex-col rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-slate-950">{entry.name}</h3>
                            <p className="mt-1 truncate text-xs text-slate-400">{sourceLabel}</p>
                          </div>
                          <Badge className={risk.className}>{risk.label}</Badge>
                        </div>
                        <p className="mt-2 flex-1 text-sm text-slate-600 line-clamp-3">{entry.description}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {typeof entry.install_count === "number" && entry.install_count > 0 && (
                            <span>≈ {entry.install_count.toLocaleString()} 安装</span>
                          )}
                          {entry.skills_sh_url && (
                            <a href={entry.skills_sh_url} target="_blank" rel="noreferrer" className="font-medium text-violet-600 hover:underline">
                              skills.sh
                            </a>
                          )}
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-2">
                          {entry.imported ? (
                            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">已入库</Badge>
                          ) : entry.pending_review ? (
                            <Badge className="border-amber-200 bg-amber-50 text-amber-700">待审核</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">未导入</span>
                          )}
                          <button
                            type="button"
                            disabled={busy || entry.imported || entry.pending_review}
                            onClick={() => importEcosystem(entry.catalog_id)}
                            className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 disabled:opacity-50"
                          >
                            {entry.pending_review ? "审核中" : "导入待审核"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "catalog" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-2">
            <input
              className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="搜索名称或描述"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && loadMarket(filters)}
            />
            <input
              className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="tag"
              value={filters.tag}
              onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            />
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.runtime_target} onChange={(e) => setFilters({ ...filters, runtime_target: e.target.value })}>
              <option value="">全部 runtime</option>
              <option value="openclaw">openclaw</option>
              <option value="hermes">hermes</option>
              <option value="skilllite">skilllite</option>
              <option value="custom">custom</option>
            </select>
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.status_filter} onChange={(e) => setFilters({ ...filters, status_filter: e.target.value })}>
              <option value="">全部状态</option>
              <option value="approved">approved</option>
              <option value="deprecated">deprecated</option>
            </select>
            <button type="button" onClick={() => loadMarket(filters)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white">筛选</button>
          </div>

          {!skills.length ? (
            <p className="py-12 text-center text-sm text-slate-500">没有匹配的技能</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">Skill</th>
                    <th className="hidden px-3 py-2.5 md:table-cell">Runtime</th>
                    <th className="px-3 py-2.5">状态</th>
                    <th className="w-24 px-3 py-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {skills.map((skill) => (
                    <tr key={skill.skill_id}>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900">{skill.name}</div>
                        <div className="font-mono text-xs text-slate-500">{skill.skill_id} · v{skill.version}</div>
                        {skill.tags?.length ? <div className="text-xs text-slate-400">{skill.tags.join(", ")}</div> : null}
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs text-slate-600 md:table-cell">{skill.runtime_targets.join(", ")}</td>
                      <td className="px-3 py-2.5">
                        <Badge className={skill.status === "deprecated" ? "border-slate-200 bg-slate-100 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                          {skill.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          {skill.package_url && (
                            <button type="button" onClick={() => downloadSkillPackage(skill)} className="text-xs text-blue-600 hover:text-blue-800">下载</button>
                          )}
                          {skill.status !== "deprecated" && (
                            <button type="button" disabled={busy} onClick={() => deprecateSkill(skill)} className="text-xs text-red-600 hover:text-red-800">下线</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "review" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {!candidates.length ? (
            <p className="py-12 text-center text-sm text-slate-500">暂无候选技能</p>
          ) : (
            <ul className="space-y-3">
              {candidates.map((candidate) => (
                <li key={candidate.candidate_id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-950">{candidate.name}</div>
                      <p className="mt-1 text-sm text-slate-500">{candidate.description || "无描述"}</p>
                      <p className="mt-2 text-xs text-slate-400">{candidate.runtime_target} · {candidate.engine_id} · {candidate.team_id || "无团队"}</p>
                    </div>
                    <Badge
                      className={
                        candidate.status === "pending"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : candidate.status === "approved"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-red-200 bg-red-50 text-red-700"
                      }
                    >
                      {candidate.status}
                    </Badge>
                  </div>
                  {candidate.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={busy} onClick={() => reviewCandidate(candidate, "approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">批准</button>
                      <button type="button" disabled={busy} onClick={() => reviewCandidate(candidate, "rejected")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600">拒绝</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "publish" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-base font-semibold text-slate-950">发布 Bundle</h3>
            <p className="mt-1 text-sm text-slate-500">员工 evotown-agent-setup sync 拉取的是本步骤结果。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="bundle_id" value={bundlePublish.bundle_id} onChange={(e) => setBundlePublish({ ...bundlePublish, bundle_id: e.target.value })} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="channel" value={bundlePublish.channel} onChange={(e) => setBundlePublish({ ...bundlePublish, channel: e.target.value })} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="version（可选）" value={bundlePublish.version} onChange={(e) => setBundlePublish({ ...bundlePublish, version: e.target.value })} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setSelectedSkillIds(new Set(approvedSkills.map((s) => s.skill_id)))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">全选已批准</button>
              <button type="button" disabled={busy} onClick={() => publishBundle(false)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white">发布选中 ({selectedSkillIds.size})</button>
              <button type="button" disabled={busy} onClick={() => publishBundle(true)} className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700">发布全部已批准</button>
            </div>
            <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3">
              {approvedSkills.length ? approvedSkills.map((skill) => (
                <label key={skill.skill_id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedSkillIds.has(skill.skill_id)} onChange={() => toggleSkillSelection(skill.skill_id)} />
                  <span className="font-medium text-slate-900">{skill.name}</span>
                  <span className="font-mono text-xs text-slate-400">{skill.skill_id}</span>
                </label>
              )) : <p className="text-sm text-slate-500">暂无已批准 skill</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-base font-semibold text-slate-950">当前 Manifest</h3>
            <p className="mt-1 text-sm text-slate-500">运行端 bootstrap 初始化包。</p>
            {manifest ? (
              <div className="mt-4 space-y-2">
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="font-mono font-semibold text-slate-900">{manifest.bundle_id}@{manifest.version}</div>
                  <div className="mt-1 text-xs text-slate-500">{manifest.channel} · {formatDate(manifest.published_at)}</div>
                </div>
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {manifest.skills.map((skill) => (
                    <li key={skill.skill_id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium text-slate-900">{skill.name}</div>
                        <div className="font-mono text-[11px] text-slate-400">{skill.skill_id}</div>
                      </div>
                      <Badge className="border-slate-200 bg-white text-slate-600">v{skill.version}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-8 text-center text-sm text-slate-500">尚未发布 manifest</p>
            )}
          </div>
        </div>
      )}

      <GatewayDrawer open={uploadOpen} title="上传 Skill 包" subtitle="上传后请在「发布」Tab 写入 Bundle manifest" onClose={closeUpload}>
        {error && uploadOpen && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={submitUpload} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">skill_id *</span>
            <input value={uploadForm.skill_id} onChange={(e) => setUploadForm({ ...uploadForm, skill_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono" required />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">名称 *</span>
            <input value={uploadForm.name} onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">版本</span>
              <input value={uploadForm.version} onChange={(e) => setUploadForm({ ...uploadForm, version: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">team_id</span>
              <input value={uploadForm.team_id} onChange={(e) => setUploadForm({ ...uploadForm, team_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">runtime_targets</span>
            <input value={uploadForm.runtime_targets} onChange={(e) => setUploadForm({ ...uploadForm, runtime_targets: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="openclaw,hermes,skilllite" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">tags</span>
            <input value={uploadForm.tags} onChange={(e) => setUploadForm({ ...uploadForm, tags: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="crm,private" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">描述</span>
            <textarea value={uploadForm.description} onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">包文件 *</span>
            <input type="file" accept=".zip,.skill.zip" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" required />
          </label>
          <div className="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeUpload} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700">取消</button>
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white disabled:opacity-50">上传</button>
          </div>
        </form>
      </GatewayDrawer>
    </div>
  );
}
