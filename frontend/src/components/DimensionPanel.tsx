import { useEffect, useState, useRef } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type Dimension = {
  dim_id: string; label: string; code: string; db_connection_id: string; db_name: string;
  table_name: string; column_name: string; created_at: string; updated_at?: string;
};

type DbConnection = { connection_id: string; name: string; db_type: string; status: string };

const COPY = {
  zh: {
    title: "权限维度管理",
    subtitle: "注册权限维度，维度值从关联数据库表字段读取",
    dimId: "维度 ID",
    code: "维度编码",
    label: "显示名",
    dbConn: "关联数据库",
    dbName: "数据库名",
    table: "数据表",
    column: "字段",
    add: "新增维度",
    edit: "编辑",
    delete: "删除",
    save: "保存",
    cancel: "取消",
    noData: "暂无维度。点击「新增维度」注册第一个权限维度。",
    selectDb: "选择数据库...",
    selectDbName: "选择数据库名...",
    selectTable: "选择数据表...",
    selectColumn: "选择字段...",
    searchTable: "搜索表名...",
    searchColumn: "搜索字段...",
    loading: "加载中...",
    loadErr: "加载失败",
    noMatch: "无匹配",
  },
  en: {
    title: "Permission Dimensions",
    subtitle: "Register dimensions. Values are loaded from the linked database table column.",
    dimId: "Dimension ID",
    code: "Code",
    label: "Label",
    dbConn: "Database",
    dbName: "Database Name",
    table: "Table",
    column: "Column",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    noData: "No dimensions. Click 'Add' to register your first dimension.",
    selectDb: "Select database...",
    selectDbName: "Select database name...",
    selectTable: "Select table...",
    selectColumn: "Select column...",
    searchTable: "Search table name...",
    searchColumn: "Search column name...",
    loading: "Loading...",
    loadErr: "Load failed",
    noMatch: "No match",
  },
};

/* ── Searchable dropdown ─────────────────────────────────────────── */
function SearchableSelect({
  options, value, onChange, placeholder, disabled,
}: {
  options: string[]; value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (opt: string) => {
    onChange(opt);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <input
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        placeholder={disabled ? "加载中..." : value || placeholder}
        value={open ? query : (value || "")}
        disabled={disabled}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">无匹配</div>
          ) : (
            filtered.map(opt => (
              <div key={opt}
                className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-100 ${opt === value ? "bg-slate-50 font-medium" : ""}`}
                onMouseDown={e => { e.preventDefault(); select(opt); }}>
                {opt}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
export function DimensionPanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [dims, setDims] = useState<Dimension[]>([]);
  const [dbs, setDbs] = useState<DbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // ── Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDimId, setEditDimId] = useState("");

  // ── Cascading form state
  const [form, setForm] = useState({ label: "", code: "", db_connection_id: "", db_name: "", table_name: "", column_name: "" });
  const [dbNames, setDbNames] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [namesLoading, setNamesLoading] = useState(false);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Refs for latest form values (avoids stale closure issues)
  const formRef = useRef(form);
  formRef.current = form;

  const load = async () => {
    setLoading(true);
    try {
      const [dr, dbr] = await Promise.all([
        adminFetch("/api/v1/dimensions").then(r => r.json()),
        adminFetch("/api/v1/databases/manage?limit=100").then(r => r.json()),
      ]);
      setDims(dr.dimensions ?? []);
      setDbs((dbr.connections ?? []).filter((c: DbConnection) => c.status === "active"));
    } catch { /* */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const dbType = (cid: string) => dbs.find(d => d.connection_id === cid)?.db_type || "";

  // ── Step 1: select connection → load DB names
  const onSelectConnection = async (cid: string) => {
    setForm({ label: formRef.current.label, code: formRef.current.code, db_connection_id: cid, db_name: "", table_name: "", column_name: "" });
    setDbNames([]); setTables([]); setColumns([]);
    if (!cid) return;
    const dt = dbType(cid);
    if (dt === "sqlite") {
      setNamesLoading(false);
      loadTables(cid, "");
    } else {
      setNamesLoading(true);
      try {
        const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(cid)}/names`);
        const data = await res.json();
        setDbNames(data.names ?? []);
      } catch { setDbNames([]); }
      finally { setNamesLoading(false); }
    }
  };

  // ── Step 2: select DB name → load tables
  const onSelectDbName = async (dbn: string) => {
    setForm({ ...formRef.current, db_name: dbn, table_name: "", column_name: "" });
    setTables([]); setColumns([]);
    const cid = formRef.current.db_connection_id || form.db_connection_id;
    if (!cid) return;
    loadTables(cid, dbn);
  };

  const loadTables = async (cid: string, dbName: string) => {
    setTablesLoading(true);
    try {
      const params = new URLSearchParams();
      if (dbName) params.set("database", dbName);
      const qs = params.toString();
      const res = await adminFetch(`/api/v1/databases/${encodeURIComponent(cid)}/tables${qs ? "?" + qs : ""}`);
      const data = await res.json();
      setTables(data.tables ?? []);
    } catch { setTables([]); }
    finally { setTablesLoading(false); }
  };

  // ── Step 3: select table → load columns
  const onSelectTable = async (tbl: string) => {
    setForm({ ...formRef.current, table_name: tbl, column_name: "" });
    setColumns([]);
    const cid = formRef.current.db_connection_id;
    const dbn = formRef.current.db_name;
    if (!cid || !tbl) return;
    setColumnsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dbn) params.set("database", dbn);
      const qs = params.toString();
      const res = await adminFetch(
        `/api/v1/databases/${encodeURIComponent(cid)}/tables/${encodeURIComponent(tbl)}/columns${qs ? "?" + qs : ""}`);
      const data = await res.json();
      setColumns(data.columns ?? []);
    } catch { setColumns([]); }
    finally { setColumnsLoading(false); }
  };

  // ── Step 4: select column
  const onSelectColumn = (col: string) => {
    setForm({ ...formRef.current, column_name: col });
  };

  // ── Open create modal
  const openCreate = () => {
    setEditing(false); setEditDimId("");
    setForm({ label: "", code: "", db_connection_id: "", db_name: "", table_name: "", column_name: "" });
    setDbNames([]); setTables([]); setColumns([]);
    setError("");
    setModalOpen(true);
  };

  // ── Open edit modal
  const openEdit = (d: Dimension) => {
    setEditing(true); setEditDimId(d.dim_id);
    const existingDbName = d.db_name || "";
    setForm({ label: d.label, code: d.code || "", db_connection_id: d.db_connection_id, db_name: existingDbName, table_name: d.table_name, column_name: d.column_name });
    setDbNames([]); setTables([]); setColumns([]);
    setError("");
    setModalOpen(true);
    const dt = dbType(d.db_connection_id);
    if (dt === "sqlite") {
      loadTables(d.db_connection_id, "");
    } else {
      setNamesLoading(true);
      adminFetch(`/api/v1/databases/${encodeURIComponent(d.db_connection_id)}/names`)
        .then(r => r.json()).then(data => setDbNames(data.names ?? [])).catch(() => {})
        .finally(() => setNamesLoading(false));
      loadTables(d.db_connection_id, existingDbName);
    }
    setColumnsLoading(true);
    const colParams = new URLSearchParams();
    if (existingDbName) colParams.set("database", existingDbName);
    const colQs = colParams.toString();
    adminFetch(`/api/v1/databases/${encodeURIComponent(d.db_connection_id)}/tables/${encodeURIComponent(d.table_name)}/columns${colQs ? "?" + colQs : ""}`)
      .then(r => r.json()).then(data => setColumns(data.columns ?? [])).catch(() => {})
      .finally(() => setColumnsLoading(false));
  };

  // ── Save
  const save = async () => {
    const f = formRef.current;
    if (!f.label.trim() || !f.db_connection_id || !f.table_name || !f.column_name) return;
    setSaving(true); setError("");
    try {
      if (editing) {
        const body: Record<string, string> = {};
        if (f.label.trim() !== "") body.label = f.label.trim();
        if (f.code) body.code = f.code;
        if (f.db_name) body.db_name = f.db_name;
        if (f.table_name) body.table_name = f.table_name;
        if (f.column_name) body.column_name = f.column_name;
        const res = await adminFetch(`/api/v1/dimensions/${encodeURIComponent(editDimId)}`, {
          method: "PUT", body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "update failed"); }
        setMessage("维度已更新");
      } else {
        const res = await adminFetch("/api/v1/dimensions", {
          method: "POST",
          body: JSON.stringify({
            label: f.label.trim(),
            code: f.code,
            db_connection_id: f.db_connection_id,
            db_name: f.db_name,
            table_name: f.table_name,
            column_name: f.column_name,
          }),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "create failed"); }
        setMessage("维度已创建");
      }
      setModalOpen(false);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "failed"); }
    finally { setSaving(false); }
  };

  // ── Delete
  const del = async (dimId: string) => {
    if (!confirm(copy.delete + " " + dimId + "?")) return;
    try {
      const res = await adminFetch(`/api/v1/dimensions/${encodeURIComponent(dimId)}`, { method: "DELETE" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "delete failed"); }
      setMessage("维度已删除");
      load();
    } catch (e) { setMessage(""); setError(e instanceof Error ? e.message : "failed"); }
  };

  // Helper: lookup connection name
  const connName = (cid: string) => dbs.find(d => d.connection_id === cid)?.name || cid;
  const isSqlite = dbType(form.db_connection_id) === "sqlite";

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{copy.subtitle}</p>
        <button type="button" onClick={openCreate}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          + {copy.add}
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{message}</span>
          <button onClick={() => setMessage("")} className="ml-2 font-bold">&times;</button>
        </div>
      )}
      {error && !modalOpen && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">加载中…</div>
        ) : dims.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">{copy.noData}</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">{copy.dimId}</th>
                  <th className="px-4 py-3">{copy.code}</th>
                  <th className="px-4 py-3">{copy.label}</th>
                  <th className="px-4 py-3">{copy.dbConn}</th>
                  <th className="px-4 py-3">{copy.dbName}</th>
                  <th className="px-4 py-3">{copy.table}</th>
                  <th className="px-4 py-3">{copy.column}</th>
                  <th className="w-28 px-4 py-3 text-right">{copy.edit} / {copy.delete}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dims.map(d => (
                  <tr key={d.dim_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{d.dim_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-sky-700">{d.code || "—"}</td>
                    <td className="px-4 py-3 font-medium">{d.label}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{connName(d.db_connection_id)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.db_name || "—"}</td>
                    <td className="px-4 py-3">{d.table_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{d.column_name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(d)} className="text-xs text-slate-600 hover:underline mr-3">{copy.edit}</button>
                      <button onClick={() => del(d.dim_id)} className="text-xs text-red-500 hover:underline">{copy.delete}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setModalOpen(false)} />
          <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-900">
              {editing ? `${copy.edit}: ${editDimId}` : copy.add}
            </h3>

            {/* label */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{copy.label} *</label>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="如：租户ID" value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })} />
            </div>

            {/* code */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{copy.code} *</label>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                placeholder="如：tenant_id（仅字母数字下划线）" value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
            </div>

            {/* Step 1: Connection */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{copy.dbConn} *</label>
              <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.db_connection_id}
                onChange={e => onSelectConnection(e.target.value)}>
                <option value="">{copy.selectDb}</option>
                {dbs.map(db => <option key={db.connection_id} value={db.connection_id}>{db.name} ({db.db_type})</option>)}
              </select>
            </div>

            {/* Step 2: DB Name (not for SQLite) */}
            {form.db_connection_id && !isSqlite && (
              <div>
                <label className="text-xs text-slate-500 mb-1 block">{copy.dbName} *</label>
                <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.db_name}
                  disabled={namesLoading || dbNames.length === 0}
                  onChange={e => onSelectDbName(e.target.value)}>
                  <option value="">{namesLoading ? copy.loading : copy.selectDbName}</option>
                  {dbNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}

            {/* Step 3: Table (searchable) */}
            {form.db_connection_id && (isSqlite || form.db_name) && (
              <div>
                <label className="text-xs text-slate-500 mb-1 block">{copy.table} *</label>
                <SearchableSelect
                  options={tables}
                  value={form.table_name}
                  onChange={onSelectTable}
                  placeholder={tablesLoading ? copy.loading : copy.searchTable}
                  disabled={tablesLoading}
                />
              </div>
            )}

            {/* Step 4: Column (searchable) */}
            {form.table_name && (
              <div>
                <label className="text-xs text-slate-500 mb-1 block">{copy.column} *</label>
                <SearchableSelect
                  options={columns}
                  value={form.column_name}
                  onChange={onSelectColumn}
                  placeholder={columnsLoading ? copy.loading : copy.searchColumn}
                  disabled={columnsLoading}
                />
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                {copy.cancel}
              </button>
              <button onClick={save}
                disabled={saving || !form.label.trim() || !form.code.trim() || !form.db_connection_id || !form.table_name || !form.column_name}
                className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? copy.loading : copy.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
