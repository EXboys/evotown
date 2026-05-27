import { FormEvent, useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";
import { GatewayDrawer } from "./gateway/GatewayDrawer";

export type GatewayUpstreamModel = {
  model_id: string;
  model_name: string;
  provider_label?: string;
  litellm_model?: string;
  api_base: string;
  api_key_hint?: string;
  api_key_set?: boolean;
  description?: string;
  enabled?: boolean;
  litellm_synced?: boolean;
  sync_error?: string;
};

type FormState = {
  model_name: string;
  provider_label: string;
  upstream_model_param: string;
  api_base: string;
  api_key: string;
  description: string;
  enabled: boolean;
};

const emptyForm: FormState = {
  model_name: "",
  provider_label: "",
  upstream_model_param: "",
  api_base: "",
  api_key: "",
  description: "",
  enabled: true,
};

function rowToForm(row: GatewayUpstreamModel): FormState {
  return {
    model_name: row.model_name,
    provider_label: row.provider_label || "",
    upstream_model_param: row.litellm_model || "",
    api_base: row.api_base,
    api_key: "",
    description: row.description || "",
    enabled: row.enabled !== false,
  };
}

export function GatewayUpstreamModelsPanel() {
  const [models, setModels] = useState<GatewayUpstreamModel[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKeyHint, setEditingKeyHint] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadModels = useCallback(async () => {
    const res = await adminFetch("/api/gateway/v1/upstream-models");
    if (!res.ok) {
      throw new Error(`加载上游模型失败 (${res.status})`);
    }
    const data = await res.json() as { models?: GatewayUpstreamModel[] };
    setModels(Array.isArray(data.models) ? data.models : []);
  }, []);

  useEffect(() => {
    loadModels().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [loadModels]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId(null);
    setEditingKeyHint("");
    setForm(emptyForm);
    setError("");
  };

  const openCreate = () => {
    setEditingId(null);
    setEditingKeyHint("");
    setForm(emptyForm);
    setError("");
    setDrawerOpen(true);
  };

  const openEdit = (row: GatewayUpstreamModel) => {
    setEditingId(row.model_id);
    setEditingKeyHint(row.api_key_hint || "");
    setForm(rowToForm(row));
    setError("");
    setDrawerOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const litellm_model = form.upstream_model_param;
      if (editingId) {
        const payload: Record<string, unknown> = {
          model_name: form.model_name,
          provider_label: form.provider_label,
          litellm_model,
          api_base: form.api_base,
          description: form.description,
          enabled: form.enabled,
        };
        if (form.api_key.trim()) {
          payload.api_key = form.api_key.trim();
        }
        const res = await adminFetch(`/api/gateway/v1/upstream-models/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as { detail?: string };
        if (!res.ok) {
          throw new Error(data.detail || `保存失败 (${res.status})`);
        }
        closeDrawer();
        await loadModels();
        return;
      }

      if (!form.api_key.trim()) {
        throw new Error("请填写 API Key");
      }
      const res = await adminFetch("/api/gateway/v1/upstream-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_name: form.model_name,
          provider_label: form.provider_label,
          litellm_model,
          api_base: form.api_base,
          api_key: form.api_key,
          description: form.description,
          enabled: form.enabled,
        }),
      });
      const data = await res.json() as { detail?: string };
      if (!res.ok) {
        throw new Error(data.detail || `创建失败 (${res.status})`);
      }
      closeDrawer();
      await loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteModel = async (modelId: string) => {
    if (!window.confirm("确定删除该上游模型？")) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/gateway/v1/upstream-models/${modelId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`删除失败 (${res.status})`);
      if (editingId === modelId) closeDrawer();
      await loadModels();
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
          在 Evotown 注册厂商 endpoint；别名路由的 target 填下方 model_name。
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          添加模型
        </button>
      </div>

      {error && !drawerOpen && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Model</th>
              <th className="hidden px-3 py-2.5 sm:table-cell">Base URL</th>
              <th className="px-3 py-2.5">状态</th>
              <th className="w-28 px-3 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {models.map((row) => (
              <tr key={row.model_id}>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-900">{row.model_name}</div>
                  <div className="text-xs text-slate-500">
                    {[row.provider_label, row.api_key_hint].filter(Boolean).join(" · ") || "—"}
                  </div>
                </td>
                <td className="hidden max-w-[220px] truncate px-3 py-2.5 text-slate-600 sm:table-cell" title={row.api_base}>
                  {row.api_base}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      row.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                    title={row.sync_error || undefined}
                  >
                    {row.enabled ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={() => openEdit(row)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                      编辑
                    </button>
                    <button type="button" disabled={busy} onClick={() => deleteModel(row.model_id)} className="text-xs text-red-600 hover:text-red-800">
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!models.length && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  暂无上游模型，点击「添加模型」开始配置。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <GatewayDrawer
        open={drawerOpen}
        title={editingId ? "编辑上游模型" : "添加上游模型"}
        subtitle={editingId ? `当前 Key ${editingKeyHint || "已设置"}，留空 API Key 则不更换` : undefined}
        onClose={closeDrawer}
      >
        {error && drawerOpen && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Model name *</span>
            <input
              value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">厂商标签</span>
            <input
              value={form.provider_label}
              onChange={(e) => setForm({ ...form, provider_label: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="OpenAI / DeepSeek / Qwen"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">API Base *</span>
            <input
              value={form.api_base}
              onChange={(e) => setForm({ ...form, api_base: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="https://api.openai.com/v1"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">API Key {editingId ? "" : "*"}</span>
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required={!editingId}
              autoComplete="off"
              placeholder={editingId ? "留空保持不变" : ""}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">厂商 model 参数</span>
            <input
              value={form.upstream_model_param}
              onChange={(e) => setForm({ ...form, upstream_model_param: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="发给厂商 API 的 model 字段，默认与 model name 相同"
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
            <button
              type="button"
              onClick={closeDrawer}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {editingId ? "保存" : "创建"}
            </button>
          </div>
        </form>
      </GatewayDrawer>
    </div>
  );
}
