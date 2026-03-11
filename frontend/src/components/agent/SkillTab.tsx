import { useState } from "react";
import { adminFetch } from "../../hooks/useAdminToken";
import { useEvotownStore } from "../../store/evotownStore";

export interface Skill {
  name: string;
  /** installed=内置, pending=进化待确认, confirmed=进化已启用 */
  status: string;
  description?: string;
  created_at?: string;
  call_count?: number;
  success_count?: number;
}

interface SkillContent {
  skill_md: string | null;
  scripts: { filename: string; content: string }[];
}

interface SkillTabProps {
  agentId: string;
  skills: Skill[];
  onSkillsChange: (skills: Skill[]) => void;
}

export function SkillTab({ agentId, skills, onSkillsChange }: SkillTabProps) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState<Record<string, SkillContent>>({});
  const [skillContentLoading, setSkillContentLoading] = useState<string | null>(null);
  /** 勾选后修复时仅修复这些技能；空则修复全部失败技能 */
  const [repairSelected, setRepairSelected] = useState<Set<string>>(new Set());
  const repairState = useEvotownStore((s) => s.repairStateByAgent[agentId]) ?? {
    repairing: false,
    log: [] as string[],
    msg: null as string | null,
  };
  const setRepairState = useEvotownStore((s) => s.setRepairState);
  const appendRepairLog = useEvotownStore((s) => s.appendRepairLog);
  const { repairing, log: repairLog, msg: repairMsg } = repairState;

  const toggleRepairSelected = (name: string) => {
    setRepairSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectAllForRepair = () => setRepairSelected(new Set(skills.map((s) => s.name)));
  const clearRepairSelected = () => setRepairSelected(new Set());

  const handleRepair = async () => {
    setRepairState(agentId, { repairing: true, log: [], msg: null });
    const skillNames = repairSelected.size > 0 ? Array.from(repairSelected) : [];
    const query = skillNames.length > 0 ? "?" + skillNames.map((n) => "skill_names=" + encodeURIComponent(n)).join("&") : "";
    try {
      const res = await adminFetch(`/agents/${agentId}/repair-skills/stream${query}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRepairState(agentId, { repairing: false, msg: `❌ ${(data as { error?: string }).error ?? "请求失败"}` });
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setRepairState(agentId, { repairing: false, msg: "❌ 无法读取流" });
        return;
      }
      const decoder = new TextDecoder();
      let buf = "";
      let ok = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as { t?: string; m?: string; ok?: boolean; error?: string };
            if (obj.t === "log" && obj.m != null) {
              appendRepairLog(agentId, obj.m);
            } else if (obj.t === "done") {
              ok = obj.ok === true;
              const msg = ok ? "✅ 修复完成" : `❌ ${obj.error ?? "修复失败"}`;
              setRepairState(agentId, { repairing: false, msg });
            }
          } catch {
            appendRepairLog(agentId, line);
          }
        }
      }
      if (buf.trim()) {
        try {
          const obj = JSON.parse(buf) as { t?: string; ok?: boolean; error?: string };
          if (obj.t === "done") {
            ok = obj.ok === true;
            setRepairState(agentId, { repairing: false, msg: ok ? "✅ 修复完成" : `❌ ${obj.error ?? "修复失败"}` });
          }
        } catch {
          appendRepairLog(agentId, buf);
        }
      }
      if (ok) {
        setSkillContent({});
        const sRes = await fetch(`/agents/${agentId}/skills`);
        const skillsRaw = (await sRes.json()) as unknown[];
        onSkillsChange(
          Array.isArray(skillsRaw)
            ? skillsRaw.map((s: unknown) =>
                typeof s === "string" ? { name: s, status: "confirmed" } : s as Skill
              )
            : []
        );
      }
    } catch {
      setRepairState(agentId, { repairing: false, msg: "❌ 请求失败" });
    } finally {
      setRepairState(agentId, { repairing: false });
    }
  };

  const handleExpand = async (skillName: string) => {
    if (expandedSkill === skillName) {
      setExpandedSkill(null);
      return;
    }
    setExpandedSkill(skillName);
    if (!skillContent[skillName]) {
      setSkillContentLoading(skillName);
      try {
        const res = await fetch(`/agents/${agentId}/skills/${skillName}/content`);
        if (res.ok) {
          const data = await res.json();
          setSkillContent((prev) => ({ ...prev, [skillName]: data }));
        }
      } catch { /* ignore */ } finally {
        setSkillContentLoading(null);
      }
    }
  };

  const handleConfirm = async (skillName: string) => {
    const res = await adminFetch(`/agents/${agentId}/skills/${skillName}/confirm`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      onSkillsChange(
        skills.map((sk) => sk.name === skillName ? { ...sk, status: "confirmed" } : sk)
      );
    }
  };

  const handleReject = async (skillName: string) => {
    const res = await adminFetch(`/agents/${agentId}/skills/${skillName}/reject`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      const newSkills = skills.filter((sk) => sk.name !== skillName);
      onSkillsChange(newSkills);
      if (expandedSkill === skillName) setExpandedSkill(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
        <span className="text-[11px] text-slate-500">
          <span className="text-sky-400/90">内置</span>
          <span className="text-slate-500 mx-1">+</span>
          <span className="text-amber-400/90">进化</span>
          技能
        </span>
        <div className="flex items-center gap-1.5">
          {skills.length > 0 && (
            <>
              <button
                type="button"
                onClick={selectAllForRepair}
                className="text-[10px] text-slate-500 hover:text-slate-400"
              >
                全选
              </button>
              <button
                type="button"
                onClick={clearRepairSelected}
                className="text-[10px] text-slate-500 hover:text-slate-400"
              >
                取消
              </button>
            </>
          )}
          <button
            onClick={handleRepair}
            disabled={repairing}
            className="px-2 py-1 text-[10px] font-medium rounded bg-sky-600/20 text-sky-400 border border-sky-600/30 hover:bg-sky-600/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={repairSelected.size > 0 ? `仅修复选中的 ${repairSelected.size} 个技能` : "测试每个技能，失败时由 LLM 修复（全部）"}
          >
            {repairing ? "修复中…" : repairSelected.size > 0 ? `🔧 修复选中 (${repairSelected.size})` : "🔧 修复全部失败技能"}
          </button>
        </div>
      </div>

      {(repairing || repairLog.length > 0 || repairMsg) && (
        <div className="rounded bg-slate-800/50 border border-slate-600/40 overflow-hidden">
          {repairLog.length > 0 && (
            <pre className="text-[10px] text-slate-300 px-2 py-1.5 max-h-32 overflow-y-auto font-mono whitespace-pre-wrap break-words">
              {repairLog.join("\n")}
            </pre>
          )}
          {repairMsg && (
            <p className="text-[11px] px-2 py-1 text-slate-200 font-medium border-t border-slate-600/40">
              {repairMsg}
            </p>
          )}
          {repairing && repairLog.length === 0 && !repairMsg && (
            <p className="text-[11px] px-2 py-1 text-slate-400">正在启动 skilllite，请稍候…</p>
          )}
        </div>
      )}

      {skills.length === 0 ? (
        <p className="text-sm text-slate-500 py-4 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-600/50">
          暂无进化技能
        </p>
      ) : (
        skills.map((s) => {
          const isExpanded = expandedSkill === s.name;
          const content = skillContent[s.name];
          const isLoadingThis = skillContentLoading === s.name;

          return (
            <div
              key={s.name}
              className={`rounded-xl border text-xs transition-all ${
                s.status === "pending"
                  ? "bg-gradient-to-b from-amber-950/20 to-slate-800/50 border-amber-700/40"
                  : "bg-slate-800/40 border-slate-700/40"
              }`}
            >
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:opacity-80 transition-opacity">
                    <input
                      type="checkbox"
                      checked={repairSelected.has(s.name)}
                      onChange={() => toggleRepairSelected(s.name)}
                      onClick={(e) => e.stopPropagation()}
                      title="修复时包含此技能"
                      className="rounded border-slate-600 bg-slate-800 text-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleExpand(s.name)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      <span className="text-slate-500 text-[10px] shrink-0">{isExpanded ? "▼" : "▶"}</span>
                      <span className="font-mono text-slate-200 font-medium truncate">{s.name}</span>
                      {/* 来源：内置 vs 进化 */}
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          s.status === "installed"
                            ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                            : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        }`}
                        title={s.status === "installed" ? "预装于 .skills 根目录" : "由进化产生于 .skills/_evolved"}
                      >
                        {s.status === "installed" ? "内置" : "进化"}
                      </span>
                      {/* 状态：待确认 / 已启用（仅进化有「待确认」） */}
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          s.status === "pending"
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : s.status === "installed"
                            ? "bg-slate-600/30 text-slate-400 border border-slate-500/40"
                            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        }`}
                      >
                        {s.status === "pending" ? "待确认" : s.status === "installed" ? "—" : "已启用"}
                      </span>
                    </button>
                  </label>
                  {s.status === "pending" && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleConfirm(s.name)}
                        className="px-2 py-1 rounded text-[10px] font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/40 transition-colors"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => handleReject(s.name)}
                        className="px-2 py-1 rounded text-[10px] font-medium bg-rose-600/20 text-rose-400 border border-rose-600/30 hover:bg-rose-600/40 transition-colors"
                      >
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
                {s.description && (
                  <p className="text-slate-400 text-[11px] leading-relaxed">{s.description}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  {s.created_at && (
                    <span>创建: {new Date(s.created_at).toLocaleString("zh-CN")}</span>
                  )}
                  {s.call_count != null && s.status === "confirmed" && (
                    <span>调用 {s.call_count} 次</span>
                  )}
                  {s.success_count != null && s.status === "confirmed" && s.call_count != null && s.call_count > 0 && (
                    <span>成功 {s.success_count} 次</span>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-slate-700/50 px-3 pb-3 pt-2 space-y-3">
                  {isLoadingThis ? (
                    <p className="text-[11px] text-slate-500 py-2 text-center">加载中…</p>
                  ) : !content ? (
                    <p className="text-[11px] text-slate-500 py-2 text-center">内容不可用</p>
                  ) : (
                    <>
                      {content.skill_md && (
                        <div>
                          <p className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wide">SKILL.md</p>
                          <pre className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-2.5 text-[10px] text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{content.skill_md}</pre>
                        </div>
                      )}
                      {content.scripts.map((sc) => (
                        <div key={sc.filename}>
                          <p className="text-[10px] text-slate-500 mb-1 font-medium">
                            <span className="font-mono text-sky-400">scripts/{sc.filename}</span>
                          </p>
                          <pre className="bg-slate-900/80 border border-slate-700/40 rounded-lg p-2.5 text-[10px] text-emerald-300/90 leading-relaxed overflow-x-auto whitespace-pre max-h-64 overflow-y-auto font-mono">{sc.content}</pre>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
