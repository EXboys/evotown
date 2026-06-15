import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type McpRole = { role_id: string; name: string; description: string };
type WorkspaceSimple = { workspace_id: string; name: string; status?: string };

const COPY = {
  zh: {
    title: "智能体角色",
    subtitle: "角色用于给一批智能体统一赋权（MCP 访问等），按角色管理权限避免逐智能体配置。",
    refresh: "刷新",
    newRole: "新建角色",
    roleName: "角色名称",
    roleDesc: "描述",
    create: "创建",
    deleteRole: "删除角色",
    deleteConfirm: "确定删除该角色？关联的权限策略也将被清除。",
    members: "绑定智能体",
    memberHint: "点击智能体切换绑定",
    noRoles: "暂无角色，点击「新建角色」创建。",
    saving: "保存中…",
  },
  en: {
    title: "Agent Roles",
    subtitle: "Roles let you grant permissions (MCP access, etc.) to groups of workspaces at once.",
    refresh: "Refresh",
    newRole: "New Role",
    roleName: "Role name",
    roleDesc: "Description",
    create: "Create",
    deleteRole: "Delete",
    deleteConfirm: "Delete this role? Associated policies will also be removed.",
    members: "Bound workspaces",
    memberHint: "Click a workspace to toggle binding",
    noRoles: "No roles. Click 「New Role」 to create.",
    saving: "Saving…",
  },
};

export function RolePanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [roles, setRoles] = useState<McpRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // New role form
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Expanded role → member management
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSimple[]>([]);

  const load = async () => {
    setMessage("");
    try {
      const data = await adminFetch("/api/v1/mcp-roles").then(r => r.json());
      setRoles(data.roles ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  };

  const loadWorkspaces = async () => {
    try {
      const data = await adminFetch("/api/v1/workspaces?include_all=true&status_filter=").then(r => r.json());
      setWorkspaces((data.workspaces ?? []).filter((w: WorkspaceSimple) => w.status === "active"));
    } catch { /* ignore */ }
  };

  useEffect(() => { void load(); void loadWorkspaces(); }, []);

  const createRole = async () => {
    if (!newName.trim()) return;
    setSaving(true); setMessage("");
    try {
      await adminFetch("/api/v1/mcp-roles", { method: "POST", body: JSON.stringify({ name: newName, description: newDesc }) });
      setShowNew(false); setNewName(""); setNewDesc("");
      await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "创建失败"); }
    finally { setSaving(false); }
  };

  const deleteRole = async (roleId: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;
    try { await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(roleId)}`, { method: "DELETE" }); await load(); }
    catch (err) { setMessage(err instanceof Error ? err.message : "删除失败"); }
  };

  const toggleExpand = async (roleId: string) => {
    if (expandedRoleId === roleId) { setExpandedRoleId(null); return; }
    setExpandedRoleId(roleId);
    try {
      const data = await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(roleId)}/members`).then(r => r.json());
      setMembers(data.members ?? []);
    } catch { setMembers([]); }
  };

  const toggleMember = async (wsId: string) => {
    if (!expandedRoleId) return;
    const current = members.includes(wsId);
    const next = current ? members.filter(id => id !== wsId) : [...members, wsId];
    try {
      await adminFetch(`/api/v1/mcp-roles/${encodeURIComponent(expandedRoleId)}/members`, { method: "PUT", body: JSON.stringify({ workspace_ids: next }) });
      setMembers(next);
    } catch (err) { setMessage(err instanceof Error ? err.message : "更新失败"); }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">Roles</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2>
            <p className="mt-2 text-sm text-emerald-100">{copy.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/20 disabled:opacity-50">{loading ? "…" : copy.refresh}</button>
            <button type="button" onClick={() => setShowNew(true)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50">{copy.newRole}</button>
          </div>
        </div>
      </section>

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      {showNew && (
        <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-700">{copy.roleName}</label>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && void createRole()}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <div className="flex-[2]">
              <label className="text-sm font-medium text-slate-700">{copy.roleDesc}</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                onKeyDown={e => e.key === "Enter" && void createRole()}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            </div>
            <button onClick={() => void createRole()} disabled={saving || !newName.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? copy.saving : copy.create}</button>
            <button onClick={() => { setShowNew(false); setNewName(""); setNewDesc(""); }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
          </div>
        </div>
      )}

      {loading && !roles.length ? (
        <div className="space-y-3">{[0,1,2].map(i => (<div key={i} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="h-4 w-1/3 animate-pulse rounded bg-slate-200"/><div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100"/></div>))}</div>
      ) : roles.length ? (
        <div className="space-y-3">
          {roles.map(role => (
            <div key={role.role_id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center px-5 py-4">
                <button type="button" onClick={() => void toggleExpand(role.role_id)} className="text-left flex-1">
                  <span className="font-semibold text-slate-900">{role.name}</span>
                  {role.description && <span className="ml-3 text-sm text-slate-400">{role.description}</span>}
                  <span className="ml-2 text-xs text-slate-400">{expandedRoleId === role.role_id ? "▾" : "▸"}</span>
                </button>
                <button type="button" onClick={() => void deleteRole(role.role_id)} className="rounded-lg px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">{copy.deleteRole}</button>
              </div>
              {expandedRoleId === role.role_id && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="text-xs font-medium text-slate-500 mb-3">{copy.members} ({members.length})</div>
                  <div className="flex flex-wrap gap-2">
                    {workspaces.map(ws => {
                      const bound = members.includes(ws.workspace_id);
                      return (
                        <button key={ws.workspace_id} type="button"
                          onClick={() => toggleMember(ws.workspace_id)}
                          className={`rounded-full border px-3 py-1.5 text-xs transition ${bound ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
                          title={copy.memberHint}>
                          {ws.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">👥</div>
          <p className="mx-auto max-w-md text-sm text-slate-500">{copy.noRoles}</p>
        </div>
      )}
    </div>
  );
}
