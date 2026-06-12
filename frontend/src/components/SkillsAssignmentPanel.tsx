import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";

type Skill = {
  skill_id: string;
  name: string;
  summary?: string;
  version?: string;
  runtime_targets?: string[];
};

type Props = {
  accountId: string;
  accountName: string;
};

export function SkillsAssignmentPanel({ accountId, accountName }: Props) {
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      // Load all available skills
      const res = await adminFetch("/api/v1/skills?limit=200");
      const data = await res.json().catch(() => ({}));
      setAllSkills((data.skills || data.items || []) as Skill[]);

      // Load assigned skills for this account
      const res2 = await adminFetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/skills`);
      const data2 = await res2.json().catch(() => ({}));
      setAssigned(data2.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const toggle = (skillId: string) => {
    setAssigned((prev) =>
      prev.includes(skillId)
        ? prev.filter((s) => s !== skillId)
        : [...prev, skillId]
    );
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await adminFetch(
        `/api/v1/accounts/${encodeURIComponent(accountId)}/skills`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: assigned }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `保存失败 (${res.status})`);
      }
      setMessage("技能下发已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">
          已选择 {assigned.length} 个技能
        </span>
        <button
          type="button"
          disabled={busy || allSkills.length === 0}
          onClick={save}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div>
      )}

      {allSkills.length === 0 ? (
        <p className="text-xs text-slate-400">暂无可下发技能，请先在技能市场创建或导入。</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {allSkills.map((skill) => (
            <label
              key={skill.skill_id}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={assigned.includes(skill.skill_id)}
                onChange={() => toggle(skill.skill_id)}
                className="mt-0.5 h-3.5 w-3.5 accent-indigo-600"
              />
              <div className="min-w-0 text-xs">
                <div className="font-medium text-slate-700">{skill.name}</div>
                <div className="truncate text-slate-400">{skill.skill_id} · v{skill.version || "?"}</div>
                {skill.summary && (
                  <div className="text-slate-500 line-clamp-2">{skill.summary}</div>
                )}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
