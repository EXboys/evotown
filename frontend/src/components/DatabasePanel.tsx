import { useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";
import type { GatewayAccount } from "./GatewayAccountsPanel";

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

const DB_TYPE_LABEL: Record<DbType, Record<Locale, string>> = {
  postgres: { zh: "PostgreSQL", en: "PostgreSQL" },
  mysql: { zh: "MySQL", en: "MySQL" },
  sqlite: { zh: "SQLite", en: "SQLite" },
  mssql: { zh: "SQL Server", en: "SQL Server" },
};

const COPY = {
  zh: {
    title: "数据库接入",
    subtitle: "注册业务数据库连接，通过 MCP 代理隔离访问；Evotown 仅保存元数据与员工权限，不直连查询。",
    stats: { total: "连接数", active: "活跃", grants: "授权规则" },
    connections: "已注册数据库",
    empty: "暂无数据库连接",
    addTitle: "添加数据库",
    fields: {
      id: "连接 ID",
      name: "名称",
      type: "类型",
      team: "默认团队",
      host: "主机",
      port: "端口",
      database: "库名",
      user: "用户名",
      password: "密码",
      desc: "说明",
    },
    grants: "访问授权",
    grantEmpty: "暂无授权，员工将无法通过 MCP 访问此库",
    addGrant: "添加授权",
    principalType: "主体类型",
    principalId: "主体 ID",
    permission: "权限",
    principalTypes: { account: "员工账号", org: "组织", team: "团队" } as Record<PrincipalType, string>,
    permissions: { read: "只读", write: "读写", admin: "管理" } as Record<DbPermission, string>,
    create: "创建连接",
    testConnection: "测试连接",
    testing: "测试中…",
    testOk: "连接成功",
    testFailed: "连接失败",
    testDbOk: (ms: number) => `数据库连通 (${ms}ms)`,
    testDbFail: (msg: string) => `数据库: ${msg}`,
    testMcpOk: (ms: number) => `MCP Proxy 可达 (${ms}ms)`,
    testMcpFail: (msg: string) => `MCP Proxy: ${msg}`,
    testMcpSkip: "未配置 MCP 地址",
    saveGrant: "保存授权",
    created: "数据库连接已创建",
    grantCreated: "授权已添加",
    loadFailed: "加载失败",
    createFailed: "创建失败",
    grantFailed: "授权失败",
    mcpHint: "Skill 通过此 MCP 地址查询，不持有连接串",
    architecture: "架构：Evotown 管配置与 ACL → MCP Proxy 持连接并校验权限 → Skill 只调 MCP 工具",
  },
  en: {
    title: "Database Access",
    subtitle: "Register business databases and isolate access via MCP proxies. Evotown stores metadata and ACL only — no direct queries.",
    stats: { total: "Connections", active: "Active", grants: "Grants" },
    connections: "Registered Databases",
    empty: "No database connections yet",
    addTitle: "Add Database",
    fields: {
      id: "Connection ID",
      name: "Name",
      type: "Type",
      team: "Default team",
      host: "Host",
      port: "Port",
      database: "Database",
      user: "Username",
      password: "Password",
      mcp: "MCP server URL",
      desc: "Description",
    },
    grants: "Access grants",
    grantEmpty: "No grants — employees cannot reach this database via MCP",
    addGrant: "Add grant",
    principalType: "Principal type",
    principalId: "Principal ID",
    permission: "Permission",
    principalTypes: { account: "Account", org: "Organization", team: "Team" },
    permissions: { read: "Read", write: "Read/Write", admin: "Admin" },
    create: "Create connection",
    testConnection: "Test connection",
    testing: "Testing…",
    testOk: "Connection OK",
    testFailed: "Connection failed",
    testDbOk: (ms: number) => `Database reachable (${ms}ms)`,
    testDbFail: (msg: string) => `Database: ${msg}`,
    testMcpOk: (ms: number) => `MCP proxy reachable (${ms}ms)`,
    testMcpFail: (msg: string) => `MCP proxy: ${msg}`,
    testMcpSkip: "MCP URL not configured",
    saveGrant: "Save grant",
    created: "Database connection created",
    grantCreated: "Grant added",
    loadFailed: "Load failed",
    createFailed: "Create failed",
    grantFailed: "Grant failed",
    mcpHint: "Skills query through this MCP endpoint — never hold connection strings",
    architecture: "Flow: Evotown (config + ACL) → MCP proxy (connection + enforcement) → Skills (MCP tools only)",
  },
} as const;

const DB_DEFAULT_PORT: Record<DbType, string> = {
  postgres: "5432",
  mysql: "3306",
  sqlite: "",
  mssql: "1433",
};

export function DatabasePanel({ locale = "zh" }: { locale?: Locale }) {
  const copy = COPY[locale];
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [grants, setGrants] = useState<DatabaseGrant[]>([]);
  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);
  const [createForm, setCreateForm] = useState({
    name: "",
    db_type: "postgres" as DbType,
    team_id: "",
    host: "localhost",
    port: "5432",
    database: "",
    username: "",
    password: "",
    description: "",
    environment: "production" as "production" | "development" | "both",
  });
  const [grantForm, setGrantForm] = useState({
    principal_type: "account" as PrincipalType,
    principal_id: "",
    permission: "read" as DbPermission,
  });

  const load = () => {
    setLoading(true);
    Promise.all([
      adminFetch("/api/v1/databases/stats").then((r) => r.json() as Promise<DatabaseStats>),
      adminFetch("/api/v1/databases/manage?limit=100").then((r) => r.json() as Promise<{ connections?: DatabaseConnection[] }>),
      adminFetch("/api/v1/databases/grants/manage?limit=500").then((r) => r.json() as Promise<{ grants?: DatabaseGrant[] }>),
      adminFetch("/api/v1/accounts?limit=200").then((r) => r.json() as Promise<{ accounts?: GatewayAccount[] }>),
    ])
      .then(([statsData, connData, grantData, accountData]) => {
        setStats(statsData);
        const list = Array.isArray(connData.connections) ? connData.connections : [];
        setConnections(list);
        setGrants(Array.isArray(grantData.grants) ? grantData.grants : []);
        setAccounts(Array.isArray(accountData.accounts) ? accountData.accounts : []);
        if (!selectedId && list.length > 0) setSelectedId(list[0].connection_id);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : copy.loadFailed))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const selected = connections.find((c) => c.connection_id === selectedId);
  const selectedGrants = grants.filter((g) => g.connection_id === selectedId);

  const createConnection = async () => {
    const res = await adminFetch("/api/v1/databases", {
      method: "POST",
      body: JSON.stringify({
        name: createForm.name.trim(),
        db_type: createForm.db_type,
        team_id: createForm.team_id.trim(),
        description: createForm.description.trim(),
        environment: createForm.environment,
        config: {
          host: createForm.host.trim(),
          port: Number(createForm.port) || undefined,
          database: createForm.database.trim(),
          username: createForm.username.trim(),
          password: createForm.password,
        },
      }),
    });
    if (!res.ok) return setMessage(`${copy.createFailed}: ${res.status}`);
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    const conn = (data as { connection?: DatabaseConnection }).connection;
    setMessageOk(true);
    setMessage(conn ? `${copy.created}: ${conn.connection_id}` : copy.created);
    setCreateForm({ ...createForm, name: "", database: "", password: "" });
    load();
  };

  const createGrant = async () => {
    if (!selectedId) return;
    const res = await adminFetch("/api/v1/databases/grants", {
      method: "POST",
      body: JSON.stringify({
        connection_id: selectedId,
        principal_type: grantForm.principal_type,
        principal_id: grantForm.principal_id.trim(),
        permission: grantForm.permission,
      }),
    });
    if (!res.ok) return setMessage(`${copy.grantFailed}: ${res.status}`);
    setMessageOk(true);
    setMessage(copy.grantCreated);
    setGrantForm({ ...grantForm, principal_id: "" });
    load();
  };

  const deleteGrant = async (grantId: string) => {
    const res = await adminFetch(`/api/v1/databases/grants/${encodeURIComponent(grantId)}`, { method: "DELETE" });
    if (res.ok) load();
  };

  const deleteConnection = async (connectionId: string) => {
    if (!confirm(`确定删除数据库连接 ${connectionId}？`)) return;
    const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
    if (res.ok) {
      if (selectedId === connectionId) setSelectedId("");
      load();
    }
  };

  type TestResult = {
    ok?: boolean;
    database?: { ok?: boolean; message?: string; latency_ms?: number };
    mcp_proxy?: { ok?: boolean | null; message?: string; latency_ms?: number };
  };

  const formatTestMessage = (data: TestResult) => {
    const lines: string[] = [];
    const db = data.database;
    if (db?.ok) lines.push(copy.testDbOk(db.latency_ms ?? 0));
    else if (db) lines.push(copy.testDbFail(db.message || copy.testFailed));
    const mcp = data.mcp_proxy;
    if (mcp?.ok === true) lines.push(copy.testMcpOk(mcp.latency_ms ?? 0));
    else if (mcp?.ok === false) lines.push(copy.testMcpFail(mcp.message || copy.testFailed));
    else if (mcp) lines.push(copy.testMcpSkip);
    return lines.join(" · ");
  };

  const showTestResult = (data: TestResult) => {
    setMessageOk(Boolean(data.ok));
    setMessage(data.ok ? `${copy.testOk}: ${formatTestMessage(data)}` : `${copy.testFailed}: ${formatTestMessage(data)}`);
  };

  const testSavedConnection = async (connectionId: string) => {
    setTesting(true);
    try {
      const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(connectionId)}/test`, { method: "POST" });
      const data = (await res.json()) as TestResult;
      if (!res.ok) {
        setMessageOk(false);
        setMessage(`${copy.testFailed}: ${res.status}`);
        return;
      }
      showTestResult(data);
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : copy.testFailed);
    } finally {
      setTesting(false);
    }
  };

  const testDraftConnection = async () => {
    setTesting(true);
    try {
      const res = await adminFetch("/api/v1/databases/test-config", {
        method: "POST",
        body: JSON.stringify({
          db_type: createForm.db_type,
          config: {
            host: createForm.host.trim(),
            port: Number(createForm.port) || undefined,
            database: createForm.database.trim(),
            username: createForm.username.trim(),
            password: createForm.password,
            ...(createForm.db_type === "sqlite" ? { path: createForm.database.trim() } : {}),
          },
        }),
      });
      const data = (await res.json()) as TestResult;
      if (!res.ok) {
        setMessageOk(false);
        setMessage(`${copy.testFailed}: ${res.status}`);
        return;
      }
      showTestResult(data);
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : copy.testFailed);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${messageOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {message}
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{copy.architecture}</div>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: copy.stats.total, value: stats.total_connections },
            { label: copy.stats.active, value: stats.active_connections },
            { label: copy.stats.grants, value: stats.total_grants },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">{item.label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900">{copy.connections}</h3>
          {loading ? <p className="mt-4 text-sm text-slate-500">…</p> : connections.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{copy.empty}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {connections.map((conn) => (
                <li key={conn.connection_id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(conn.connection_id)}
                    className={`flex-1 rounded-xl border px-4 py-3 text-left transition ${
                      selectedId === conn.connection_id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="font-medium text-slate-900">{conn.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {conn.connection_id} · {DB_TYPE_LABEL[conn.db_type][locale]} · {conn.status}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConnection(conn.connection_id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    title="删除"
                  >×</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900">{copy.addTitle}</h3>
          <div className="mt-4 grid gap-3">
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.name} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={createForm.db_type} onChange={(e) => { const t = e.target.value as DbType; setCreateForm({ ...createForm, db_type: t, port: DB_DEFAULT_PORT[t] }); }}>
              {(Object.keys(DB_TYPE_LABEL) as DbType[]).map((t) => (
                <option key={t} value={t}>{DB_TYPE_LABEL[t][locale]}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.host} value={createForm.host} onChange={(e) => setCreateForm({ ...createForm, host: e.target.value })} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.port} value={createForm.port} onChange={(e) => setCreateForm({ ...createForm, port: e.target.value })} />
            </div>
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.database} value={createForm.database} onChange={(e) => setCreateForm({ ...createForm, database: e.target.value })} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.user} value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} />
            <input type="password" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.password} value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.fields.desc} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={createForm.environment} onChange={(e) => setCreateForm({ ...createForm, environment: e.target.value as "production" | "development" | "both" })}>
              <option value="production">生产环境</option>
              <option value="development">开发环境</option>
              <option value="both">通用环境</option>
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={testing} onClick={testDraftConnection} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {testing ? copy.testing : copy.testConnection}
              </button>
              <button type="button" onClick={createConnection} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">{copy.create}</button>
            </div>
          </div>
        </section>
      </div>

      {selected && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">{copy.grants}: {selected.name}</h3>
            <button
              type="button"
              disabled={testing}
              onClick={() => testSavedConnection(selected.connection_id)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {testing ? copy.testing : copy.testConnection}
            </button>
          </div>
          {selectedGrants.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{copy.grantEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {selectedGrants.map((grant) => (
                <li key={grant.grant_id} className="flex items-center justify-between py-3 text-sm">
                  <span>
                    {copy.principalTypes[grant.principal_type]} <code className="rounded bg-slate-100 px-1">{grant.principal_id}</code>
                    {" · "}{copy.permissions[grant.permission]}
                  </span>
                  <button type="button" onClick={() => deleteGrant(grant.grant_id)} className="text-xs text-red-600 hover:underline">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={grantForm.principal_type} onChange={(e) => setGrantForm({ ...grantForm, principal_type: e.target.value as PrincipalType, principal_id: "" })}>
              {(Object.keys(copy.principalTypes) as PrincipalType[]).map((t) => (
                <option key={t} value={t}>{copy.principalTypes[t]}</option>
              ))}
            </select>
            {grantForm.principal_type === "account" ? (
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2" value={grantForm.principal_id} onChange={(e) => setGrantForm({ ...grantForm, principal_id: e.target.value })}>
                <option value="">{copy.principalId}</option>
                {accounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>{a.name} ({a.account_id})</option>
                ))}
              </select>
            ) : (
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2" placeholder={copy.principalId} value={grantForm.principal_id} onChange={(e) => setGrantForm({ ...grantForm, principal_id: e.target.value })} />
            )}
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={grantForm.permission} onChange={(e) => setGrantForm({ ...grantForm, permission: e.target.value as DbPermission })}>
              {(Object.keys(copy.permissions) as DbPermission[]).map((p) => (
                <option key={p} value={p}>{copy.permissions[p]}</option>
              ))}
            </select>
            <button type="button" onClick={createGrant} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 md:col-span-4 md:w-fit">{copy.saveGrant}</button>
          </div>
        </section>
      )}
    </div>
  );
}
