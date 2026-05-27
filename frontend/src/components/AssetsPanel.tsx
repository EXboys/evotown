// AssetsPanel - asset registry review queue
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../hooks/useAdminToken";

type AssetRecord = {
  asset_id: string;
  asset_type: string;
  source_run_id?: string;
  name: string;
  description?: string;
  author?: string;
  team_id?: string;
  engine_id?: string;
  version?: string;
  status: "pending" | "approved" | "rejected" | "deprecated";
  tags?: string[];
  content?: Record<string, unknown>;
  created_at?: string;
};

const STATUS_META: Record<AssetRecord["status"], { label: string; className: string }> = {
  pending: { label: "待审核", className: "border-amber-200 bg-amber-50 text-amber-700" },
  approved: { label: "已批准", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "已拒绝", className: "border-red-200 bg-red-50 text-red-700" },
  deprecated: { label: "已下线", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

export function AssetsPanel() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback((status = statusFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (status) params.set("status_filter", status);
    adminFetch(`/api/v1/assets?${params.toString()}`)
      .then((r) => r.json() as Promise<{ assets?: AssetRecord[] }>)
      .then((data) => setAssets(Array.isArray(data.assets) ? data.assets : []))
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const review = async (asset: AssetRecord, decision: "approved" | "rejected") => {
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch(`/api/v1/assets/${encodeURIComponent(asset.asset_id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reviewer: "admin", reason: decision === "approved" ? "approved from console" : "rejected from console" }),
      });
      if (!res.ok) throw new Error(`审核失败 (${res.status})`);
      setMessage(`「${asset.name}」已${decision === "approved" ? "批准" : "拒绝"}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "审核失败");
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = assets.filter((a) => a.status === "pending").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          从 Run 提交的 skill / prompt / workflow 等待审核；批准后可在技能市场进一步发布。
          {pendingCount > 0 && <span className="ml-2 font-medium text-amber-700">{pendingCount} 条待审</span>}
        </p>
        <select
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); load(e.target.value); }}
        >
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="approved">已批准</option>
          <option value="rejected">已拒绝</option>
        </select>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-500">加载资产…</p>
      ) : !assets.length ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">暂无资产记录。可在「运行」详情中提交资产。</p>
      ) : (
        <div className="space-y-3">
          {assets.map((asset) => {
            const meta = STATUS_META[asset.status];
            return (
              <article key={asset.asset_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-violet-600">{asset.asset_type}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                    </div>
                    <h3 className="mt-1 font-semibold text-slate-950">{asset.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{asset.description || "无描述"}</p>
                    <p className="mt-2 font-mono text-xs text-slate-400">
                      {asset.asset_id}
                      {asset.source_run_id && ` · run ${asset.source_run_id}`}
                      {asset.team_id && ` · team ${asset.team_id}`}
                    </p>
                  </div>
                </div>
                {asset.content && Object.keys(asset.content).length > 0 && (
                  <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
                    {JSON.stringify(asset.content, null, 2)}
                  </pre>
                )}
                {asset.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => review(asset, "approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">批准</button>
                    <button type="button" disabled={busy} onClick={() => review(asset, "rejected")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50">拒绝</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
