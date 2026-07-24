import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";

const SOURCE_LABEL: Record<string, string> = { market: "技能市场", custom: "自定义技能" };

type SkillInfo = {
  skill_id: string;
  name: string;
  version?: string;
  source_type?: string;
};

type Props = {
  /** Agent ID — preferred. When set, queries agent-level skill bindings. */
  agentId?: string;
  agentName?: string;
  /** Account ID — legacy fallback. Only used when agentId is not set. */
  accountId?: string;
  accountName?: string;
};

export function SkillsAssignmentPanel({ agentId, agentName, accountId, accountName }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isAgent = Boolean(agentId);
  const entityId = agentId || accountId || "";
  const entityName = agentName || accountName || "";

  const load = async () => {
    if (!entityId) return;
    setLoading(true);
    setError("");
    try {
      // Get all skills from market
      const res = await adminFetch("/api/v1/skills?limit=200");
      const data = await res.json().catch(() => ({}));
      const allSkills = (data.skills || data.items || []) as SkillInfo[];

      // Get assigned skill IDs — agent-level preferred, account-level fallback
      const apiUrl = isAgent
        ? `/api/v1/agents/${encodeURIComponent(entityId)}/skills`
        : `/api/v1/accounts/${encodeURIComponent(entityId)}/skills`;
      const res2 = await adminFetch(apiUrl);
      const data2 = await res2.json().catch(() => ({}));
      const assignedIds: string[] = data2.skills || [];

      // Build skill info list for assigned skills only
      const skillMap = new Map(allSkills.map((s) => [s.skill_id, s]));
      const assignedSkills = assignedIds
        .map((id) => skillMap.get(id))
        .filter(Boolean) as SkillInfo[];
      setSkills(assignedSkills);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [entityId]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {entityName} 已绑定的技能列表（只读）。如需下发或取消，请在「智能体管理后台 → 能力中心 → 技能」中操作。
      </p>

      {skills.length === 0 ? (
        <p className="text-sm text-slate-400 italic py-4 text-center">
          暂无已绑定的技能
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            已绑定 {skills.length} 个技能
          </p>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {skills.map((skill) => (
              <div
                key={skill.skill_id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {skill.name}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                    {skill.skill_id}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500">
                    v{skill.version || "—"}
                  </span>
                  {skill.source_type && (
                    <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-500">
                      {SOURCE_LABEL[skill.source_type] || skill.source_type}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
