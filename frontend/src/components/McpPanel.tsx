import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

// ── Types ──────────────────────────────────────────────────────────────────

type McpService = {
  service_id: string; name: string; description: string;
  service_type: string; endpoint_url: string; db_type: string;
  status: string; source: string; workspace_id: string;
  created_at: string; updated_at: string;
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
    noServices: "暂无 MCP 服务",
    name: "名称",
    serviceId: "服务 ID",
    description: "描述",
    status: "状态",
    operation: "操作",
    source: "来源",
    endpoint: "端点",
    online: "在线",
    offline: "离线",
    createTitle: "新增 MCP 服务",
    editTitle: "编辑 MCP 服务",
    namePlaceholder: "MCP 服务名称",
    descPlaceholder: "描述信息",
    endpointPlaceholder: "https://...",
    nameRequired: "名称不能为空",
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
    noServices: "No MCP services",
    name: "Name",
    serviceId: "Service ID",
    description: "Description",
    status: "Status",
    operation: "Actions",
    source: "Source",
    endpoint: "Endpoint",
    online: "Online",
    offline: "Offline",
    createTitle: "Create MCP Service",
    editTitle: "Edit MCP Service",
    namePlaceholder: "Service name",
    descPlaceholder: "Description",
    endpointPlaceholder: "https://...",
    nameRequired: "Name is required",
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

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSvc, setEditingSvc] = useState<McpService | null>(null);

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    if (!deletingId) return;
    try {
      await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(deletingId)}`, { method: "DELETE" });
      setDeletingId(null);
      void load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "删除失败"); setDeletingId(null); }
  };

  const canEdit = tab !== "system";

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-600 to-purple-700 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl"><div className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">MCP</div><h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2><p className="mt-2 text-sm text-violet-100">{copy.subtitle}</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/20 disabled:opacity-50">{loading ? "…" : copy.refresh}</button>
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
        {canEdit && (
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
                <th className="px-4 py-3">{copy.description}</th>
                <th className="px-4 py-3">{copy.source}</th>
                <th className="px-4 py-3">已绑定</th>
                <th className="px-4 py-3">24h调用</th>
                <th className="px-4 py-3">{copy.status}</th>
                <th className="px-4 py-3">{copy.operation}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((svc) => (
                <tr key={svc.service_id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{svc.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{svc.service_id}</td>
                  <td className="px-4 py-3 max-w-[160px] truncate">{svc.description || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      svc.source === "internal" ? "border-sky-200 bg-sky-50 text-sky-700" :
                      svc.source === "external" ? "border-amber-200 bg-amber-50 text-amber-700" :
                      "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}>{SOURCE_LABELS[svc.source] || svc.source}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{(svc as any).bound_workspaces ?? "-"}</td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{(svc as any).calls_24h ?? "-"}</td>
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <>
                          <button onClick={() => openEdit(svc)} className="text-xs text-violet-600 hover:text-violet-800">{copy.edit}</button>
                          <button onClick={() => setDeletingId(svc.service_id)} className="text-xs text-red-500 hover:text-red-700">{copy.delete}</button>
                        </>
                      ) : (
                        <button onClick={() => openEdit(svc)} className="text-xs text-slate-500 hover:text-slate-700">查看</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer */}
      {drawerOpen && (
        <McpDrawer
          locale={locale}
          service={editingSvc}
          source={tab}
          readonly={!canEdit}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => { setDrawerOpen(false); void load(); }}
        />
      )}

      {/* Delete confirm */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDeletingId(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900">{copy.delete}</h3>
            <p className="mt-2 text-sm text-slate-600">{copy.deleteConfirm}</p>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setDeletingId(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleDelete} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">{copy.delete}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────

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
        body.service_type = source === "external" ? "api" : "database";
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex gap-2"><span className="text-slate-400 w-16 shrink-0">服务 ID</span><code className="font-mono text-slate-800">{service!.service_id}</code></div>
              <div className="flex gap-2 mt-1"><span className="text-slate-400 w-16 shrink-0">来源</span><span>{SOURCE_LABELS[service!.source || ""] || service?.source}</span></div>
              {service!.workspace_id && <div className="flex gap-2 mt-1"><span className="text-slate-400 w-16 shrink-0">工作区</span><code className="font-mono text-slate-800 text-[11px]">{service!.workspace_id}</code></div>}
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
