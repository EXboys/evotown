import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import {
  AGENT_TYPE_OPTIONS,
  AGENT_TYPE_TEMPLATES,
  buildProfileFromPreset,
  presetLabelForType,
  profileNeedsPresetFill,
} from "../lib/agentPresets";

export type AgentAgentProfile = {
  agent_type: string;
  runtime_engine: "claude" | "codex";
  soul: string;
  paradigm: string;
  standards: string;
  default_model: string;
  default_skills: string[];
  default_mcp: string[];
  updated_at?: string | null;
};

type ModelOption = { id: string; label: string; provider?: string };
type SkillOption = { id: string; name: string; summary?: string };
type McpOption = { id: string; name: string; db_type?: string };

type Props = {
  agentId: string;
  models: ModelOption[];
  skills: SkillOption[];
  mcp: McpOption[];
  defaultModel: string;
  onSaved?: (profile: AgentAgentProfile) => void;
};

const EMPTY_PROFILE: AgentAgentProfile = {
  agent_type: "",
  runtime_engine: "claude",
  soul: "",
  paradigm: "",
  standards: "",
  default_model: "",
  default_skills: [],
  default_mcp: [],
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (parsed.detail) detail = parsed.detail;
    } catch {
      /* keep raw */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function mergePresetIntoProfile(
  prev: AgentAgentProfile,
  typeId: string,
  skillIds: Set<string>,
): AgentAgentProfile {
  if (!typeId) {
    return {
      ...prev,
      agent_type: "",
      soul: "",
      paradigm: "",
      standards: "",
    };
  }
  const built = buildProfileFromPreset(typeId, skillIds);
  if (!built) {
    return { ...prev, agent_type: typeId };
  }
  return {
    ...prev,
    agent_type: typeId,
    soul: built.soul,
    paradigm: built.paradigm,
    standards: built.standards,
    default_skills: built.default_skills.length ? built.default_skills : prev.default_skills,
  };
}

export function AgentAgentProfilePanel({
  agentId,
  models,
  skills,
  mcp,
  defaultModel,
  onSaved,
}: Props) {
  const [profile, setProfile] = useState<AgentAgentProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [templateHint, setTemplateHint] = useState("");

  const skillIdSet = useMemo(() => new Set(skills.map((item) => item.id)), [skills]);

  const applyTypePreset = useCallback(
    (typeId: string, prev: AgentAgentProfile) => {
      const next = mergePresetIntoProfile(prev, typeId, skillIdSet);
      if (!typeId) {
        setTemplateHint("已切换为自定义，身份 / 范式 / 标准已清空");
      } else if (AGENT_TYPE_TEMPLATES[typeId]) {
        setTemplateHint(`已填入「${presetLabelForType(typeId)}」模板，可按需修改后保存`);
      } else {
        setTemplateHint("");
      }
      return next;
    },
    [skillIdSet],
  );

  const loadProfile = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/profile`).then((res) =>
        readJson<{ profile?: AgentAgentProfile }>(res),
      );
      let next = { ...EMPTY_PROFILE, ...(data.profile || {}) };
      next.runtime_engine = next.runtime_engine === "codex" ? "codex" : "claude";
      if (profileNeedsPresetFill(next)) {
        next = mergePresetIntoProfile(next, next.agent_type, skillIdSet);
        setTemplateHint(`已自动补全「${presetLabelForType(next.agent_type)}」模板内容`);
        setDirty(true);
      } else {
        setTemplateHint("");
        setDirty(false);
      }
      setProfile(next);
      setMessage(null);
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "加载配置失败" });
    } finally {
      setLoading(false);
    }
  }, [agentId, skillIdSet]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const toggleSkill = (id: string) => {
    setProfile((prev) => {
      const has = prev.default_skills.includes(id);
      return {
        ...prev,
        default_skills: has ? prev.default_skills.filter((item) => item !== id) : [...prev.default_skills, id],
      };
    });
    setDirty(true);
  };

  const toggleMcp = (id: string) => {
    setProfile((prev) => {
      const has = prev.default_mcp.includes(id);
      return {
        ...prev,
        default_mcp: has ? prev.default_mcp.filter((item) => item !== id) : [...prev.default_mcp, id],
      };
    });
    setDirty(true);
  };

  const save = async () => {
    if (!agentId) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await adminFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/profile`, {
        method: "PUT",
        body: JSON.stringify(profile),
      }).then((res) => readJson<{ profile: AgentAgentProfile }>(res));
      setProfile(data.profile);
      setDirty(false);
      setTemplateHint("");
      setMessage({ tone: "ok", text: "Agent 配置已保存，下次运行自动生效" });
      onSaved?.(data.profile);
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const presetLabel = presetLabelForType(profile.agent_type);
  const hasPresetTemplate = Boolean(profile.agent_type && AGENT_TYPE_TEMPLATES[profile.agent_type]);

  if (loading) {
    return <div className="text-xs text-slate-400">加载 Agent 配置…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Agent 配置</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          选择类型会自动填入预设的身份、范式与标准；保存后每次 Run 与派活任务都会注入。
        </p>
        {profile.updated_at ? (
          <p className="mt-1 text-[11px] text-slate-400">上次保存：{profile.updated_at.replace("T", " ").replace("+00:00", " UTC")}</p>
        ) : null}
      </div>

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {templateHint ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
          {templateHint}
        </div>
      ) : null}

      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">Agent 类型</span>
        <div className="flex gap-2">
          <select
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            value={AGENT_TYPE_OPTIONS.some((item) => item.id === profile.agent_type) ? profile.agent_type : ""}
            onChange={(e) => {
              const typeId = e.target.value;
              setProfile((prev) => applyTypePreset(typeId, prev));
              setDirty(true);
            }}
          >
            {AGENT_TYPE_OPTIONS.map((item) => (
              <option key={item.id || "custom"} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {hasPresetTemplate ? (
            <button
              type="button"
              title="重新填入该类型的默认模板（会覆盖下方三栏文字）"
              onClick={() => {
                setProfile((prev) => applyTypePreset(prev.agent_type, prev));
                setDirty(true);
              }}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              重置模板
            </button>
          ) : null}
        </div>
        {!AGENT_TYPE_OPTIONS.some((item) => item.id === profile.agent_type) && profile.agent_type ? (
          <input
            className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
            placeholder="自定义类型标识"
            value={profile.agent_type}
            onChange={(e) => {
              setProfile((prev) => ({ ...prev, agent_type: e.target.value }));
              setTemplateHint("");
              setDirty(true);
            }}
          />
        ) : null}
        <span className="mt-1 block text-[11px] text-slate-400">当前：{presetLabel}</span>
      </label>

      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">身份 / SOUL</span>
        <textarea
          className="min-h-[88px] w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-sm leading-relaxed"
          placeholder="你是谁、沟通风格、边界（Will do / Will not do）…"
          value={profile.soul}
          onChange={(e) => {
            setProfile((prev) => ({ ...prev, soul: e.target.value }));
            setTemplateHint("");
            setDirty(true);
          }}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">工作范式</span>
        <textarea
          className="min-h-[72px] w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-sm leading-relaxed"
          placeholder="默认流程，如：先理解需求 → 列计划 → 执行 → 自测 → 总结"
          value={profile.paradigm}
          onChange={(e) => {
            setProfile((prev) => ({ ...prev, paradigm: e.target.value }));
            setTemplateHint("");
            setDirty(true);
          }}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">工作标准</span>
        <textarea
          className="min-h-[72px] w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-sm leading-relaxed"
          placeholder="代码规范、输出格式、测试要求、Review 清单…"
          value={profile.standards}
          onChange={(e) => {
            setProfile((prev) => ({ ...prev, standards: e.target.value }));
            setTemplateHint("");
            setDirty(true);
          }}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">Runtime 引擎</span>
        <select
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
          value={profile.runtime_engine}
          onChange={(e) => {
            const runtime_engine = e.target.value === "codex" ? "codex" : "claude";
            setProfile((prev) => ({ ...prev, runtime_engine }));
            setDirty(true);
          }}
        >
          <option value="claude">Claude Agent SDK</option>
          <option value="codex">Codex SDK</option>
        </select>
        <span className="mt-1 block text-[11px] text-slate-400">
          每个智能体可独立选择执行引擎；切换后下次运行生效。
        </span>
      </label>

      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">默认模型</span>
        <select
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
          value={profile.default_model}
          onChange={(e) => {
            setProfile((prev) => ({ ...prev, default_model: e.target.value }));
            setDirty(true);
          }}
        >
          <option value="">跟随工作台当前选择（{defaultModel || "Gateway 默认"}）</option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div className="text-xs">
        <div className="mb-1.5 font-medium text-slate-700">默认 Skills</div>
        {skills.length ? (
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {skills.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={profile.default_skills.includes(item.id)}
                  onChange={() => toggleSkill(item.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-800">{item.name}</span>
                  {item.summary ? <span className="block text-[11px] text-slate-400">{item.summary}</span> : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-slate-400">暂无可用 Skills</p>
        )}
      </div>

      <div className="text-xs">
        <div className="mb-1.5 font-medium text-slate-700">默认 MCP</div>
        {mcp.length ? (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {mcp.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={profile.default_mcp.includes(item.id)}
                  onChange={() => toggleMcp(item.id)}
                />
                <span className="text-sm text-slate-800">
                  {item.name}
                  {item.db_type ? <span className="text-slate-400"> · {item.db_type}</span> : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-slate-400">暂无 MCP 连接器</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="flex-1 rounded-lg bg-slate-950 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "保存中…" : dirty ? "保存配置" : "已保存"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void loadProfile()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          放弃修改
        </button>
      </div>
    </div>
  );
}
