import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";
import { formatDateTime } from "../lib/datetime";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(v: string | null | undefined): string {
  return formatDateTime(v, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

type McpService = {
  service_id: string; name: string; description: string;
  status: string; source: string; endpoint_url: string;
  mcp_path: string; category: string; version: string;
  dimensions: string; tables: string;
  input_schema: string; output_schema: string;
  created_at: string; updated_at: string;
  bound_agents?: number; calls_24h?: number;
  has_pending_version?: boolean;
  latest_version_status?: string | null;
};

type McpVersion = {
  version_id: string; service_id: string; version: string;
  version_notes: string;
  snapshot_dimensions: string; snapshot_tables: string;
  snapshot_input_schema?: string; snapshot_output_schema?: string;
  status: string;
  submitted_by_agent_id: string; submitted_by_account: string;
  submitted_by_agent_name?: string; submitted_by_account_name?: string;
  submitted_at: string; reviewed_by: string; reviewed_at: string;
  review_comment: string;
};

type McpSource = "internal" | "external" | "system";

type McpTab = { key: McpSource; label: string };

const SOURCE_TABS: McpTab[] = [
  { key: "internal", label: "内部 MCP" },
  { key: "external", label: "外部 MCP" },
  { key: "system", label: "系统 MCP" },
];

const SOURCE_LABELS: Record<string, string> = {
  internal: "内部", external: "外部", system: "系统",
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线", offline: "离线", pending: "待审核",
  approved: "已通过", rejected: "已驳回", deprecated: "已废弃",
};

const COPY = {
  zh: {
    title: "MCP 服务管理",
    subtitle: "管理 MCP 服务注册、编辑和启停状态。",
    refresh: "刷新",
    search: "搜索",
    searchPlaceholder: "名称模糊 / ID 精准",
    add: "新增",
    edit: "编辑",
    delete: "删除",
    save: "保存",
    saving: "保存中…",
    deleteConfirm: "确定删除此 MCP 服务？",
    deleteConfirmInternal: "确定删除此内部 MCP 服务？将同时删除：\n• 数据库记录（服务、策略、版本历史、调用日志）\n• 开发目录文件\n• 生产目录文件\n此操作不可撤销。",
    deleteSuccess: "删除成功",
    noServices: "暂无 MCP 服务",
    name: "名称",
    serviceId: "服务 ID",
    description: "描述",
    status: "状态",
    operation: "操作",
    source: "来源",
    endpoint: "端点",
    version: "版本",
    dimensions: "数据权限维度",
    path: "分类路径",
    online: "在线",
    offline: "离线",
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回",
    approve: "通过",
    reject: "驳回",
    review: "审核",
    reviewTitle: "审核确认",
    reviewPlaceholder: "审核备注（可选）",
    reviewActions: "选择通过或驳回",
    noVersions: "暂无提交记录",
    createTitle: "新增 MCP 服务",
    editTitle: "编辑 MCP 服务",
    namePlaceholder: "MCP 服务名称",
    descPlaceholder: "描述信息",
    endpointPlaceholder: "https://...",
    nameRequired: "名称不能为空",
    auditStatus: "审核状态",
    detail: "详情",
    detailTitle: "MCP 服务详情",
    basicInfo: "基本信息",
    auditRecords: "审核记录",
    bound: "已绑定",
    calls24h: "24h调用",
    serviceStatus: "服务状态",
    view: "查看",
    noAuditStatus: "-",
    toggleOnline: "上线",
    toggleOffline: "下线",
  },
  en: {
    title: "MCP Services",
    subtitle: "Manage MCP service registration, editing, and status.",
    refresh: "Refresh",
    search: "Search",
    searchPlaceholder: "Name fuzzy / ID exact",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    saving: "Saving…",
    deleteConfirm: "Delete this MCP service?",
    deleteConfirmInternal: "Delete this internal MCP service? This will also delete:\n• Database records (service, policies, versions, call logs)\n• Development directory files\n• Production directory files\nThis action cannot be undone.",
    deleteSuccess: "Deleted successfully",
    noServices: "No MCP services",
    name: "Name",
    serviceId: "Service ID",
    description: "Description",
    status: "Status",
    operation: "Actions",
    source: "Source",
    endpoint: "Endpoint",
    version: "Version",
    dimensions: "Permissions",
    path: "Path",
    online: "Online",
    offline: "Offline",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    approve: "Approve",
    reject: "Reject",
    review: "Review",
    reviewTitle: "Review Confirmation",
    reviewPlaceholder: "Review comment (optional)",
    reviewActions: "Approve or reject this submission",
    versionHistory: "Version History",
    noVersions: "No versions",
    createTitle: "Create MCP Service",
    editTitle: "Edit MCP Service",
    namePlaceholder: "Service name",
    descPlaceholder: "Description",
    endpointPlaceholder: "https://...",
    nameRequired: "Name is required",
    auditStatus: "Audit",
    detail: "Detail",
    detailTitle: "MCP Service Detail",
    basicInfo: "Basic Info",
    auditRecords: "Audit Records",
    bound: "Bound",
    calls24h: "24h Calls",
    serviceStatus: "Status",
    view: "View",
    noAuditStatus: "-",
    toggleOnline: "Online",
    toggleOffline: "Offline",
  },
};

// ── Component ──────────────────────────────────────────────────────────────

export function McpPanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [tab, setTab] = useState<McpSource>("internal");
  const [services, setServices] = useState<McpService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  // Drawer state (create/edit)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSvc, setEditingSvc] = useState<McpService | null>(null);

  // Delete confirm
  const [deletingSvc, setDeletingSvc] = useState<McpService | null>(null);
  const [deleteResult, setDeleteResult] = useState<string>("");

  // Review state
  const [reviewingSvc, setReviewingSvc] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");

  // Detail drawer (MCP full info + audit records)
  const [detailSvc, setDetailSvc] = useState<McpService | null>(null);

  // Detail drawer (bindings / calls)
  const [detail, setDetail] = useState<{ type: "bindings" | "calls"; serviceId: string; name: string } | null>(null);

  const load = async () => {
    setMessage("");
    setLoading(true);
    try {
      const params = new URLSearchParams({ source: tab });
      if (search.trim()) params.set("search", search.trim());
      const data = await adminFetch(`/api/v1/mcp-services?${params}`).then(r => r.json());
      setServices(data.services ?? []);
    } catch (err) { setMessage(err instanceof Error ? err.message : "加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [tab]);

  const handleSearch = (e: FormEvent) => { e.preventDefault(); void load(); };

  const openCreate = () => { setEditingSvc(null); setDrawerOpen(true); };

  const openEdit = (svc: McpService) => { setEditingSvc(svc); setDrawerOpen(true); };

  const toggleStatus = async (svc: McpService) => {
    const newStatus = svc.status === "online" ? "offline" : "online";
    try {
      await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(svc.service_id)}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      void load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "切换失败"); }
  };

  const handleDelete = async () => {
    if (!deletingSvc) return;
    try {
      const res = await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(deletingSvc.service_id)}`, { method: "DELETE" });
      const data = await res.json();
      const dirs = data.cleaned_dirs || [];
      const tables = data.cleaned_tables || [];
      const dirList = dirs.length > 0 ? "\n已清理目录:\n" + dirs.map((d: string) => "  " + d).join("\n") : "";
      const tableList = tables.length > 0 ? "\n已清理数据表: " + tables.join(", ") : "";
      setDeleteResult(copy.deleteSuccess + tableList + dirList);
      setDeletingSvc(null);
      void load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "删除失败"); setDeletingSvc(null); }
  };

  const openReview = (svc: McpService) => {
    setReviewingSvc(svc.service_id);
    setReviewComment("");
  };

  const doApprove = async () => {
    if (!reviewingSvc) return;
    try {
      await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(reviewingSvc)}/approve`, {
        method: "POST",
        body: JSON.stringify({ review_comment: reviewComment }),
      });
      setReviewingSvc(null);
      void load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "审核失败"); }
  };

  const doReject = async () => {
    if (!reviewingSvc) return;
    try {
      await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(reviewingSvc)}/reject`, {
        method: "POST",
        body: JSON.stringify({ review_comment: reviewComment }),
      });
      setReviewingSvc(null);
      void load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "驳回失败"); }
  };

  const parseDimensions = (dims: string): string => {
    try { const arr = JSON.parse(dims); return Array.isArray(arr) ? arr.join(", ") : dims || "-"; }
    catch { return dims || "-"; }
  };

  const showAdd = tab === "external";
  const showReview = (svc: McpService) => tab === "internal" && svc.has_pending_version === true;

  // Audit status badge helper
  const auditBadge = (svc: McpService) => {
    const st = svc.latest_version_status;
    if (!st) return <span className="text-xs text-slate-300">{copy.noAuditStatus}</span>;
    const labels: Record<string, string> = { pending: copy.pending, approved: copy.approved, rejected: copy.rejected };
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        st === "pending" ? "border-amber-200 bg-amber-50 text-amber-700" :
        st === "approved" ? "border-green-200 bg-green-50 text-green-700" :
        st === "rejected" ? "border-red-200 bg-red-50 text-red-600" :
        "border-slate-200 bg-slate-50 text-slate-500"
      }`}>
        {st === "pending" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>}
        {labels[st] || st}
      </span>
    );
  };

  // Count pending
  const pendingCount = services.filter(s => s.has_pending_version).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-600 to-purple-700 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">MCP</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2>
            <p className="mt-2 text-sm text-violet-100">{copy.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "internal" && pendingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-violet-100">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                {copy.pending} <strong className="text-white">{pendingCount}</strong>
              </span>
            )}
            <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/20 disabled:opacity-50">{loading ? "…" : copy.refresh}</button>
          </div>
        </div>
      </section>

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      {/* Tab bar + search + add */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {SOURCE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-violet-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={copy.searchPlaceholder}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 w-full max-w-xs"
          />
          <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">{copy.search}</button>
        </form>
        {showAdd && (
          <button onClick={openCreate} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">{copy.add}</button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => (<div key={i} className="rounded-xl border border-slate-200 bg-white p-4"><div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100" /></div>))}</div>
      ) : services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-2xl">🔌</div><p className="mx-auto max-w-md text-sm text-slate-500">{copy.noServices}</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                <th className="px-4 py-3">{copy.name}</th>
                <th className="px-4 py-3">{copy.serviceId}</th>
                <th className="px-4 py-3">{copy.version}</th>
                {tab === "internal" && <th className="px-4 py-3">{copy.dimensions}</th>}
                {tab === "internal" && <th className="px-4 py-3">{copy.path}</th>}
                <th className="px-4 py-3">{copy.source}</th>
                <th className="px-4 py-3">{copy.bound}</th>
                <th className="px-4 py-3">{copy.calls24h}</th>
                <th className="px-4 py-3">{copy.serviceStatus}</th>
                {tab === "internal" && <th className="px-4 py-3">{copy.auditStatus}</th>}
                <th className="px-4 py-3">{copy.operation}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((svc) => (
                <tr key={svc.service_id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      {svc.name}
                      {svc.has_pending_version && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="有待审核"></span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{svc.service_id}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{svc.version || "-"}</td>
                  {tab === "internal" && <td className="px-4 py-3 max-w-[120px] truncate text-xs text-slate-500">{parseDimensions(svc.dimensions)}</td>}
                  {tab === "internal" && <td className="px-4 py-3 font-mono text-xs text-slate-400">{svc.mcp_path || "-"}</td>}
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      svc.source === "internal" ? "border-sky-200 bg-sky-50 text-sky-700" :
                      svc.source === "external" ? "border-amber-200 bg-amber-50 text-amber-700" :
                      "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}>{SOURCE_LABELS[svc.source] || svc.source}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    <button onClick={() => setDetail({ type: "bindings", serviceId: svc.service_id, name: svc.name })} className="text-violet-600 hover:text-violet-800 underline cursor-pointer">{svc.bound_agents ?? "-"}</button>
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    <button onClick={() => setDetail({ type: "calls", serviceId: svc.service_id, name: svc.name })} className="text-violet-600 hover:text-violet-800 underline cursor-pointer">{svc.calls_24h ?? "-"}</button>
                  </td>
                  <td className="px-4 py-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={svc.status === "online"}
                        onChange={() => toggleStatus(svc)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600" />
                      <span className="ml-2 text-xs text-slate-500">{svc.status === "online" ? copy.online : copy.offline}</span>
                    </label>
                  </td>
                  {/* ★ NEW: 审核状态列 */}
                  {tab === "internal" && <td className="px-4 py-3">{auditBadge(svc)}</td>}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {/* Detail button always shown for internal */}
                      {tab === "internal" && (
                        <button onClick={() => setDetailSvc(svc)} className="rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors">{copy.detail}</button>
                      )}
                      {showReview(svc) ? (
                        <button onClick={() => openReview(svc)} className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">{copy.review}</button>
                      ) : tab !== "system" ? (
                        <>
                          <button onClick={() => openEdit(svc)} className="text-xs text-violet-600 hover:text-violet-800">{copy.edit}</button>
                          <button onClick={() => setDeletingSvc(svc)} className="text-xs text-red-500 hover:text-red-700">{copy.delete}</button>
                        </>
                      ) : (
                        <button onClick={() => openEdit(svc)} className="text-xs text-slate-500 hover:text-slate-700">{copy.view}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer (create/edit) */}
      {drawerOpen && (
        <McpDrawer
          locale={locale}
          service={editingSvc}
          source={tab}
          readonly={tab === "system" || (tab === "internal" && editingSvc !== null)}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => { setDrawerOpen(false); void load(); }}
        />
      )}

      {/* Delete confirm */}
      {deletingSvc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setDeletingSvc(null); setDeleteResult(""); }} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900">{copy.delete}</h3>
            <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">
              {deletingSvc.source === "internal" ? copy.deleteConfirmInternal : copy.deleteConfirm}
            </p>
            {deletingSvc.source === "internal" && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-mono text-amber-800">
                  服务 ID: {deletingSvc.service_id}<br/>
                  路径: {deletingSvc.mcp_path || "-"}
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => { setDeletingSvc(null); setDeleteResult(""); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleDelete} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">{copy.delete}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete result toast */}
      {deleteResult && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-xl border border-green-200 bg-green-50 p-4 shadow-lg">
          <p className="text-sm text-green-800 whitespace-pre-line">{deleteResult}</p>
          <button onClick={() => setDeleteResult("")} className="mt-2 text-xs text-green-600 hover:text-green-800 underline">关闭</button>
        </div>
      )}

      {/* Review modal */}
      {reviewingSvc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setReviewingSvc(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900">{copy.reviewTitle}</h3>
            <p className="text-xs text-slate-500 mt-1">{copy.reviewActions}</p>
            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder={copy.reviewPlaceholder}
              rows={2}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setReviewingSvc(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={doApprove} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">{copy.approve}</button>
              <button onClick={doReject} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">{copy.reject}</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ NEW: MCP Detail Drawer (full info + audit records) */}
      {detailSvc && (
        <McpDetailDrawer
          locale={locale}
          service={detailSvc}
          onClose={() => setDetailSvc(null)}
          onRefresh={() => void load()}
        />
      )}

      {/* Detail drawer (bindings / calls) */}
      {detail && (
        <DetailDrawer
          locale={locale}
          type={detail.type}
          serviceId={detail.serviceId}
          name={detail.name}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ── MCP Detail Drawer (full info + audit records) ────────────────────────

function McpDetailDrawer({
  locale, service, onClose, onRefresh,
}: {
  locale: Locale;
  service: McpService;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const copy = COPY[locale];
  const [versions, setVersions] = useState<McpVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadVersions();
  }, [service.service_id]);

  const loadVersions = async () => {
    setLoading(true);
    try {
      const data = await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(service.service_id)}/versions`).then(r => r.json());
      setVersions(data.versions ?? []);
    } catch { setVersions([]); }
    finally { setLoading(false); }
  };

  const handleApproveVersion = async (versionId: string) => {
    try {
      await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(service.service_id)}/approve`, {
        method: "POST",
        body: JSON.stringify({ review_comment: "" }),
      });
      onRefresh();
      void loadVersions();
    } catch { /* ignore */ }
  };

  const handleRejectVersion = async () => {
    const comment = window.prompt(copy.reviewPlaceholder);
    if (comment === null) return;
    try {
      await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(service.service_id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ review_comment: comment }),
      });
      onRefresh();
      void loadVersions();
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 shrink-0 bg-slate-50/50">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{copy.detailTitle} — {service.name}</h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{service.service_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Section 1: Basic Info */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{copy.basicInfo}</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.name}</div>
                <div className="text-sm font-medium text-slate-900 mt-0.5">{service.name}</div>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.serviceId}</div>
                <div className="text-sm font-mono text-slate-700 mt-0.5">{service.service_id}</div>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.source}</div>
                <div className="text-sm mt-0.5">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0 text-xs font-medium ${
                    service.source === "internal" ? "border-sky-200 bg-sky-50 text-sky-700" :
                    service.source === "external" ? "border-amber-200 bg-amber-50 text-amber-700" :
                    "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}>{SOURCE_LABELS[service.source] || service.source}</span>
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.serviceStatus}</div>
                <div className="text-sm mt-0.5">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0 text-xs font-medium ${
                    service.status === "online" ? "border-green-200 bg-green-50 text-green-700" :
                    service.status === "offline" ? "border-slate-200 bg-slate-50 text-slate-500" :
                    "border-slate-200 bg-slate-50 text-slate-500"
                  }`}>{STATUS_LABELS[service.status] || service.status}</span>
                </div>
              </div>
              {service.mcp_path && (
                <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.path}</div>
                  <div className="text-sm font-mono text-slate-700 mt-0.5">{service.mcp_path}</div>
                </div>
              )}
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.version}</div>
                <div className="text-sm font-mono text-slate-700 mt-0.5">{service.version || "-"}</div>
              </div>
            </div>

            {/* Full-width fields */}
            <div className="mt-3 space-y-3">
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.description}</div>
                <div className="text-sm text-slate-700 mt-0.5">{service.description || "-"}</div>
              </div>
              {service.endpoint_url && (
                <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.endpoint}</div>
                  <div className="text-sm font-mono text-slate-600 mt-0.5 break-all">{service.endpoint_url}</div>
                </div>
              )}
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">{copy.dimensions}</div>
                <div className="text-sm text-slate-700 mt-0.5">{service.dimensions && service.dimensions !== "[]" ? service.dimensions : "-"}</div>
              </div>
              {service.tables && service.tables !== "[]" && (
                <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">数据表</div>
                  <div className="text-sm font-mono text-slate-600 mt-0.5">{service.tables}</div>
                </div>
              )}
              {/* Input/Output schema (collapsible) */}
              {service.input_schema && service.input_schema !== "{}" && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-violet-600 hover:text-violet-800 select-none">Input Schema</summary>
                  <pre className="mt-2 bg-slate-50 rounded-lg p-3 text-xs font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap">{service.input_schema}</pre>
                </details>
              )}
              {service.output_schema && service.output_schema !== "{}" && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-violet-600 hover:text-violet-800 select-none">Output Schema</summary>
                  <pre className="mt-2 bg-slate-50 rounded-lg p-3 text-xs font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap">{service.output_schema}</pre>
                </details>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">创建时间</div>
                  <div className="text-sm text-slate-700 mt-0.5">{fmtTime(service.created_at) || "-"}</div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide">更新时间</div>
                  <div className="text-sm text-slate-700 mt-0.5">{fmtTime(service.updated_at) || "-"}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-100"></div>

          {/* Section 2: Audit Records */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{copy.auditRecords}</h4>
              <span className="text-[10px] text-slate-400">共 {versions.length} 条</span>
            </div>
            {loading ? (
              <div className="text-xs text-slate-400">加载中…</div>
            ) : versions.length === 0 ? (
              <div className="text-xs text-slate-400">{copy.noVersions}</div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-medium text-slate-500">
                      <th className="px-3 py-2">申请时间</th>
                      <th className="px-3 py-2">版本</th>
                      <th className="px-3 py-2">提交智能体</th>
                      <th className="px-3 py-2">申请人</th>
                      <th className="px-3 py-2">状态</th>
                      <th className="px-3 py-2">审核时间</th>
                      <th className="px-3 py-2">审核人</th>
                      <th className="px-3 py-2">备注</th>
                      <th className="px-3 py-2 w-24">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {versions.map((v) => (
                      <tr key={v.version_id} className={v.status === "pending" ? "bg-amber-50/30 hover:bg-amber-50/60" : "hover:bg-slate-50/50"}>
                        <td className="px-3 py-1.5 text-slate-600">{fmtTime(v.submitted_at) || "-"}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-800 font-medium">{v.version || "-"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{v.submitted_by_agent_name || v.submitted_by_agent_id?.slice(0, 12) || "-"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{v.submitted_by_account_name || v.submitted_by_account || "-"}</td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium ${
                            v.status === "approved" ? "border-green-200 bg-green-50 text-green-700" :
                            v.status === "rejected" ? "border-red-200 bg-red-50 text-red-600" :
                            "border-amber-200 bg-amber-50 text-amber-700"
                          }`}>
                            {v.status === "pending" && <span className="w-1 h-1 rounded-full bg-amber-500"></span>}
                            {STATUS_LABELS[v.status] || v.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">{fmtTime(v.reviewed_at) || "-"}</td>
                        <td className="px-3 py-1.5 text-slate-500">{v.reviewed_by || "-"}</td>
                        <td className="px-3 py-1.5 text-slate-400 max-w-[120px] truncate">{v.review_comment || "-"}</td>
                        <td className="px-3 py-1.5">
                          {v.status === "pending" && (
                            <div className="flex gap-1">
                              <button onClick={() => handleApproveVersion(v.version_id)} className="text-[10px] text-green-600 hover:text-green-800 font-medium bg-green-50 rounded px-1.5 py-0.5 hover:bg-green-100">{copy.approve}</button>
                              <button onClick={handleRejectVersion} className="text-[10px] text-red-500 hover:text-red-700 font-medium bg-red-50 rounded px-1.5 py-0.5 hover:bg-red-100">{copy.reject}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-slate-100"></div>

          {/* Section 3: Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-violet-50 rounded-lg px-3 py-2.5">
              <div className="text-[10px] text-violet-400 uppercase tracking-wide">{copy.bound}</div>
              <div className="text-lg font-semibold text-violet-700 mt-0.5">{service.bound_agents ?? 0}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg px-3 py-2.5">
              <div className="text-[10px] text-emerald-400 uppercase tracking-wide">{copy.calls24h}</div>
              <div className="text-lg font-semibold text-emerald-700 mt-0.5">{service.calls_24h ?? 0}</div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 shrink-0 bg-white flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Drawer (bindings / calls) ─────────────────────────────────────

function DetailDrawer({
  locale, type, serviceId, name, onClose,
}: {
  locale: Locale;
  type: "bindings" | "calls";
  serviceId: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    void loadData(0);
  }, [serviceId, type]);

  const loadData = async (p: number) => {
    setLoading(true);
    try {
      if (type === "bindings") {
        const res = await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(serviceId)}`).then(r => r.json());
        setData({ policies: res.policies || [], role_policies: res.role_policies || [] });
      } else {
        const offset = p * pageSize;
        const res = await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(serviceId)}/calls?limit=${pageSize}&offset=${offset}`).then(r => r.json());
        setData(res);
      }
    } catch { setData(null); }
    finally { setLoading(false); setPage(p); }
  };

  const totalPages = type === "calls" ? Math.ceil((data?.total || 0) / pageSize) : 1;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {type === "bindings" ? `已绑定 — ${name}` : `调用记录 — ${name}`}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-xs text-slate-400">加载中…</div>
          ) : type === "bindings" ? (
            <div className="space-y-4">
              {(data?.policies?.length || data?.role_policies?.length) ? (
                <>
                  {data?.policies?.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-2">直接绑定</div>
                      <div className="overflow-hidden rounded-lg border border-slate-100">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-medium text-slate-500">
                              <th className="px-3 py-2">工作区 ID</th>
                              <th className="px-3 py-2">状态</th>
                              <th className="px-3 py-2">行权限规则</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {data.policies.map((p: any) => (
                              <tr key={p.agent_id} className="hover:bg-slate-50/50">
                                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-600">{p.agent_id}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${p.enabled ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{p.enabled ? "启用" : "禁用"}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {data?.role_policies?.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-2">角色绑定</div>
                      <div className="overflow-hidden rounded-lg border border-slate-100">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-medium text-slate-500">
                              <th className="px-3 py-2">角色名</th>
                              <th className="px-3 py-2">状态</th>
                              <th className="px-3 py-2">成员工作区</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {data.role_policies.map((p: any) => (
                              <tr key={p.role_id} className="hover:bg-slate-50/50">
                                <td className="px-3 py-1.5 font-medium text-slate-700">{p.role_name}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${p.enabled ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{p.enabled ? "启用" : "禁用"}</span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{(p.members || []).join(", ") || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-slate-400">暂无绑定记录</div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-xs text-slate-500 mb-3">
                共 {data?.total || 0} 条记录，第 {page * pageSize + 1}–{Math.min((page + 1) * pageSize, data?.total || 0)} 条
              </div>
              {data?.calls?.length ? (
                <div className="overflow-hidden rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-medium text-slate-500">
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">调用时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {data.calls.map((c: any, i: number) => (
                        <tr key={c.id} className="hover:bg-slate-50/50">
                          <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">{c.id}</td>
                          <td className="px-3 py-1.5 text-slate-600">{fmtTime(c.called_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-slate-400">暂无调用记录</div>
              )}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button disabled={page === 0} onClick={() => loadData(page - 1)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30">上一页</button>
                  <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => loadData(page + 1)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30">下一页</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Drawer (create/edit MCP service) ────────────────────────────────────

function McpDrawer({
  locale, service, source, readonly, onClose, onSaved,
}: {
  locale: Locale;
  service: McpService | null;
  source: McpSource;
  readonly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const copy = COPY[locale];
  const isEditing = service !== null;

  const [name, setName] = useState(service?.name || "");
  const [description, setDescription] = useState(service?.description || "");
  const [endpointUrl, setEndpointUrl] = useState(service?.endpoint_url || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!name.trim()) { setError(copy.nameRequired); return; }
    setSaving(true); setError("");
    try {
      if (isEditing) {
        const body: Record<string, string> = { name: name.trim(), description: description.trim() };
        if (source === "external" || service?.source === "external") body.endpoint_url = endpointUrl.trim();
        await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(service!.service_id)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        const body: Record<string, string> = {
          name: name.trim(), description: description.trim(), source,
        };
        if (source === "external") body.endpoint_url = endpointUrl.trim();
        await adminFetch("/api/v1/mcp-services", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">
            {readonly ? "查看 MCP 服务" : isEditing ? copy.editTitle : copy.createTitle}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isEditing && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <div className="flex gap-2"><span className="text-slate-400 w-16 shrink-0">服务 ID</span><code className="font-mono text-slate-800">{service!.service_id}</code></div>
              <div className="flex gap-2"><span className="text-slate-400 w-16 shrink-0">来源</span><span>{SOURCE_LABELS[service!.source || ""] || service?.source}</span></div>
              {service!.version && <div className="flex gap-2"><span className="text-slate-400 w-16 shrink-0">版本</span><code className="font-mono text-slate-800">{service!.version}</code></div>}
              {service!.mcp_path && <div className="flex gap-2"><span className="text-slate-400 w-16 shrink-0">路径</span><code className="font-mono text-slate-800 text-[11px]">{service!.mcp_path}</code></div>}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{copy.name}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              disabled={readonly}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-400 ${readonly ? "bg-slate-50 text-slate-500 border-slate-200" : "border-slate-200"}`}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{copy.description}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={copy.descPlaceholder}
              disabled={readonly}
              rows={3}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none ${readonly ? "bg-slate-50 text-slate-500 border-slate-200" : "border-slate-200"}`}
            />
          </div>

          {/* Endpoint (external only) */}
          {(source === "external" || service?.source === "external") && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{copy.endpoint}</label>
              <input
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                placeholder={copy.endpointPlaceholder}
                disabled={readonly}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-400 ${readonly ? "bg-slate-50 text-slate-500 border-slate-200" : "border-slate-200"}`}
              />
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        </div>

        {/* Footer */}
        {!readonly && (
          <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-slate-200 shrink-0">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button onClick={handleSave} disabled={saving || !canSave} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving ? copy.saving : copy.save}</button>
          </div>
        )}
      </div>
    </div>
  );
}
