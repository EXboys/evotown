import { useEffect, useState, type ReactNode } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import type { Locale } from "../lib/i18n";

// ── Types ──────────────────────────────────────────────────────────────────

type DbType = "postgres" | "mysql" | "sqlite" | "mssql";
type PrincipalType = "account" | "org" | "team";
type DbPermission = "read" | "write" | "admin";

type DatabaseConnection = {
  connection_id: string;
  name: string;
  db_type: DbType;
  tenant_id: string;
  team_id: string;
  access_mode: string;
  status: "active" | "paused";
  description: string;
  environment: "production" | "development" | "both";
  config: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password_hint?: string;
    password_set?: boolean;
  };
  created_at: string;
  updated_at: string;
};

type DatabaseGrant = {
  grant_id: string;
  connection_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  permission: DbPermission;
  created_at: string;
};

type DatabaseStats = {
  total_connections: number;
  active_connections: number;
  total_grants: number;
  by_db_type: Record<string, number>;
};

type TestResult = {
  ok?: boolean;
  database?: { ok?: boolean; message?: string; latency_ms?: number };
};

// ── Constants ──────────────────────────────────────────────────────────────

const DB_TYPE_LABEL: Record<DbType, Record<Locale, string>> = {
  postgres: { zh: "PostgreSQL", en: "PostgreSQL" },
  mysql: { zh: "MySQL", en: "MySQL" },
  sqlite: { zh: "SQLite", en: "SQLite" },
  mssql: { zh: "SQL Server", en: "SQL Server" },
};

const DB_DEFAULT_PORT: Record<DbType, string> = {
  postgres: "5432",
  mysql: "3306",
  sqlite: "",
  mssql: "1433",
};

const ENV_LABEL: Record<string, Record<Locale, string>> = {
  production: { zh: "生产", en: "Production" },
  development: { zh: "开发", en: "Dev" },
  both: { zh: "通用", en: "Both" },
};

const ENV_META: Record<string, string> = {
  production: "border-slate-200 bg-slate-100 text-slate-600",
  development: "border-sky-200 bg-sky-50 text-sky-700",
  both: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const STATUS_META: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
};

// ── Shared helpers ──────────────────────────────────────────────────────────

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-medium uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div><div className="mt-0.5 text-xs text-slate-400">{note}</div></div>;
}

// ── Main Component ─────────────────────────────────────────────────────────

export function DatabasePanel({ locale = "zh" }: { locale?: Locale }) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DatabaseConnection | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTarget, setTestTarget] = useState<DatabaseConnection | null>(null);

  // Grants (kept for existing functionality)
  const [grants, setGrants] = useState<DatabaseGrant[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [grantForm, setGrantForm] = useState({
    principal_type: "account" as PrincipalType,
    principal_id: "",
    permission: "read" as DbPermission,
  });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [connRes, grantRes] = await Promise.all([
        adminFetch("/api/v1/databases/manage?limit=200").then(r => r.json() as Promise<{ connections?: DatabaseConnection[] }>),
        adminFetch("/api/v1/databases/grants/manage?limit=500").then(r => r.json() as Promise<{ grants?: DatabaseGrant[] }>),
      ]);
      const list = Array.isArray(connRes.connections) ? connRes.connections : [];
      setConnections(list);
      setGrants(Array.isArray(grantRes.grants) ? grantRes.grants : []);
      if (!selectedId && list.length > 0) setSelectedId(list[0].connection_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const selected = connections.find(c => c.connection_id === selectedId);
  const selectedGrants = grants.filter(g => g.connection_id === selectedId);

  // ── Delete ──────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(deleteTarget.connection_id)}`, { method: "DELETE" });
    if (res.ok) {
      if (selectedId === deleteTarget.connection_id) setSelectedId("");
      setMessageOk(true); setMessage(`已删除: ${deleteTarget.name}`);
      load();
    } else {
      setMessageOk(false); setMessage(`删除失败: ${res.status}`);
    }
    setDeleteOpen(false); setDeleteTarget(null);
  };

  // ── Toggle status ───────────────────────────────────────────────────────

  const toggleStatus = async (conn: DatabaseConnection) => {
    const newStatus = conn.status === "active" ? "paused" : "active";
    const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(conn.connection_id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setMessageOk(true); setMessage(`${conn.name}: ${newStatus === "active" ? "已启用" : "已暂停"}`);
      load();
    }
  };

  // ── Grants ──────────────────────────────────────────────────────────────

  const deleteGrant = async (grantId: string) => {
    const res = await adminFetch(`/api/v1/databases/grants/${encodeURIComponent(grantId)}`, { method: "DELETE" });
    if (res.ok) load();
  };

  const createGrant = async () => {
    if (!selectedId) return;
    const res = await adminFetch("/api/v1/databases/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connection_id: selectedId,
        principal_type: grantForm.principal_type,
        principal_id: grantForm.principal_id.trim(),
        permission: grantForm.permission,
      }),
    });
    if (!res.ok) return setMessage(`授权失败: ${res.status}`);
    setMessageOk(true); setMessage("授权已添加");
    setGrantForm({ ...grantForm, principal_id: "" });
    load();
  };

  // ── Counts ──────────────────────────────────────────────────────────────

  const counts = { all: connections.length, active: 0, paused: 0, production: 0, development: 0, both: 0 };
  connections.forEach(c => {
    if (c.status === "active") counts.active++;
    if (c.status === "paused") counts.paused++;
    const env = c.environment || "production";
    if (env in counts) (counts as Record<string, number>)[env]++;
  });

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">管理企业数据库连接元数据与 ACL。连接信息通过 MCP 代理隔离，Evotown 不持有直连权限。</p>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{loading ? "刷新中…" : "刷新"}</button>
          <button type="button" onClick={() => { setEditingId(null); setFormOpen(true); setError(""); }} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">+ 新建连接</button>
        </div>
      </div>

      {/* Messages */}
      {message && <div className={`rounded-lg border px-4 py-3 text-sm ${messageOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{message}<button onClick={() => setMessage("")} className="ml-2 opacity-60 hover:opacity-100">✕</button></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button onClick={() => setError("")} className="ml-2 text-red-500 hover:text-red-700">✕</button></div>}

      {/* Stat cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="全部" value={counts.all} note="连接总数" />
        <StatCard label="活跃" value={counts.active} note="active" />
        <StatCard label="已暂停" value={counts.paused} note="paused" />
        <StatCard label="生产" value={counts.production} note="production" />
        <StatCard label="开发" value={counts.development} note="development" />
        <StatCard label="通用" value={counts.both} note="both" />
      </section>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">加载中…</div>
        ) : connections.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">暂无数据库连接。点击「新建连接」注册业务数据库。</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">名称</th>
                  <th className="px-3 py-2.5">类型</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">Host</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="hidden px-3 py-2.5 sm:table-cell">环境</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">更新时间</th>
                  <th className="w-44 px-3 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {connections.map(conn => {
                  const env = conn.environment || "production";
                  return (
                    <tr key={conn.connection_id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900">{conn.name}</div>
                        <div className="font-mono text-xs text-slate-400">{conn.connection_id}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{DB_TYPE_LABEL[conn.db_type][locale]}</td>
                      <td className="hidden px-3 py-2.5 text-xs font-mono text-slate-600 md:table-cell">{conn.config.host || "—"}:{conn.config.port || "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge className={STATUS_META[conn.status] || ""}>{conn.status === "active" ? "活跃" : "已暂停"}</Badge>
                      </td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <Badge className={ENV_META[env] || ""}>{ENV_LABEL[env]?.[locale] || env}</Badge>
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs text-slate-500 lg:table-cell">{conn.updated_at ? formatDateTimeShort(conn.updated_at) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => { setTestTarget(conn); setTestOpen(true); }} className="text-xs text-sky-600 hover:text-sky-800">测试</button>
                          <button type="button" onClick={() => { setEditingId(conn.connection_id); setFormOpen(true); }} className="text-xs text-slate-600 hover:text-slate-800">编辑</button>
                          <button type="button" onClick={() => toggleStatus(conn)} className="text-xs text-amber-600 hover:text-amber-800">{conn.status === "active" ? "暂停" : "启用"}</button>
                          <button type="button" onClick={() => { setDeleteTarget(conn); setDeleteOpen(true); }} className="text-xs text-red-600 hover:text-red-800">删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Grants section (existing functionality) */}
      {selected && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-slate-900">访问授权: {selected.name}</h3>
          </div>
          {selectedGrants.length === 0 ? (
            <p className="text-xs text-slate-500 mb-3">暂无授权 — 员工将无法通过 MCP 访问此库</p>
          ) : (
            <ul className="mb-3 divide-y divide-slate-100 border rounded-lg">
              {selectedGrants.map(grant => (
                <li key={grant.grant_id} className="flex items-center justify-between px-3 py-2.5 text-xs">
                  <span className="text-slate-600">
                    <span className="text-slate-500">{grant.principal_type === "account" ? "账号" : grant.principal_type === "org" ? "组织" : "团队"}</span>
                    {" "}<code className="rounded bg-slate-100 px-1 text-slate-700">{grant.principal_id}</code>
                    {" · "}{grant.permission === "read" ? "只读" : grant.permission === "write" ? "读写" : "管理"}
                  </span>
                  <button type="button" onClick={() => deleteGrant(grant.grant_id)} className="text-red-500 hover:text-red-700 text-xs">✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 items-end">
            <select className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs" value={grantForm.principal_type} onChange={e => setGrantForm({ ...grantForm, principal_type: e.target.value as PrincipalType, principal_id: "" })}>
              <option value="account">账号</option>
              <option value="org">组织</option>
              <option value="team">团队</option>
            </select>
            <input className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs min-w-[120px]" placeholder="主体 ID" value={grantForm.principal_id} onChange={e => setGrantForm({ ...grantForm, principal_id: e.target.value })} />
            <select className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs" value={grantForm.permission} onChange={e => setGrantForm({ ...grantForm, permission: e.target.value as DbPermission })}>
              <option value="read">只读</option>
              <option value="write">读写</option>
              <option value="admin">管理</option>
            </select>
            <button type="button" onClick={createGrant} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">添加授权</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {formOpen && (
        <ConnectionFormModal
          locale={locale}
          connectionId={editingId}
          connections={connections}
          onClose={() => { setFormOpen(false); setEditingId(null); }}
          onDone={(msg) => { setMessageOk(true); setMessage(msg); load(); }}
        />
      )}

      {deleteOpen && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setDeleteOpen(false); setDeleteTarget(null); }} />
          <div className="relative w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">确认删除</h3>
            <p className="text-sm text-slate-600">确定要删除数据库连接 <strong>{deleteTarget.name}</strong> ({deleteTarget.connection_id}) 吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setDeleteOpen(false); setDeleteTarget(null); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={confirmDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">删除</button>
            </div>
          </div>
        </div>
      )}

      {testOpen && testTarget && (
        <TestConnectionModal
          connection={testTarget}
          onClose={() => { setTestOpen(false); setTestTarget(null); }}
        />
      )}
    </div>
  );
}

// ── Connection Form Modal (Create / Edit) ───────────────────────────────────

function ConnectionFormModal({
  locale,
  connectionId,
  connections,
  onClose,
  onDone,
}: {
  locale: Locale;
  connectionId: string | null;
  connections: DatabaseConnection[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const existing = connectionId ? connections.find(c => c.connection_id === connectionId) : null;
  const isEdit = !!existing;

  const [form, setForm] = useState({
    name: existing?.name || "",
    db_type: (existing?.db_type || "postgres") as DbType,
    host: existing?.config?.host || "localhost",
    port: String(existing?.config?.port || DB_DEFAULT_PORT[existing?.db_type || "postgres"] || ""),
    database: existing?.config?.database || "",
    username: existing?.config?.username || "",
    password: "",
    description: existing?.description || "",
    environment: (existing?.environment || "production") as "production" | "development" | "both",
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const testConnection = async () => {
    setTesting(true); setTestResult(""); setTestOk(null);
    try {
      const res = await adminFetch("/api/v1/databases/test-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db_type: form.db_type,
          config: {
            host: form.host.trim(),
            port: Number(form.port) || undefined,
            database: form.database.trim(),
            username: form.username.trim(),
            password: form.password,
            ...(form.db_type === "sqlite" ? { path: form.database.trim() } : {}),
          },
        }),
      });
      const data = await res.json() as TestResult;
      if (data.ok) {
        setTestOk(true);
        const ms = data.database?.latency_ms;
        setTestResult(ms != null ? `连接成功 (${ms}ms)` : "连接成功");
      } else {
        setTestOk(false);
        setTestResult(data.database?.message || "连接失败");
      }
    } catch (err) {
      setTestOk(false);
      setTestResult(err instanceof Error ? err.message : "测试失败");
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      const config: Record<string, unknown> = {
        host: form.host.trim() || undefined,
        port: Number(form.port) || undefined,
        database: form.database.trim() || undefined,
        username: form.username.trim() || undefined,
        password: form.password || undefined,
      };
      // Clean undefined values
      Object.keys(config).forEach(k => { if (config[k] === undefined) delete config[k]; });
      // For edit, remove empty password so backend keeps old one
      if (isEdit && !form.password) {
        delete config.password;
      }

      if (isEdit) {
        const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(connectionId!)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim(),
            environment: form.environment,
            config,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onDone(`已更新: ${form.name.trim()}`);
      } else {
        const res = await adminFetch("/api/v1/databases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            db_type: form.db_type,
            description: form.description.trim(),
            environment: form.environment,
            config,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onDone(`已创建: ${form.name.trim()}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <h3 className="text-sm font-semibold text-slate-900">{isEdit ? `编辑: ${existing?.name}` : "新建数据库连接"}</h3>

        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">名称 *</label>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="连接名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>

          {/* Type + Environment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">类型</label>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.db_type} onChange={e => { const t = e.target.value as DbType; setForm({ ...form, db_type: t, port: DB_DEFAULT_PORT[t] }); }}>
                {(Object.keys(DB_TYPE_LABEL) as DbType[]).map(t => <option key={t} value={t}>{DB_TYPE_LABEL[t][locale]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">环境</label>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value as typeof form.environment })}>
                <option value="production">生产环境</option>
                <option value="development">开发环境</option>
                <option value="both">通用环境</option>
              </select>
            </div>
          </div>

          {/* Host + Port */}
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Host *</label>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="主机地址" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Port</label>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="端口" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} />
            </div>
          </div>

          {/* Database */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">数据库名 *</label>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="数据库名" value={form.database} onChange={e => setForm({ ...form, database: e.target.value })} />
          </div>

          {/* Username + Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">用户名</label>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="用户名" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{isEdit ? "密码（留空不修改）" : "密码"}</label>
              <input type="password" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={isEdit ? "留空保留原密码" : "密码"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">说明</label>
            <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" rows={2} placeholder="可选说明" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${testOk ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            {testResult}
          </div>
        )}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        {/* Actions */}
        <div className="flex justify-between items-center pt-2">
          <button type="button" disabled={testing} onClick={testConnection} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {testing ? "测试中…" : "测试连接"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} className="rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? "保存中…" : isEdit ? "更新" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Test Connection Modal ───────────────────────────────────────────────────

function TestConnectionModal({ connection, onClose }: { connection: DatabaseConnection; onClose: () => void; }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => { runTest(); }, []);

  const runTest = async () => {
    setTesting(true); setResult(""); setOk(null);
    try {
      const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(connection.connection_id)}/test`, { method: "POST" });
      const data = await res.json() as TestResult;
      if (data.ok) {
        setOk(true);
        const ms = data.database?.latency_ms;
        setResult(ms != null ? `连接成功 (${ms}ms)` : "连接成功");
      } else {
        setOk(false);
        setResult(data.database?.message || "连接失败");
      }
    } catch (err) {
      setOk(false);
      setResult(err instanceof Error ? err.message : "测试失败");
    } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">测试连接: {connection.name}</h3>
        <p className="text-xs text-slate-500">{connection.config.host}:{connection.config.port}/{connection.config.database}</p>
        {testing ? (
          <p className="text-sm text-slate-500">测试中…</p>
        ) : result ? (
          <div className={`rounded-lg border px-3 py-2 text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{result}</div>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={runTest} disabled={testing} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{testing ? "测试中…" : "重新测试"}</button>
          <button onClick={onClose} className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">关闭</button>
        </div>
      </div>
    </div>
  );
}
