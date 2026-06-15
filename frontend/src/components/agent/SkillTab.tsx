import { useState } from "react";
import { formatDateTimeShort } from "../../lib/datetime";

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

export function SkillTab({ agentId, skills, onSkillsChange: _onSkillsChange }: SkillTabProps) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState<Record<string, SkillContent>>({});
  const [skillContentLoading, setSkillContentLoading] = useState<string | null>(null);

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-500">
          <span className="text-sky-400/90">内置</span>
          <span className="text-slate-500 mx-1">+</span>
          <span className="text-amber-400/90">进化</span>
          技能
        </span>
      </div>

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
                  <button
                    type="button"
                    onClick={() => handleExpand(s.name)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <span className="text-slate-500 text-[10px] shrink-0">{isExpanded ? "▼" : "▶"}</span>
                    <span className="font-mono text-slate-200 font-medium truncate">{s.name}</span>
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
                </div>
                {s.description && (
                  <p className="text-slate-400 text-[11px] leading-relaxed">{s.description}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  {s.created_at && (
                    <span>创建: {formatDateTimeShort(s.created_at)}</span>
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
