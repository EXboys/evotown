import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type McpService = {
  service_id: string; name: string; description: string;
  service_type: string; endpoint_url: string; db_type: string;
  status: string; source: string; created_at: string; updated_at: string;
};

type McpPolicy = {
  policy_id: string; service_id: string; workspace_id: string;
  enabled: number; row_rules: Array<{ table: string; where: string }>;
};

type McpRole = { role_id: string; name: string; description: string };

type McpRolePolicy = {
  policy_id: string; service_id: string; role_id: string; role_name: string;
  enabled: number; row_rules: Array<{ table: string; where: string }>;
  members: string[];
};

type McpStats = {
  total_services: number; online_services: number; total_policies: number;
  by_service_type: Record<string, number>;
};

type WorkspaceSimple = { workspace_id: string; name: string; status: string };
type PolicyTab = "direct" | "role";

const COPY = {
  zh: {
    title: "MCP 服务管理",
    subtitle: "MCP 服务由后端发布注册，此处管理智能体访问权限和行级规则。角色在「智能体角色」页面管理。",
    refresh: "刷新", totalServices: "已注册", onlineServices: "在线", totalPolicies: "权限策略",
    directTab: "直接绑定", roleTab: "智能体角色",
    workspace: "智能体", enabled: "启用",
    rowRules: "行权限规则", addRule: "+ 添加规则",
    tableName: "表名", whereClause: "WHERE 条件", remove: "删除",
    save: "保存", saving: "保存中…", saved: "已保存",
    noServices: "暂无已注册的 MCP 服务。",
    serviceType: "类型", endpoint: "端点",
    online: "在线", offline: "离线", error: "异常",
  },
  en: {
    title: "MCP Services",
    subtitle: "MCP services are registered by backend. Manage workspace access and row-level rules here. Roles are managed in 「Agent Roles」.",
    refresh: "Refresh", totalServices: "Registered", onlineServices: "Online", totalPolicies: "Policies",
    directTab: "Direct", roleTab: "Agent Roles",
    workspace: "Workspace", enabled: "On",
    rowRules: "Row Rules", addRule: "+ Add Rule",
    tableName: "Table", whereClause: "WHERE clause", remove: "Remove",
    save: "Save", saving: "Saving…", saved: "Saved",
    noServices: "No registered MCP services.",
    serviceType: "Type", endpoint: "Endpoint",
    online: "Online", offline: "Offline", error: "Error",
  },
};

export function McpPanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [services, setServices] = useState<McpService[]>([]);
  const [stats, setStats] = useState<McpStats>({ total_services: 0, online_services: 0, total_policies: 0, by_service_type: {} });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [policyTab, setPolicyTab] = useState<PolicyTab>("direct");

  const [policies, setPolicies] = useState<McpPolicy[]>([]);
  const [directLocal, setDirectLocal] = useState<Record<string, { enabled: boolean; row_rules: Array<{ table: string; where: string }> }>>({});

  const [roles, setRoles] = useState<McpRole[]>([]);
  const [rolePolicies, setRolePolicies] = useState<McpRolePolicy[]>([]);
  const [roleLocal, setRoleLocal] = useState<Record<string, { enabled: boolean; row_rules: Array<{ table: string; where: string }> }>>({});

  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSimple[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setMessage("");
    try {
      const data = await adminFetch("/api/v1/mcp-services").then(r => r.json());
      setServices(data.services ?? []);
      setStats(data.stats ?? { total_services: 0, online_services: 0, total_policies: 0, by_service_type: {} });
    } catch (err) { setMessage(err instanceof Error ? err.message : "加载失败"); } finally { setLoading(false); }
  };

  const loadDetails = async (serviceId: string) => {
    setPoliciesLoading(true);
    try {
      const data = await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(serviceId)}`).then(r => r.json());
      setPolicies(data.policies ?? []);
      const dl: Record<string, { enabled: boolean; row_rules: Array<{ table: string; where: string }> }> = {};
      for (const p of (data.policies ?? [])) dl[p.workspace_id] = { enabled: p.enabled === 1, row_rules: p.row_rules?.map((r: { table: string; where: string }) => ({ table: r.table, where: r.where })) ?? [] };
      setDirectLocal(dl);
      setRoles(data.roles ?? []);
      setRolePolicies(data.role_policies ?? []);
      const rl: Record<string, { enabled: boolean; row_rules: Array<{ table: string; where: string }> }> = {};
      for (const rp of (data.role_policies ?? [])) rl[rp.role_id] = { enabled: rp.enabled === 1, row_rules: rp.row_rules?.map((r: { table: string; where: string }) => ({ table: r.table, where: r.where })) ?? [] };
      setRoleLocal(rl);
    } catch { setPolicies([]); setDirectLocal({}); setRoles([]); setRolePolicies([]); setRoleLocal({}); }
    finally { setPoliciesLoading(false); }
  };

  const loadWorkspaces = async () => {
    try {
      const data = await adminFetch("/api/v1/workspaces?include_all=true&status_filter=").then(r => r.json());
      setWorkspaces((data.workspaces ?? []).filter((w: WorkspaceSimple) => w.status === "active"));
    } catch { /* ignore */ }
  };

  useEffect(() => { void load(); void loadWorkspaces(); }, []);

  const toggleExpand = (serviceId: string) => {
    if (expandedId === serviceId) { setExpandedId(null); return; }
    setExpandedId(serviceId); setPolicyTab("direct"); void loadDetails(serviceId);
  };

  // Direct helpers
  const toggleWsEnabled = (wsId: string) => setDirectLocal(p => ({ ...p, [wsId]: p[wsId] ? { ...p[wsId], enabled: !p[wsId].enabled } : { enabled: true, row_rules: [] } }));
  const addDirectRule = (wsId: string) => setDirectLocal(p => ({ ...p, [wsId]: { ...(p[wsId] ?? { enabled: true, row_rules: [] }), row_rules: [...(p[wsId]?.row_rules ?? []), { table: "", where: "" }] } }));
  const updateDirectRule = (wsId: string, i: number, f: "table" | "where", v: string) => setDirectLocal(p => { const c = p[wsId]; if (!c) return p; const r = [...c.row_rules]; r[i] = { ...r[i], [f]: v }; return { ...p, [wsId]: { ...c, row_rules: r } }; });
  const removeDirectRule = (wsId: string, i: number) => setDirectLocal(p => { const c = p[wsId]; if (!c) return p; return { ...p, [wsId]: { ...c, row_rules: c.row_rules.filter((_, j) => j !== i) } }; });

  // Role helpers
  const toggleRoleEnabled = (roleId: string) => setRoleLocal(p => ({ ...p, [roleId]: p[roleId] ? { ...p[roleId], enabled: !p[roleId].enabled } : { enabled: true, row_rules: [] } }));
  const addRoleRule = (roleId: string) => setRoleLocal(p => ({ ...p, [roleId]: { ...(p[roleId] ?? { enabled: true, row_rules: [] }), row_rules: [...(p[roleId]?.row_rules ?? []), { table: "", where: "" }] } }));
  const updateRoleRule = (roleId: string, i: number, f: "table" | "where", v: string) => setRoleLocal(p => { const c = p[roleId]; if (!c) return p; const r = [...c.row_rules]; r[i] = { ...r[i], [f]: v }; return { ...p, [roleId]: { ...c, row_rules: r } }; });
  const removeRoleRule = (roleId: string, i: number) => setRoleLocal(p => { const c = p[roleId]; if (!c) return p; return { ...p, [roleId]: { ...c, row_rules: c.row_rules.filter((_, j) => j !== i) } }; });

  const savePolicies = async () => {
    if (!expandedId) return; setSaving(true); setMessage("");
    try {
      if (policyTab === "direct") {
        const items = Object.entries(directLocal).filter(([, v]) => v.enabled || v.row_rules.length > 0).map(([wsId, v]) => ({ workspace_id: wsId, enabled: v.enabled, row_rules: v.row_rules.filter(r => r.table.trim() || r.where.trim()) }));
        await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(expandedId)}/policies`, { method: "PUT", body: JSON.stringify({ policies: items }) });
      } else {
        const items = Object.entries(roleLocal).filter(([, v]) => v.enabled || v.row_rules.length > 0).map(([roleId, v]) => ({ role_id: roleId, enabled: v.enabled, row_rules: v.row_rules.filter(r => r.table.trim() || r.where.trim()) }));
        await adminFetch(`/api/v1/mcp-services/${encodeURIComponent(expandedId)}/role-policies`, { method: "PUT", body: JSON.stringify({ policies: items }) });
      }
      setMessage(copy.saved); await loadDetails(expandedId);
    } catch (err) { setMessage(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); }
  };

  const statusDot = (s: string) => ({ online: "bg-emerald-500", error: "bg-red-500" })[s] ?? "bg-slate-400";
  const statusLabel = (s: string) => ({ online: copy.online, offline: copy.offline, error: copy.error })[s] ?? s;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-600 to-purple-700 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl"><div className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">MCP</div><h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2><p className="mt-2 text-sm text-violet-100">{copy.subtitle}</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/20 disabled:opacity-50">{loading ? "…" : copy.refresh}</button>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[{ label: copy.totalServices, value: stats.total_services }, { label: copy.onlineServices, value: stats.online_services }, { label: copy.totalPolicies, value: stats.total_policies }].map(s => (
            <div key={s.label} className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur"><div className="text-2xl font-semibold tabular-nums">{s.value}</div><div className="mt-0.5 text-xs text-violet-100">{s.label}</div></div>
          ))}</div>
      </section>

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      {loading && !services.length ? (
        <div className="space-y-3">{[0,1].map(i => (<div key={i} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="h-4 w-1/3 animate-pulse rounded bg-slate-200"/><div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100"/></div>))}</div>
      ) : services.length ? (
        <div className="space-y-3">
          {services.map(svc => (
            <div key={svc.service_id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button type="button" onClick={() => toggleExpand(svc.service_id)} className="w-full px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(svc.status)}`} />
                  <div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">{svc.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full border border-slate-200 px-2 py-0.5">{svc.service_type}</span>
                      {svc.db_type && <span className="rounded-full border border-slate-200 px-2 py-0.5">{svc.db_type}</span>}
                      <span className="font-mono text-slate-400">{svc.endpoint_url}</span>
                    </div>
                    {svc.description && <p className="mt-1 text-xs text-slate-400">{svc.description}</p>}
                  </div>
                  <span className="text-slate-400 text-sm">{expandedId === svc.service_id ? "▾" : "▸"}</span>
                </div>
              </button>
              {expandedId === svc.service_id && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="flex gap-2 mb-3">
                    <button onClick={() => setPolicyTab("direct")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${policyTab === "direct" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}>{copy.directTab}</button>
                    <button onClick={() => setPolicyTab("role")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${policyTab === "role" ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`}>{copy.roleTab}</button>
                  </div>
                  {policiesLoading ? <div className="space-y-2">{[0,1].map(i=><div key={i} className="h-8 animate-pulse rounded bg-slate-100"/>)}</div> : (
                    policyTab === "direct" ? (
                      <div className="space-y-2">
                        {workspaces.map(ws => {
                          const l = directLocal[ws.workspace_id]; const en = l?.enabled ?? false; const r = l?.row_rules ?? [];
                          return (<div key={ws.workspace_id} className={`rounded-lg border ${en ? "border-violet-200 bg-violet-50/50" : "border-slate-200 bg-slate-50"} p-3`}>
                            <div className="flex items-center gap-3"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={en} onChange={() => toggleWsEnabled(ws.workspace_id)} className="h-4 w-4 rounded accent-violet-600"/><span className="text-sm font-medium text-slate-800">{ws.name}</span></label><span className="font-mono text-[11px] text-slate-400">{ws.workspace_id.slice(0,12)}</span></div>
                            {en && <div className="mt-3 pl-7"><div className="flex items-center justify-between mb-1.5"><span className="text-xs font-medium text-slate-500">{copy.rowRules}</span><button type="button" onClick={() => addDirectRule(ws.workspace_id)} className="text-xs text-violet-600 hover:text-violet-800">{copy.addRule}</button></div>
                              {r.length===0 ? <p className="text-xs text-slate-400">无规则</p> : <div className="space-y-1.5">{r.map((rule,idx)=>(<div key={idx} className="flex items-center gap-1.5"><input placeholder={copy.tableName} value={rule.table} onChange={e=>updateDirectRule(ws.workspace_id,idx,"table",e.target.value)} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-violet-400"/><span className="text-xs text-slate-400">WHERE</span><input placeholder={copy.whereClause} value={rule.where} onChange={e=>updateDirectRule(ws.workspace_id,idx,"where",e.target.value)} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs font-mono outline-none focus:border-violet-400"/><button type="button" onClick={()=>removeDirectRule(ws.workspace_id,idx)} className="text-xs text-red-400 hover:text-red-600">×</button></div>))}</div>}
                            </div>}
                          </div>);
                        })}
                      </div>
                    ) : roles.length === 0 ? (
                      <p className="text-xs text-slate-400">暂无角色。请先在「智能体角色」页面创建角色并绑定智能体。</p>
                    ) : (
                      <div className="space-y-2">
                        {roles.map(role => {
                          const l = roleLocal[role.role_id]; const en = l?.enabled ?? false; const r = l?.row_rules ?? [];
                          const rp = rolePolicies.find(rp => rp.role_id === role.role_id);
                          const memberNames = (rp?.members ?? []).map(id => workspaces.find(w => w.workspace_id === id)?.name ?? id.slice(0,8)).join(", ");
                          return (<div key={role.role_id} className={`rounded-lg border ${en ? "border-violet-200 bg-violet-50/50" : "border-slate-200 bg-slate-50"} p-3`}>
                            <div className="flex items-center gap-3"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={en} onChange={() => toggleRoleEnabled(role.role_id)} className="h-4 w-4 rounded accent-violet-600"/><span className="text-sm font-medium text-slate-800">{role.name}</span></label>{memberNames && <span className="text-[11px] text-slate-400 truncate max-w-[200px]">成员: {memberNames}</span>}</div>
                            {en && <div className="mt-3 pl-7"><div className="flex items-center justify-between mb-1.5"><span className="text-xs font-medium text-slate-500">{copy.rowRules}</span><button type="button" onClick={()=>addRoleRule(role.role_id)} className="text-xs text-violet-600 hover:text-violet-800">{copy.addRule}</button></div>
                              {r.length===0 ? <p className="text-xs text-slate-400">无规则</p> : <div className="space-y-1.5">{r.map((rule,idx)=>(<div key={idx} className="flex items-center gap-1.5"><input placeholder={copy.tableName} value={rule.table} onChange={e=>updateRoleRule(role.role_id,idx,"table",e.target.value)} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-violet-400"/><span className="text-xs text-slate-400">WHERE</span><input placeholder={copy.whereClause} value={rule.where} onChange={e=>updateRoleRule(role.role_id,idx,"where",e.target.value)} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs font-mono outline-none focus:border-violet-400"/><button type="button" onClick={()=>removeRoleRule(role.role_id,idx)} className="text-xs text-red-400 hover:text-red-600">×</button></div>))}</div>}
                            </div>}
                          </div>);
                        })}
                      </div>
                    )
                  )}
                  <div className="mt-4 flex justify-end"><button type="button" onClick={() => void savePolicies()} disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving ? copy.saving : copy.save}</button></div>
                </div>
              )}
            </div>
          ))}</div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-2xl">🔌</div><p className="mx-auto max-w-md text-sm text-slate-500">{copy.noServices}</p></div>
      )}
    </div>
  );
}
