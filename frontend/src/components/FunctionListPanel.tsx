import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type FuncRole = { role_id: string; role_name: string; agent_ids: string[] };
type SystemFunc = { func_id: string; name: string; description: string; roles: FuncRole[] };

const COPY = {
  zh: {
    title: "系统功能列表",
    subtitle: "系统内置功能，不可增删改。查看各功能被哪些角色和智能体使用。",
    noData: "暂无数据",
    roles: "拥有此权限的角色",
    workspaces: "关联智能体",
    none: "未分配",
  },
  en: {
    title: "System Functions",
    subtitle: "Built-in system capabilities. View which roles and workspaces use each function.",
    noData: "No data",
    roles: "Roles with this capability",
    workspaces: "Bound workspaces",
    none: "Not assigned",
  },
};

export function FunctionListPanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [funcs, setFuncs] = useState<SystemFunc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/api/v1/mcp-functions?detail=true")
      .then(r => r.json())
      .then(d => setFuncs(d.functions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">…</div>;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">{copy.subtitle}</p>
      </div>
      {funcs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">{copy.noData}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {funcs.map(fn => (
            <div key={fn.func_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <span className="font-mono text-xs text-blue-600 bg-blue-50 rounded px-2 py-0.5">{fn.func_id}</span>
                <span className="ml-2 font-semibold text-slate-900">{fn.name}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{fn.description}</p>
              {fn.roles && fn.roles.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <div className="text-xs font-medium text-slate-500">{copy.roles}</div>
                  {fn.roles.map(r => (
                    <div key={r.role_id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm text-slate-800">{r.role_name}</span>
                        {r.agent_ids.length > 0 ? (
                          <span className="text-xs text-slate-500">
                            → {r.agent_ids.length} 个智能体
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">{copy.none}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-400">{copy.none}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
