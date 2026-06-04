import { FormEvent, useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";
import { GatewayDrawer } from "./gateway/GatewayDrawer";

type AutoTierName = "fast" | "balanced" | "strong";

type AutoTierModel = {
  model: string;
  weight: number;
  quota_tokens: number;
  quota_remaining_tokens: number;
  enabled: boolean;
};

type GatewayAutoPolicy = {
  tiers?: Partial<Record<AutoTierName, Array<string | Partial<AutoTierModel>> | string>>;
  threshold_tokens_fast?: number;
  threshold_tokens_strong?: number;
  tools_use_strong?: boolean;
  tier_fallback_order?: AutoTierName[];
};

export type GatewayModelRoute = {
  route_id: string;
  alias: string;
  target_model: string;
  team_id?: string;
  account_id?: string;
  description?: string;
  priority?: number;
  enabled?: boolean;
  route_type?: string;
  fallback_models?: string[];
  enable_fallback?: boolean;
  auto_policy?: GatewayAutoPolicy;
};

type FormState = {
  alias: string;
  target_model: string;
  team_id: string;
  account_id: string;
  description: string;
  priority: number;
  enabled: boolean;
  route_type: string;
  fallback_models_text: string;
  enable_fallback: boolean;
  threshold_tokens_fast: number;
  threshold_tokens_strong: number;
  tools_use_strong: boolean;
  auto_tiers: Record<AutoTierName, AutoTierModel[]>;
};

const tierNames: AutoTierName[] = ["fast", "balanced", "strong"];
const tierLabels: Record<AutoTierName, string> = {
  fast: "Fast",
  balanced: "Balanced",
  strong: "Strong",
};

function emptyTierModel(): AutoTierModel {
  return { model: "", weight: 100, quota_tokens: 0, quota_remaining_tokens: 0, enabled: true };
}

function emptyAutoTiers(): Record<AutoTierName, AutoTierModel[]> {
  return {
    fast: [emptyTierModel()],
    balanced: [emptyTierModel()],
    strong: [emptyTierModel()],
  };
}

const emptyForm: FormState = {
  alias: "",
  target_model: "",
  team_id: "",
  account_id: "",
  description: "",
  priority: 100,
  enabled: true,
  route_type: "static",
  fallback_models_text: "",
  enable_fallback: true,
  threshold_tokens_fast: 2000,
  threshold_tokens_strong: 8000,
  tools_use_strong: true,
  auto_tiers: emptyAutoTiers(),
};

function normalizeTierModels(raw: unknown): AutoTierModel[] {
  const items = typeof raw === "string" || (raw && !Array.isArray(raw) && typeof raw === "object") ? [raw] : Array.isArray(raw) ? raw : [];
  const models = items.map((item) => {
    if (typeof item === "string") return { ...emptyTierModel(), model: item };
    const obj = item && typeof item === "object" ? item as Partial<AutoTierModel> & { model_name?: string; name?: string } : {};
    return {
      model: String(obj.model || obj.model_name || obj.name || ""),
      weight: Number(obj.weight ?? 100),
      quota_tokens: Number(obj.quota_tokens ?? 0),
      quota_remaining_tokens: Number(obj.quota_remaining_tokens ?? 0),
      enabled: obj.enabled !== false,
    };
  });
  return models.length ? models : [emptyTierModel()];
}

function policyToAutoTiers(policy?: GatewayAutoPolicy): Record<AutoTierName, AutoTierModel[]> {
  const tiers = policy?.tiers || {};
  return {
    fast: normalizeTierModels(tiers.fast),
    balanced: normalizeTierModels(tiers.balanced),
    strong: normalizeTierModels(tiers.strong),
  };
}

function buildAutoPolicy(form: FormState): GatewayAutoPolicy {
  const tiers = Object.fromEntries(
    tierNames.map((tier) => [
      tier,
      form.auto_tiers[tier]
        .map((item) => ({
          model: item.model.trim(),
          weight: Number(item.weight) || 0,
          quota_tokens: Number(item.quota_tokens) || 0,
          quota_remaining_tokens: Number(item.quota_remaining_tokens) || 0,
          enabled: item.enabled,
        }))
        .filter((item) => item.model),
    ]),
  ) as Record<AutoTierName, AutoTierModel[]>;

  return {
    tiers,
    threshold_tokens_fast: Number(form.threshold_tokens_fast) || 2000,
    threshold_tokens_strong: Number(form.threshold_tokens_strong) || 8000,
    tools_use_strong: form.tools_use_strong,
    tier_fallback_order: ["fast", "balanced", "strong"],
  };
}

function summarizeAutoPolicy(policy?: GatewayAutoPolicy): string {
  const tiers = policyToAutoTiers(policy);
  return tierNames
    .map((tier) => {
      const names = tiers[tier].map((item) => item.model.trim()).filter(Boolean);
      return names.length ? `${tier}: ${names.join(" → ")}` : "";
    })
    .filter(Boolean)
    .join(" | ");
}

function rowToForm(row: GatewayModelRoute): FormState {
  return {
    alias: row.alias,
    target_model: row.target_model,
    team_id: row.team_id || "",
    account_id: row.account_id || "",
    description: row.description || "",
    priority: row.priority ?? 100,
    enabled: row.enabled !== false,
    route_type: row.route_type || "static",
    fallback_models_text: (row.fallback_models || []).join(", "),
    enable_fallback: row.enable_fallback !== false,
    threshold_tokens_fast: Number(row.auto_policy?.threshold_tokens_fast ?? 2000),
    threshold_tokens_strong: Number(row.auto_policy?.threshold_tokens_strong ?? 8000),
    tools_use_strong: row.auto_policy?.tools_use_strong !== false,
    auto_tiers: policyToAutoTiers(row.auto_policy),
  };
}

function formToPayload(form: FormState) {
  const fallback_models = form.fallback_models_text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    alias: form.alias,
    target_model: form.target_model,
    team_id: form.team_id,
    account_id: form.account_id,
    description: form.description,
    priority: form.priority,
    enabled: form.enabled,
    route_type: form.route_type,
    fallback_models,
    enable_fallback: form.enable_fallback,
    auto_policy: buildAutoPolicy(form),
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
          body: JSON.stringify(formToPayload(form)),
        });
        const data = await res.json() as { detail?: string };
        if (!res.ok) throw new Error(data.detail || `保存失败 (${res.status})`);
      } else {
        const res = await adminFetch("/api/gateway/v1/model-routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(form)),
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

  const updateTierModel = (tier: AutoTierName, index: number, patch: Partial<AutoTierModel>) => {
    setForm((prev) => ({
      ...prev,
      auto_tiers: {
        ...prev.auto_tiers,
        [tier]: prev.auto_tiers[tier].map((item, idx) => idx === index ? { ...item, ...patch } : item),
      },
    }));
  };

  const addTierModel = (tier: AutoTierName) => {
    setForm((prev) => ({
      ...prev,
      auto_tiers: {
        ...prev.auto_tiers,
        [tier]: [...prev.auto_tiers[tier], emptyTierModel()],
      },
    }));
  };

  const removeTierModel = (tier: AutoTierName, index: number) => {
    setForm((prev) => {
      const next = prev.auto_tiers[tier].filter((_, idx) => idx !== index);
      return {
        ...prev,
        auto_tiers: {
          ...prev.auto_tiers,
          [tier]: next.length ? next : [emptyTierModel()],
        },
      };
    });
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
                  <div className="font-mono text-xs text-slate-500">
                    → {route.target_model}
                    {route.fallback_models?.length ? ` (+${route.fallback_models.join(", ")})` : ""}
                  </div>
                  {route.route_type === "auto" && (
                    <div className="mt-1 text-xs text-slate-500">
                      auto: {summarizeAutoPolicy(route.auto_policy) || "未配置模型组"}
                    </div>
                  )}
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
            <span className="font-medium text-slate-700">路由类型</span>
            <select
              value={form.route_type}
              onChange={(e) => setForm({ ...form, route_type: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="static">static（固定目标）</option>
              <option value="auto">auto（按复杂度选 tier，需在 auto_policy 配置 tiers）</option>
            </select>
          </label>
          {form.route_type === "auto" && (
            <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">自动路由策略</div>
                <p className="mt-0.5 text-xs text-slate-500">
                  命中某档后会按有效权重排序依次尝试；同档全部不可用后，按 Fast → Balanced → Strong 继续降级。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Fast token 阈值</span>
                  <input
                    type="number"
                    value={form.threshold_tokens_fast}
                    onChange={(e) => setForm({ ...form, threshold_tokens_fast: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    min={1}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Strong token 阈值</span>
                  <input
                    type="number"
                    value={form.threshold_tokens_strong}
                    onChange={(e) => setForm({ ...form, threshold_tokens_strong: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    min={1}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.tools_use_strong}
                  onChange={(e) => setForm({ ...form, tools_use_strong: e.target.checked })}
                />
                请求包含 tools / function calling 时强制使用 Strong
              </label>

              {tierNames.map((tier) => (
                <div key={tier} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{tierLabels[tier]} 模型组</div>
                      <div className="text-xs text-slate-500">额度上限为 0 表示不限制；设置上限后余量为 0 会被跳过。</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addTierModel(tier)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      添加模型
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.auto_tiers[tier].map((item, index) => (
                      <div key={`${tier}-${index}`} className="grid grid-cols-12 gap-2 rounded-lg bg-slate-50 p-2">
                        <label className="col-span-12 block text-xs md:col-span-5">
                          <span className="font-medium text-slate-600">模型名</span>
                          <input
                            value={item.model}
                            onChange={(e) => updateTierModel(tier, index, { model: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs"
                            placeholder={tier === "strong" ? "deepseek-v4-pro" : "qwen3.6-plus"}
                          />
                        </label>
                        <label className="col-span-4 block text-xs md:col-span-2">
                          <span className="font-medium text-slate-600">权重</span>
                          <input
                            type="number"
                            value={item.weight}
                            onChange={(e) => updateTierModel(tier, index, { weight: Number(e.target.value) })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                            min={0}
                          />
                        </label>
                        <label className="col-span-4 block text-xs md:col-span-2">
                          <span className="font-medium text-slate-600">额度上限</span>
                          <input
                            type="number"
                            value={item.quota_tokens}
                            onChange={(e) => updateTierModel(tier, index, { quota_tokens: Number(e.target.value) })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                            min={0}
                          />
                        </label>
                        <label className="col-span-4 block text-xs md:col-span-2">
                          <span className="font-medium text-slate-600">额度余量</span>
                          <input
                            type="number"
                            value={item.quota_remaining_tokens}
                            onChange={(e) => updateTierModel(tier, index, { quota_remaining_tokens: Number(e.target.value) })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                            min={0}
                          />
                        </label>
                        <div className="col-span-12 flex items-center justify-between gap-2 md:col-span-1 md:block">
                          <label className="flex items-center gap-1 pt-1 text-xs text-slate-600 md:pt-6">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(e) => updateTierModel(tier, index, { enabled: e.target.checked })}
                            />
                            启用
                          </label>
                          <button
                            type="button"
                            onClick={() => removeTierModel(tier, index)}
                            className="pt-1 text-xs text-red-600 hover:text-red-800 md:pt-2"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <label className="block text-sm">
            <span className="font-medium text-slate-700">降级链（逗号分隔）</span>
            <input
              value={form.fallback_models_text}
              onChange={(e) => setForm({ ...form, fallback_models_text: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
              placeholder="backup-model, qwen-plus"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.enable_fallback}
              onChange={(e) => setForm({ ...form, enable_fallback: e.target.checked })}
            />
            启用跨模型降级
          </label>
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
