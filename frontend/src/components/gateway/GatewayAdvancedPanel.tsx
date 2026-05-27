import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../../hooks/useAdminToken";

type GatewayHealth = {
  litellm_configured?: boolean;
  managed_upstream_models?: number;
};

/** IT 可选能力：折叠展示，不出现第三方产品名。 */
export function GatewayAdvancedPanel() {
  const [health, setHealth] = useState<GatewayHealth | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/gateway/v1/health");
    if (!res.ok) return;
    const data = await res.json() as GatewayHealth;
    setHealth(data);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const extensionRouterOn = Boolean(health?.litellm_configured);

  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/80 text-sm">
      <summary className="cursor-pointer select-none px-4 py-3 font-medium text-slate-700">
        高级 · 扩展路由（可选，IT 部署）
      </summary>
      <div className="space-y-2 border-t border-slate-200 px-4 py-3 text-slate-600">
        <p>
          日常请在上方配置<strong className="font-medium text-slate-800">上游模型</strong>与<strong className="font-medium text-slate-800">别名</strong>。
          若 IT 额外部署了独立路由集群，保存模型时会自动尝试注册到该集群，用于多厂商 fallback 等能力。
        </p>
        <ul className="list-inside list-disc text-xs text-slate-500">
          <li>
            扩展路由：
            <span className={extensionRouterOn ? "text-emerald-700" : "text-slate-500"}>
              {extensionRouterOn ? " 已连接" : " 未启用（不影响 Evotown 直连转发）"}
            </span>
          </li>
          <li>已注册上游模型：{health?.managed_upstream_models ?? "—"} 个</li>
        </ul>
        <p className="text-xs text-slate-400">
          扩展路由为可选部署组件，由 IT 在私有化安装时启用；未启用时不影响上方「上游模型」的直连转发。
        </p>
      </div>
    </details>
  );
}
