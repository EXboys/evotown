import { FormEvent, useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";

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

const emptyForm = {
  alias: "",
  target_model: "",
  team_id: "",
  account_id: "",
  description: "",
  priority: 100,
  enabled: true,
};

export function GatewayModelRoutesPanel() {
  const [routes, setRoutes] = useState<GatewayModelRoute[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRoutes = useCallback(async () => {
    const res = await adminFetch("/api/gateway/v1/model-routes");
    if (!res.ok) {
      throw new Error(`加载路由失败 (${res.status})`);
    }
    const data = await res.json() as { routes?: GatewayModelRoute[] };
    setRoutes(Array.isArray(data.routes) ? data.routes : []);
  }, []);

  useEffect(() => {
    loadRoutes().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [loadRoutes]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch("/api/gateway/v1/model-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { detail?: string };
      if (!res.ok) {
        throw new Error(data.detail || `创建失败 (${res.status})`);
      }
      setForm(emptyForm);
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleRoute = async (route: GatewayModelRoute) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/gateway/v1/model-routes/${route.route_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !route.enabled }),
      });
      if (!res.ok) {
        throw new Error(`更新失败 (${res.status})`);
      }
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
    setError("");
    try {
      const res = await adminFetch(`/api/gateway/v1/model-routes/${routeId}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`删除失败 (${res.status})`);
      }
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-950">模型路由</h3>
        <p className="mt-1 text-sm text-slate-500">
          客户端请求使用 alias（如 <code className="text-xs">enterprise-default</code>），Evotown 转发到 LiteLLM 的 target model。
          可按团队 / 账号覆盖。
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <input
          value={form.alias}
          onChange={(e) => setForm({ ...form, alias: e.target.value })}
          placeholder="Alias（客户端 model 名）*"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          required
        />
        <input
          value={form.target_model}
          onChange={(e) => setForm({ ...form, target_model: e.target.value })}
          placeholder="Target model（LiteLLM 模型 ID）*"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          required
        />
        <input
          value={form.team_id}
          onChange={(e) => setForm({ ...form, team_id: e.target.value })}
          placeholder="团队 ID（可选，限定 scope）"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
          placeholder="账号 ID（可选，最高优先级）"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="说明"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2"
        />
        <div className="flex items-center gap-3 md:col-span-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用
          </label>
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            min={0}
            max={10000}
          />
          <span className="text-xs text-slate-500">priority（越小越优先）</span>
          <button
            type="submit"
            disabled={busy}
            className="ml-auto rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            添加路由
          </button>
        </div>
      </form>

      {!routes.length ? (
        <p className="text-sm text-slate-500">暂无路由 — 请求将按原始 model 名直通 LiteLLM。</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Alias → Target</th>
                <th className="w-28 px-4 py-3 font-semibold">Scope</th>
                <th className="w-20 px-4 py-3 font-semibold">Pri</th>
                <th className="w-24 px-4 py-3 font-semibold">状态</th>
                <th className="w-32 px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {routes.map((route) => (
                <tr key={route.route_id}>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-semibold text-slate-950">{route.alias}</div>
                    <div className="font-mono text-xs text-slate-500">→ {route.target_model}</div>
                    {route.description && <div className="text-xs text-slate-400">{route.description}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {route.account_id ? `acc:${route.account_id}` : route.team_id ? `team:${route.team_id}` : "global"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{route.priority ?? 100}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${route.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {route.enabled ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleRoute(route)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-950"
                      >
                        {route.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => deleteRoute(route.route_id)}
                        className="text-xs font-medium text-red-600 hover:text-red-800"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
