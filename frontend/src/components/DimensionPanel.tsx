import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type Dimension = {
  dim_id: string; label: string; db_connection_id: string;
  table_name: string; column_name: string; created_at: string;
};

type DbConnection = { connection_id: string; name: string; db_type: string; status: string };

const COPY = {
  zh: {
    title: "权限维度管理",
    subtitle: "注册权限维度，维度值从关联数据库表字段读取",
    dimId: "维度 ID",
    label: "显示名",
    dbConn: "关联数据库",
    table: "数据表",
    column: "字段",
    add: "新增维度",
    delete: "删除",
    noData: "暂无维度",
    selectDb: "选择数据库...",
  },
  en: {
    title: "Permission Dimensions",
    subtitle: "Register dimensions. Values are loaded from the linked database table column.",
    dimId: "Dimension ID",
    label: "Label",
    dbConn: "Database",
    table: "Table",
    column: "Column",
    add: "Add",
    delete: "Delete",
    noData: "No dimensions",
    selectDb: "Select database...",
  },
};

export function DimensionPanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [dims, setDims] = useState<Dimension[]>([]);
  const [dbs, setDbs] = useState<DbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ dim_id: "", label: "", db_connection_id: "", table_name: "", column_name: "" });

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

  const create = async () => {
    if (!form.dim_id.trim() || !form.label.trim() || !form.db_connection_id || !form.table_name.trim() || !form.column_name.trim()) return;
    try {
      await adminFetch("/api/v1/dimensions", { method: "POST", body: JSON.stringify(form) });
      setShowForm(false);
      setForm({ dim_id: "", label: "", db_connection_id: "", table_name: "", column_name: "" });
      load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "failed"); }
  };

  const del = async (dimId: string) => {
    if (!confirm(copy.delete + " " + dimId + "?")) return;
    try { await adminFetch(`/api/v1/dimensions/${encodeURIComponent(dimId)}`, { method: "DELETE" }); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "failed"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{copy.subtitle}</p>
        </div>
        <button onClick={() => setShowForm(true)} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">{copy.add}</button>
      </div>
      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.dimId} value={form.dim_id}
              onChange={e => setForm({ ...form, dim_id: e.target.value })} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.label} value={form.label}
              onChange={e => setForm({ ...form, label: e.target.value })} />
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.db_connection_id}
              onChange={e => setForm({ ...form, db_connection_id: e.target.value })}>
              <option value="">{copy.selectDb}</option>
              {dbs.map(db => <option key={db.connection_id} value={db.connection_id}>{db.name} ({db.db_type})</option>)}
            </select>
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.table} value={form.table_name}
              onChange={e => setForm({ ...form, table_name: e.target.value })} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={copy.column} value={form.column_name}
              onChange={e => setForm({ ...form, column_name: e.target.value })} />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={create} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">保存</button>
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
          </div>
        </div>
      )}

      {loading ? <div className="py-8 text-center text-sm text-slate-400">...</div> :
        dims.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">{copy.noData}</div> :
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">{copy.dimId}</th>
                  <th className="px-4 py-3">{copy.label}</th>
                  <th className="px-4 py-3">{copy.dbConn}</th>
                  <th className="px-4 py-3">{copy.table}</th>
                  <th className="px-4 py-3">{copy.column}</th>
                  <th className="w-20 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dims.map(d => (
                  <tr key={d.dim_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{d.dim_id}</td>
                    <td className="px-4 py-3 font-medium">{d.label}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.db_connection_id}</td>
                    <td className="px-4 py-3">{d.table_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{d.column_name}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => del(d.dim_id)} className="text-xs text-red-500 hover:underline">{copy.delete}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}
