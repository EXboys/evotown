import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import { SkillsAssignmentPanel } from "./SkillsAssignmentPanel";

type SkillRecord = {
  skill_id: string;
  name: string;
  version: string;
  status: string;
};

type BundleManifest = {
  bundle_id: string;
  version: string;
  channel: string;
  published_at?: string;
  skills: Array<{ skill_id: string; name: string; version: string }>;
};

type AgentRow = {
  agent_id: string;
  name: string;
};

export function BundlePublishSection() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [bundlePublish, setBundlePublish] = useState({ bundle_id: "default-agent-skills", channel: "stable", version: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [bundleRes, skillsRes] = await Promise.all([
        adminFetch("/api/v1/skill-bundles/default-agent-skills/manifest"),
        adminFetch("/api/v1/skills?status_filter=approved&limit=200"),
      ]);
      const bundleData = await bundleRes.json() as { manifest?: BundleManifest };
      const skillsData = await skillsRes.json() as { skills?: SkillRecord[] };
      const approved = (skillsData.skills || []).filter((s) => s.status === "approved");
      setSkills(approved);
      const nextManifest = bundleData.manifest || null;
      setManifest(nextManifest);
      if (nextManifest?.skills?.length) {
        const approvedIds = new Set(approved.map((s) => s.skill_id));
        setSelectedSkillIds(new Set(nextManifest.skills.map((s) => s.skill_id).filter((id) => approvedIds.has(id))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const publishBundle = async () => {
    setError("");
    try {
      const res = await adminFetch(`/api/v1/skill-bundles/${encodeURIComponent(bundlePublish.bundle_id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_ids: [...selectedSkillIds], channel: bundlePublish.channel }),
      });
      if (!res.ok) throw new Error(`发布失败 (${res.status})`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <strong>Bundle 发布：</strong>将已通过审核的技能打包为 default-agent-skills Bundle，供 Staff 账号下的 Agent 使用。
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="h-24 animate-pulse rounded-xl bg-slate-100" /> : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-600">已通过审核的技能 ({skills.length})</p>
          <p className="mt-1 text-sm text-slate-500">勾选已通过审核的技能，写入员工 manifest（default-agent-skills）。</p>
          {manifest && (
            <p className="mt-1 text-xs text-slate-400">
              当前 Bundle: {manifest.bundle_id}@{manifest.version} · {manifest.skills.length} 个技能
              {manifest.published_at && <> · 发布于 {formatDateTimeShort(manifest.published_at)}</>}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setSelectedSkillIds(new Set(skills.map((s) => s.skill_id)))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">全选已通过</button>
            <button type="button" onClick={() => setSelectedSkillIds(new Set())} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">取消全选</button>
          </div>
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {skills.length ? skills.map((skill) => (
              <label key={skill.skill_id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                <input type="checkbox" checked={selectedSkillIds.has(skill.skill_id)} onChange={() => toggleSkill(skill.skill_id)} />
                <span className="text-sm text-slate-700">{skill.name}</span>
                <span className="text-xs text-slate-400">v{skill.version}</span>
              </label>
            )) : <p className="text-sm text-slate-400">暂无已通过审核的技能</p>}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={publishBundle} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700">发布 Bundle</button>
          </div>
        </div>
      )}
      {manifest && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-700">当前 Bundle 包含的技能</p>
          <div className="mt-2 space-y-1">
            {manifest.skills.map((skill) => (
              <div key={skill.skill_id} className="text-sm text-slate-600">· {skill.name} v{skill.version}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SkillAgentAssignSection() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminFetch("/api/v1/agents")
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载智能体失败 (${res.status})`);
        return res.json() as Promise<{ agents?: AgentRow[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = (data.agents || []).map((a) => ({ agent_id: a.agent_id, name: a.name }));
        setAgents(list);
        if (list.length === 1) setAgentId(list[0].agent_id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = agents.find((a) => a.agent_id === agentId);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <strong>智能体技能：</strong>选择智能体查看已绑定的技能列表（只读）。下发技能请在「能力中心 → 技能」中操作。
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-sm font-medium text-slate-700">目标智能体</label>
        {loading ? (
          <p className="text-sm text-slate-400">加载智能体列表…</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-slate-500">暂无智能体。请先在「智能体管理」创建工作区。</p>
        ) : (
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">请选择智能体…</option>
            {agents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.name} · {a.agent_id.slice(0, 12)}…
              </option>
            ))}
          </select>
        )}
        {selected ? (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <SkillsAssignmentPanel agentId={selected.agent_id} agentName={selected.name} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
