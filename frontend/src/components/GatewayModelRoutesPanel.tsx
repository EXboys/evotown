import { FormEvent, useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";
import { GatewayDrawer } from "./gateway/GatewayDrawer";

export type GatewayModelRoute = {
  route_id: string;
  alias: string;
  target_model: string;
  team_id?: string;
  account_id?: string;
  description?: string;
  priority?: number;
  enabled?: boolean;
};

type FormState = {
  alias: string;
  target_model: string;
  team_id: string;
  account_id: string;
  description: string;
  priority: number;
  enabled: boolean;
};

const emptyForm: FormState = {
  alias: "",
  target_model: "",
  team_id: "",
  account_id: "",
  description: "",
  priority: 100,
  enabled: true,
};

function rowToForm(row: GatewayModelRoute): FormState {
  return {
    alias: row.alias,
    target_model: row.target_model,
    team_id: row.team_id || "",
    account_id: row.account_id || "",
    description: row.description || "",
    priority: row.priority ?? 100,
    enabled: row.enabled !== false,
  };
}

export function GatewayModelRoutesPanel() {
  const [routes, setRoutes] = useState<GatewayModelRoute[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRoutes = useCallback(async () => {
    const res = await adminFetch("/api/gateway/v1/model-routes");
    if (!res.ok) throw new Error(`加载路由失败 (${res.status})`);
    const data = await res.json() as { routes?: GatewayModelRoute[] };
    setRoutes(Array.isArray(data.routes) ? data.routes : []);
  }, []);

  useEffect(() => {
    loadRoutes().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [loadRoutes]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setDrawerOpen(true);
  };

  const openEdit = (row: GatewayModelRoute) => {
    setEditingId(row.route_id);
    setForm(rowToForm(row));
    setError("");
    setDrawerOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        const res = await adminFetch(`/api/gateway/v1/model-routes/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json() as { detail?: string };
        if (!res.ok) throw new Error(data.detail || `保存失败 (${res.status})`);
      } else {
        const res = await adminFetch("/api/gateway/v1/model-routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json() as { detail?: string };
        if (!res.ok) throw new Error(data.detail || `创建失败 (${res.status})`);
      }
      closeDrawer();
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleRoute = async (route: GatewayModelRoute) => {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/gateway/v1/model-routes/${route.route_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !route.enabled }),
      });
      if (!res.ok) throw new Error(`更新失败 (${res.status})`);
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteRoute = async (routeId: string) => {
    if (!window.confirm("确定删除该模型路由？")) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/gateway/v1/model-routes/${routeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`删除失败 (${res.status})`);
      if (editingId === routeId) closeDrawer();
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          客户端 <code className="text-xs">model</code> 使用 alias，转发到已注册的 model_name。
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          添加别名
        </button>
      </div>

      {error && !drawerOpen && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Alias → Target</th>
              <th className="hidden px-3 py-2.5 md:table-cell">Scope</th>
              <th className="px-3 py-2.5">状态</th>
              <th className="w-28 px-3 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {routes.map((route) => (
              <tr key={route.route_id}>
                <td className="px-3 py-2.5">
                  <div className="font-mono text-xs font-semibold text-slate-950">{route.alias}</div>
                  <div className="font-mono text-xs text-slate-500">→ {route.target_model}</div>
                </td>
                <td className="hidden px-3 py-2.5 font-mono text-xs text-slate-600 md:table-cell">
                  {route.account_id ? `acc:${route.account_id}` : route.team_id ? `team:${route.team_id}` : "global"}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      route.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {route.enabled ? "启用" : "停用"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={() => openEdit(route)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                      编辑
                    </button>
                    <button type="button" disabled={busy} onClick={() => deleteRoute(route.route_id)} className="text-xs text-red-600 hover:text-red-800">
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!routes.length && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  暂无别名；未配置时按原始 model 名转发。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <GatewayDrawer
        open={drawerOpen}
        title={editingId ? "编辑别名路由" : "添加别名路由"}
        subtitle="priority 越小越优先；账号 scope 高于团队，团队高于全局"
        onClose={closeDrawer}
      >
        {error && drawerOpen && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Alias *</span>
            <input
              value={form.alias}
              onChange={(e) => setForm({ ...form, alias: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
              placeholder="enterprise-default"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Target model *</span>
            <input
              value={form.target_model}
              onChange={(e) => setForm({ ...form, target_model: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">团队 ID</span>
              <input
                value={form.team_id}
                onChange={(e) => setForm({ ...form, team_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">账号 ID</span>
              <input
                value={form.account_id}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Priority</span>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              min={0}
              max={10000}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">说明</span>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            启用
          </label>
          <div className="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              取消
            </button>
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {editingId ? "保存" : "创建"}
            </button>
          </div>
        </form>
      </GatewayDrawer>
    </div>
  );
}
