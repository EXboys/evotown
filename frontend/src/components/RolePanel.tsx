import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type McpRole = { role_id: string; name: string; description: string };
type WorkspaceSimple = { workspace_id: string; name: string; status?: string };

type RoleDimension = {
  dim_id: string;
  label: string;
  code: string;
  db_connection_id: string;
  table_name: string;
  column_name: string;
  dim_values: string[];
  updated_at: string;
};

const COPY = {
  zh: {
    title: "智能体角色",
    subtitle: "角色用于给一批智能体统一赋权（MCP 访问），按角色管理避免逐智能体配置。",
    refresh: "刷新",
    newRole: "新建角色",
    editRole: "编辑角色",
    roleName: "角色名称",
    roleDesc: "描述",
    save: "保存",
    create: "创建",
    deleteRole: "删除角色",
    deleteConfirm: "确定删除该角色？关联的权限策略也将被清除。",
    members: "绑定智能体",
    memberHint: "点击智能体切换绑定",
    mcpServices: "MCP 服务",
    mcpServicesHint: "MCP 服务权限在「MCP 服务管理」中配置",
    dimensions: "数据维度",
    dimensionsHint: "配置该角色对各数据维度的可见范围（白名单制）",
    selectAll: "全选",
    noDimensions: "暂无已注册的数据维度",
    configDim: "配置",
    editDim: "编辑",
    unconfigured: "未配置",
    noRoles: "暂无角色，点击「新建角色」创建。",
    saving: "保存中…",
    loadingRoles: "加载中…",
    detail: "详情",
    edit: "编辑",
    searchPlaceholder: "搜索角色名称",
    filter: "筛选",
    totalRoles: "全部角色",
    totalRolesNote: "已创建的角色数",
  },
  en: {
    title: "Agent Roles",
    subtitle: "Roles let you grant permissions (MCP access) to groups of workspaces at once.",
    refresh: "Refresh",
    newRole: "New Role",
    editRole: "Edit Role",
    roleName: "Role name",
    roleDesc: "Description",
    save: "Save",
    create: "Create",
    deleteRole: "Delete",
    deleteConfirm: "Delete this role? Associated policies will also be removed.",
    members: "Bound Workspaces",
    memberHint: "Click a workspace to toggle binding",
    mcpServices: "MCP Services",
    mcpServicesHint: "MCP service permissions are configured in MCP Service Management",
    dimensions: "Data Dimensions",
    dimensionsHint: "Configure which data dimensions this role can access (allowlist)",
    selectAll: "All",
    noDimensions: "No registered dimensions",
    configDim: "Configure",
    editDim: "Edit",
    unconfigured: "Not set",
    noRoles: "No roles. Click 「New Role」 to create.",
    saving: "Saving…",
    loadingRoles: "Loading…",
    detail: "Detail",
    edit: "Edit",
    searchPlaceholder: "Search role name",
    filter: "Filter",
    totalRoles: "All Roles",
    totalRolesNote: "Total roles created",
  },
};

function StatCard({ label, value, note, className = "border-slate-200" }: { label: string; value: string | number; note: string; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${className}`}>
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{note}</div>
    </div>
  );
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

// ── Modal ──────────────────────────────────────────────────────────────────

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ── Detail Drawer ──────────────────────────────────────────────────────────

function DetailDrawer({
  role, locale, workspaces, members, mcpServices, dimensions,
  onClose, onToggleMember, onToggleMcp, onOpenEdit, onSetDimension,
}: {
  role: McpRole; locale: Locale;
  workspaces: WorkspaceSimple[];
  members: string[];
  mcpServices: Array<{ service_id: string; name: string; endpoint_url: string; enabled: boolean }>;
  dimensions: RoleDimension[];
  onClose: () => void;
  onToggleMember: (wsId: string) => void;
  onToggleMcp: (serviceId: string, enabled: boolean) => void;
  onOpenEdit: (role: McpRole) => void;
  onSetDimension: (dimId: string, values: string[]) => void;
}) {
  const [tab, setTab] = useState<"members" | "mcp" | "dimensions">("members");
  const copy = COPY[locale];

  const tabs = [
    { key: "members" as const, label: locale === "zh" ? "绑定智能体" : "Members", count: members.length },
    { key: "mcp" as const, label: locale === "zh" ? "MCP 服务" : "MCP Services", count: mcpServices.filter(s => s.enabled).length },
    { key: "dimensions" as const, label: copy.dimensions, count: dimensions.filter(d => d.dim_values.length > 0).length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border-l border-slate-200 shadow-xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{role.name}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => { onOpenEdit(role); onClose(); }} className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{copy.edit}</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-1 text-xs text-slate-600 border-b border-slate-100 shrink-0">
          <p className="text-slate-500">{role.description || (locale === "zh" ? "暂无描述" : "No description")}</p>
        </div>

        <div className="flex border-b border-slate-200 shrink-0">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs border-b-2 transition-colors ${tab === t.key ? "border-slate-950 text-slate-950 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "members" && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-400">{copy.memberHint}</p>
              <div className="flex flex-wrap gap-2">
                {workspaces.length === 0 ? (
                  <p className="text-xs text-slate-400">{locale === "zh" ? "暂无可用智能体" : "No workspaces available"}</p>
                ) : (
                  workspaces.map(ws => {
                    const bound = members.includes(ws.workspace_id);
                    return (
                      <button key={ws.workspace_id} type="button"
                        onClick={() => onToggleMember(ws.workspace_id)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${bound ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                        {ws.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {tab === "mcp" && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-400">{locale === "zh" ? "点击切换该角色对 MCP 服务的访问权限" : "Click to toggle MCP service access for this role"}</p>
              {mcpServices.length === 0 ? (
                <p className="text-xs text-slate-400">{locale === "zh" ? "暂无可用 MCP 服务" : "No MCP services available"}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {mcpServices.map(svc => (
                    <button key={svc.service_id} type="button"
                      onClick={() => onToggleMcp(svc.service_id, !svc.enabled)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                        svc.enabled ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300 hover:text-slate-600"
                      }`}
                      title={svc.endpoint_url || svc.service_id}>
                      {svc.name || svc.service_id}
                      {svc.enabled ? " ✓" : " ✗"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "dimensions" && <DimensionTab dimensions={dimensions} locale={locale} roleId={role.role_id} onSetDimension={onSetDimension} />}
        </div>
      </div>
    </div>
  );
}


// ── Dimension Tab ───────────────────────────────────────────────────────

function DimensionTab({
dimensions, locale, roleId, onSetDimension,
}: {
dimensions: RoleDimension[];
locale: Locale;
roleId: string;
onSetDimension: (dimId: string, values: string[]) => void;
}) {
const copy = COPY[locale];
const [editingDimId, setEditingDimId] = useState<string | null>(null);
const [dimValues, setDimValues] = useState<Record<string, string[]>>({});
const [loadingValues, setLoadingValues] = useState(false);
const [selectedValues, setSelectedValues] = useState<string[]>([]);
const [searchQuery, setSearchQuery] = useState("");
const [saving, setSaving] = useState(false);

const openEditor = async (dim: RoleDimension) => {
setEditingDimId(dim.dim_id);
setSearchQuery("");
setSelectedValues([...dim.dim_values]);
if (!dimValues[dim.dim_id]) {
setLoadingValues(true);
try {
  const data = await adminFetch(
    `/api/v1/dimensions/${encodeURIComponent(dim.dim_id)}/values`
  ).then(r => r.json());
  const vals: string[] = data.values ?? [];
  setDimValues(prev => ({ ...prev, [dim.dim_id]: vals }));
} catch { setDimValues(prev => ({ ...prev, [dim.dim_id]: [] })); }
finally { setLoadingValues(false); }
}
};

const toggleValue = (val: string) => {
setSelectedValues(prev =>
prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
);
};

const selectAll = (allValues: string[]) => {
setSelectedValues(allValues);
};

const deselectAll = () => {
setSelectedValues([]);
};

const handleSave = async () => {
setSaving(true);
try {
await onSetDimension(editingDimId!, selectedValues);
setEditingDimId(null);
} catch { /* handled by parent */ }
finally { setSaving(false); }
};

const allValues = editingDimId ? (dimValues[editingDimId] ?? []) : [];
const filteredValues = allValues.filter(v =>
!searchQuery || v.toLowerCase().includes(searchQuery.toLowerCase())
);
const allSelected = allValues.length > 0 && selectedValues.length === allValues.length;

return (
<div className="space-y-3">
<p className="text-[11px] text-slate-400">{copy.dimensionsHint}</p>
{dimensions.length === 0 ? (
  <p className="text-xs text-slate-400">{copy.noDimensions}</p>
) : (
  <div className="space-y-2">
    {dimensions.map(dim => {
      const isEditing = editingDimId === dim.dim_id;
      const hasValues = dim.dim_values.length > 0;
      const isAll = dim.dim_values[0] === "*";
      return (
        <div key={dim.dim_id} className="rounded-lg border border-slate-200 p-3 text-xs">
          <div className="flex items-center justify-between mb-1">
            <div>
              <span className="font-medium text-slate-800">
                {dim.label || dim.code || dim.dim_id}
              </span>
              {dim.code && <span className="ml-1.5 text-slate-400">({dim.code})</span>}
            </div>
            {!isEditing && (
              <button
                onClick={() => openEditor(dim)}
                className="text-slate-500 hover:text-slate-800 underline"
              >
                {hasValues ? copy.editDim : copy.configDim}
              </button>
            )}
          </div>
          <div className="text-slate-500">
            {isAll ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                {copy.selectAll}
              </span>
            ) : hasValues ? (
              <div className="flex flex-wrap gap-1 mt-1">
                {dim.dim_values.map(v => (
                  <span key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                    {v}
                  </span>
                ))}
              </div>
            ) : (
              <span className="italic text-slate-400">{copy.unconfigured}</span>
            )}
          </div>

          {isEditing && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                  placeholder={locale === "zh" ? "搜索维度值…" : "Search values…"}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <button
                  onClick={() => allSelected ? deselectAll() : selectAll(allValues)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                >
                  {allSelected ? (locale === "zh" ? "取消全选" : "Deselect all") : copy.selectAll}
                </button>
              </div>

              {loadingValues ? (
                <p className="text-xs text-slate-400 py-2">{locale === "zh" ? "加载维度值中…" : "Loading values…"}</p>
              ) : filteredValues.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">
                  {searchQuery ? (locale === "zh" ? "无匹配值" : "No matching values") : (locale === "zh" ? "该维度暂无可选值" : "No values available")}
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {filteredValues.map(val => (
                    <label key={val} className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded">
                      <input
                        type="checkbox"
                        checked={selectedValues.includes(val)}
                        onChange={() => toggleValue(val)}
                        className="w-3.5 h-3.5 accent-slate-700"
                      />
                      <span className="text-slate-700 truncate">{val}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEditingDimId(null)} className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? (locale === "zh" ? "保存中…" : "Saving…") : copy.save}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    })}
  </div>
)}
</div>
);
}


// ── Main Component ─────────────────────────────────────────────────────────

export function RolePanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [roles, setRoles] = useState<McpRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<McpRole | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const [detailRole, setDetailRole] = useState<McpRole | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSimple[]>([]);
  const [mcpServices, setMcpServices] = useState<Array<{ service_id: string; name: string; endpoint_url: string; enabled: boolean }>>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [dimensions, setDimensions] = useState<RoleDimension[]>([]);

  const load = async () => {
    setMessage(""); setError("");
    try {
      const data = await adminFetch("/api/v1/mcp-roles").then(r => r.json());
      setRoles(data.roles ?? []);
      // Load member counts for all roles in parallel
      const allRoles: McpRole[] = data.roles ?? [];
      try {
        const counts: Record<string, number> = {};
        await Promise.all(allRoles.map(async (r) => {
          try {
            const m = await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(r.role_id)}/members`).then(r => r.json());
            counts[r.role_id] = (m.members || []).length;
          } catch { counts[r.role_id] = 0; }
        }));
        setMemberCounts(counts);
      } catch { /* keep empty counts */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  };

  const loadWorkspaces = async () => {
    try {
      const data = await adminFetch("/api/v1/workspaces?include_all=true&status_filter=").then(r => r.json());
      setWorkspaces((data.workspaces ?? []).filter((w: WorkspaceSimple) => w.status === "active"));
    } catch { /* ignore */ }
  };

  useEffect(() => { void load(); void loadWorkspaces(); }, []);

  const openNewModal = () => {
    setEditingRole(null);
    setFormName("");
    setFormDesc("");
    setModalOpen(true);
  };

  const openEditModal = (role: McpRole) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormDesc(role.description || "");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true); setMessage(""); setError("");
    try {
      if (editingRole) {
        await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(editingRole.role_id)}`, {
          method: "PUT",
          body: JSON.stringify({ name: formName, description: formDesc }),
        });
      } else {
        await adminFetch("/api/v1/mcp-roles", {
          method: "POST",
          body: JSON.stringify({ name: formName, description: formDesc }),
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : (editingRole ? "更新失败" : "创建失败")); }
    finally { setSaving(false); }
  };

  const deleteRole = async (roleId: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;
    try { await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(roleId)}`, { method: "DELETE" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
  };

  const openDetail = async (role: McpRole) => {
    setDetailRole(role);
    setMembers([]);
    setMcpServices([]);
    setDimensions([]);
    try {
      const [mdata, sdata, ddata] = await Promise.all([
        adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(role.role_id)}/members`).then(r => r.json()),
        adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(role.role_id)}/services`).then(r => r.json()),
        adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(role.role_id)}/dimensions`).then(r => r.json()),
      ]);
      setMembers(mdata.members ?? []);
      setMcpServices(sdata.services ?? []);
      setDimensions(ddata.dimensions ?? []);
    } catch { setMembers([]); setMcpServices([]); setDimensions([]); }
  };

  const toggleMember = async (wsId: string) => {
    if (!detailRole) return;
    const current = members.includes(wsId);
    const next = current ? members.filter(id => id !== wsId) : [...members, wsId];
    try {
      await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(detailRole.role_id)}/members`, { method: "PUT", body: JSON.stringify({ workspace_ids: next }) });
      setMembers(next);
      setMemberCounts(prev => ({ ...prev, [detailRole.role_id]: next.length }));
    } catch (err) { setMessage(err instanceof Error ? err.message : "更新失败"); }
  };

  const toggleMcpService = async (serviceId: string, enabled: boolean) => {
    if (!detailRole) return;
    try {
      if (enabled) {
        await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(serviceId)}/role-policies/${encodeURIComponent(detailRole.role_id)}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: true }),
        });
      } else {
        await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(serviceId)}/role-policies/${encodeURIComponent(detailRole.role_id)}`, {
          method: "DELETE",
        });
      }
      setMcpServices(prev => prev.map(s => s.service_id === serviceId ? { ...s, enabled } : s));
    } catch (err) { setMessage(err instanceof Error ? err.message : "操作失败"); }
  };

  const setDimension = async (dimId: string, values: string[]) => {
    if (!detailRole) return;
    try {
      await adminFetch(
        `/api/v1/mcp-roles/${encodeURIComponent(detailRole.role_id)}/dimensions/${encodeURIComponent(dimId)}`,
        { method: "PUT", body: JSON.stringify({ dim_values: values }) }
      );
      setDimensions(prev => prev.map(d =>
        d.dim_id === dimId ? { ...d, dim_values: values } : d
      ));
    } catch (err) { setMessage(err instanceof Error ? err.message : "维度配置失败"); }
  };

  const filtered = roles.filter(r => {
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{copy.subtitle}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {loading ? "…" : copy.refresh}
          </button>
          <button type="button" onClick={openNewModal}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">
            + {copy.newRole}
          </button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <StatCard label={copy.totalRoles} value={roles.length} note={copy.totalRolesNote} />
      </section>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}<button onClick={() => setMessage("")} className="ml-2 text-emerald-500 hover:text-emerald-700">✕</button></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button onClick={() => setError("")} className="ml-2 text-red-500 hover:text-red-700">✕</button></div>}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={(e: FormEvent) => e.preventDefault()} className="mb-4">
          <div className="flex gap-2">
            <input
              className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={copy.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </form>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">{copy.loadingRoles}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-2xl">👥</div>
            <p className="text-sm text-slate-500">{query ? (locale === "zh" ? "无匹配角色" : "No matching roles") : copy.noRoles}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">{locale === "zh" ? "角色" : "Role"}</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">{locale === "zh" ? "描述" : "Description"}</th>
                  <th className="px-3 py-2.5">{locale === "zh" ? "绑定智能体" : "Workspaces"}</th>
                  <th className="w-28 px-3 py-2.5 text-right">{locale === "zh" ? "操作" : "Actions"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((role) => (
                  <tr key={role.role_id} className="cursor-pointer hover:bg-slate-50/50" onClick={() => void openDetail(role)}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">{role.name}</div>
                      <div className="font-mono text-xs text-slate-400">{role.role_id}</div>
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-slate-500 md:table-cell max-w-[200px] truncate">
                      {role.description || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {(memberCounts[role.role_id] ?? 0) > 0 ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{memberCounts[role.role_id]} 个</Badge>
                      ) : (
                        <Badge className="border-slate-200 bg-slate-50 text-slate-400">0</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => void openDetail(role)} className="text-xs text-slate-500 hover:text-slate-800">{copy.detail}</button>
                        <button type="button" onClick={() => openEditModal(role)} className="text-xs text-slate-500 hover:text-slate-800">{copy.edit}</button>
                        <button type="button" onClick={() => void deleteRole(role.role_id)} className="text-xs text-red-500 hover:text-red-700">{copy.deleteRole}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailRole && (
        <DetailDrawer
          role={detailRole}
          locale={locale}
          workspaces={workspaces}
          members={members}
          mcpServices={mcpServices}
          dimensions={dimensions}
          onClose={() => setDetailRole(null)}
          onToggleMember={toggleMember}
          onToggleMcp={toggleMcpService}
          onOpenEdit={openEditModal}
          onSetDimension={setDimension}
        />
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h3 className="text-base font-semibold text-slate-900 mb-4">{editingRole ? copy.editRole : copy.newRole}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{copy.roleName}</label>
            <input
              autoFocus
              value={formName}
              onChange={e => setFormName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void handleSave()}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{copy.roleDesc}</label>
            <input
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void handleSave()}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{locale === "zh" ? "取消" : "Cancel"}</button>
            <button onClick={() => void handleSave()} disabled={saving || !formName.trim()}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? copy.saving : (editingRole ? copy.save : copy.create)}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
