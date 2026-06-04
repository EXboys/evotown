import { FormEvent, useEffect, useState } from "react";

import { GatewayDrawer } from "./GatewayDrawer";
import { adminFetch } from "../../hooks/useAdminToken";
import { GatewayOrg } from "../../lib/gatewayOrgs";

type OrgDrawerProps = {
  open: boolean;
  mode: "create" | "edit";
  org: GatewayOrg | null;
  onClose: () => void;
  onSaved: () => void;
};

export function OrgDrawer({ open, mode, org, onClose, onSaved }: OrgDrawerProps) {
  const [name, setName] = useState(org?.name ?? "");
  const [description, setDescription] = useState(org?.description ?? "");
  const [ownerEmail, setOwnerEmail] = useState(org?.owner_email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(org?.name ?? "");
    setDescription(org?.description ?? "");
    setOwnerEmail(org?.owner_email ?? "");
    setError("");
  }, [open, org]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("组织名称不能为空");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const isEdit = mode === "edit" && org;
      const url = isEdit
        ? `/api/v1/gateway-orgs/${encodeURIComponent(org.org_id)}`
        : "/api/v1/gateway-orgs";

      const res = await adminFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          owner_email: ownerEmail.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `保存失败 (${res.status})`);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GatewayDrawer
      open={open}
      title={mode === "edit" ? "编辑组织" : "创建组织"}
      subtitle="管理组织信息，组织下可包含多个账号"
      onClose={onClose}
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">组织名称 *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="如：AI 研发组"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">描述</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="组织职责说明"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">负责人邮箱</span>
          <input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="org-owner@example.com"
          />
        </label>
        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </form>
    </GatewayDrawer>
  );
}
