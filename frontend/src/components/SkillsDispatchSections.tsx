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

type AccountRow = {
  account_id: string;
  name: string;
  login_name?: string;
  role?: string;
};

export function SkillBundlePublishSection() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [bundlePublish, setBundlePublish] = useState({ bundle_id: "default-agent-skills", channel: "stable", version: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
      const nextManifest = bundleData.manifest ?? null;
      setManifest(nextManifest);
      setSkills(approved);
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

  useEffect(() => {
    void load();
  }, []);

  const toggleSkillSelection = (skillId: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const publishBundle = async (includeAllApproved: boolean) => {
    const skill_ids = includeAllApproved ? [] : Array.from(selectedSkillIds);
    if (!includeAllApproved && !skill_ids.length) {
      setError("请至少选择一个已通过的技能");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await adminFetch(`/api/v1/skill-bundles/${encodeURIComponent(bundlePublish.bundle_id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: bundlePublish.channel,
          version: bundlePublish.version.trim() || null,
          skill_ids,
          include_all_approved: includeAllApproved,
        }),
      });
      const data = await res.json() as { detail?: string; manifest?: BundleManifest };
      if (!res.ok) throw new Error(data.detail || `发布失败 (${res.status})`);
      setMessage(`Bundle 已发布 ${data.manifest?.bundle_id}@${data.manifest?.version}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-sm text-violet-900">
        <strong>本机 OpenClaw / Hermes / SkillLite：</strong>发布 Bundle 后，员工在本机运行
        <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs">evotown-agent-setup.py sync</code>
        拉取技能清单。
      </div>
      {message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">发布 Bundle</h3>
          <p className="mt-1 text-sm text-slate-500">勾选已通过审核的技能，写入员工 manifest（default-agent-skills）。</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="bundle_id" value={bundlePublish.bundle_id} onChange={(e) => setBundlePublish({ ...bundlePublish, bundle_id: e.target.value })} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="channel" value={bundlePublish.channel} onChange={(e) => setBundlePublish({ ...bundlePublish, channel: e.target.value })} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="版本（可留空自动 +1）" value={bundlePublish.version} onChange={(e) => setBundlePublish({ ...bundlePublish, version: e.target.value })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedSkillIds(new Set(skills.map((s) => s.skill_id)))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">全选已通过</button>
            <button type="button" disabled={busy} onClick={() => void publishBundle(false)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">发布选中 ({selectedSkillIds.size})</button>
            <button type="button" disabled={busy} onClick={() => void publishBundle(true)} className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 disabled:opacity-50">发布全部已通过</button>
          </div>
          <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3">
            {skills.length ? skills.map((skill) => (
              <label key={skill.skill_id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedSkillIds.has(skill.skill_id)} onChange={() => toggleSkillSelection(skill.skill_id)} />
                <span className="font-medium text-slate-900">{skill.name}</span>
                <span className="font-mono text-xs text-slate-400">{skill.skill_id}</span>
              </label>
            )) : <p className="text-sm text-slate-500">暂无已通过的技能，请先在「技能库」Tab 上传并审核。</p>}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">当前 Manifest</h3>
          <p className="mt-1 text-sm text-slate-500">员工 sync 时拉取的版本。</p>
          {manifest ? (
            <div className="mt-4 space-y-2">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-mono font-semibold text-slate-900">{manifest.bundle_id}@{manifest.version}</div>
                <div className="mt-1 text-xs text-slate-500">{manifest.channel}{manifest.published_at ? ` · ${formatDateTimeShort(manifest.published_at)}` : ""}</div>
              </div>
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {manifest.skills.map((skill) => (
                  <li key={skill.skill_id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium text-slate-900">{skill.name}</div>
                      <div className="font-mono text-[11px] text-slate-400">{skill.skill_id}</div>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">v{skill.version}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-8 text-center text-sm text-slate-500">尚未发布 Bundle</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SkillAccountAssignSection() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminFetch("/api/v1/accounts")
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载账号失败 (${res.status})`);
        return res.json() as Promise<{ accounts?: AccountRow[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = data.accounts || [];
        setAccounts(list);
        if (list.length === 1) setAccountId(list[0].account_id);
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

  const selected = accounts.find((a) => a.account_id === accountId);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <strong>云端 Coding Agent：</strong>为账号勾选技能后，该账号下所有 Agent 在<strong>下次运行任务</strong>时会自动挂载这些技能（写入 workspace）。
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-sm font-medium text-slate-700">目标账号</label>
        {loading ? (
          <p className="text-sm text-slate-400">加载账号列表…</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-slate-500">暂无账号。请先在「账号管理」创建员工账号。</p>
        ) : (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">请选择账号…</option>
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name}{a.login_name ? ` (${a.login_name})` : ""} · {a.account_id.slice(0, 12)}…
              </option>
            ))}
          </select>
        )}
        {selected ? (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <SkillsAssignmentPanel accountId={selected.account_id} accountName={selected.name} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
