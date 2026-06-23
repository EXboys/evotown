import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type AgentTemplate = {
  template_id: string; name: string; description: string; category: "department" | "personal";
  soul: string; paradigm: string; standards: string;
  default_model: string; default_skills: string[];
  has_agent_dir: boolean; agent_dir_root: string; agent_dir_prefix: string;
  builtin?: boolean; seed_version?: string;
  agent_count?: number;
};

type AgentRecord = { agent_id: string; name: string; status: string; category: string; created_at: string };

type TemplatesTab = "department" | "personal";

const COPY = {
  zh: {
    title: "智能体模板",
    subtitle: "部门模板可自定义创建编辑；专属模板为系统预设，不可修改。",
    refresh: "刷新",
    newTemplate: "新建模板",
    department: "部门模板",
    personal: "专属模板",
    preset: "系统预设",
    edit: "编辑",
    delete: "删除",
    save: "保存",
    cancel: "取消",
    noTemplates: "暂无模板，点击「新建模板」创建。",
    name: "模板名称",
    description: "描述",
    soul: "身份 (soul)",
    soulPlaceholder: "你是谁、沟通风格、边界",
    paradigm: "工作范式 (paradigm)",
    paradigmPlaceholder: "1. 理解需求 → 2. 列计划 → ...",
    standards: "工作标准 (standards)",
    standardsPlaceholder: "代码规范、输出格式、Review 清单",
    defaultModel: "默认模型",
    defaultSkills: "默认 Skills",
    addSkill: "＋ 添加 Skill",
    workspaceDir: "工作目录 (可选)",
    initDir: "初始化工作目录",
    dirRoot: "目录位置",
    dirRootWorkspace: "{workspace}",
    dirRootServer: "{server}",
    dirRootShared: "{server} (共享)",
    dirPrefix: "路径前缀",
    skillsCount: "Skills: {n}个",
    dirLabel: "📂 {root}/{prefix}",
    createTitle: "新建部门模板",
    editTitle: "编辑模板",
    confirmDelete: "确定删除该模板？",
  },
  en: {
    title: "Agent Templates",
    subtitle: "Department templates can be created and edited; personal templates are system presets.",
    refresh: "Refresh",
    newTemplate: "New Template",
    department: "Department",
    personal: "Personal",
    preset: "System Preset",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    noTemplates: "No templates.",
    name: "Template Name",
    description: "Description",
    soul: "Identity (soul)",
    soulPlaceholder: "Who you are, tone, boundaries",
    paradigm: "Workflow (paradigm)",
    paradigmPlaceholder: "1. Understand → 2. Plan → ...",
    standards: "Standards",
    standardsPlaceholder: "Code style, output format, review checklist",
    defaultModel: "Default Model",
    defaultSkills: "Default Skills",
    addSkill: "+ Add Skill",
    workspaceDir: "Working Directory (optional)",
    initDir: "Initialize directory",
    dirRoot: "Location",
    dirRootWorkspace: "{workspace}",
    dirRootServer: "{server}",
    dirRootShared: "{server} (shared)",
    dirPrefix: "Path prefix",
    skillsCount: "Skills: {n}",
    dirLabel: "📂 {root}/{prefix}",
    createTitle: "New Department Template",
    editTitle: "Edit Template",
    confirmDelete: "Delete this template?",
  },
};

const EMPTY_FORM = {
  name: "", description: "", soul: "", paradigm: "", standards: "",
  default_model: "", default_skills: [] as string[],
  has_agent_dir: false, agent_dir_root: "workspace" as "workspace" | "server",
  agent_dir_prefix: "",
};

export function AgentTemplatePanel({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<TemplatesTab>("department");
  const [editing, setEditing] = useState<AgentTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<AgentTemplate | null>(null);
  const [agentList, setAgentList] = useState<AgentRecord[]>([]);
  const [agentListOpen, setAgentListOpen] = useState(false);
  const [agentListTitle, setAgentListTitle] = useState("");
  const [syncTpl, setSyncTpl] = useState<AgentTemplate | null>(null);
  const [syncAgents, setSyncAgents] = useState<AgentRecord[]>([]);
  const [syncSelected, setSyncSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const filtered = templates.filter((t) => tab === "department" ? t.category === "department" : t.category === "personal");

  const loadTemplates = async () => {
    setLoading(true); setError("");
    try {
      const res = await adminFetch("/api/v1/agent-templates");
      const data = await res.json();
      setTemplates((data.templates || []) as AgentTemplate[]);
    } catch (err) { setError(err instanceof Error ? err.message : "加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadTemplates(); }, []);

  const openAgentList = async (tpl: AgentTemplate) => {
    try {
      const res = await adminFetch(`/api/v1/agent-templates/${encodeURIComponent(tpl.template_id)}/agents`);
      const data = await res.json();
      setAgentList((data.agents || []) as AgentRecord[]);
      setAgentListTitle(tpl.name);
      setAgentListOpen(true);
    } catch { /* ignore */ }
  };

  const openSync = async (tpl: AgentTemplate) => {
    setSyncTpl(tpl);
    setSyncSelected(new Set());
    try {
      const res = await adminFetch(`/api/v1/agent-templates/${encodeURIComponent(tpl.template_id)}/agents`);
      const data = await res.json();
      setSyncAgents((data.agents || []) as AgentRecord[]);
    } catch { setSyncAgents([]); }
  };

  const doSync = async () => {
    if (!syncTpl || syncSelected.size === 0) return;
    setSyncing(true);
    try {
      const res = await adminFetch(`/api/v1/agent-templates/${encodeURIComponent(syncTpl.template_id)}/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_ids: Array.from(syncSelected) }),
      });
      const data = await res.json();
      setMessage(`同步完成: ${data.synced?.length || 0} 成功, ${data.failed?.length || 0} 失败`);
      setSyncTpl(null);
    } catch (err) { setMessage(err instanceof Error ? err.message : "同步失败"); }
    finally { setSyncing(false); }
  };

  const toggleSyncAgent = (id: string) => {
    const next = new Set(syncSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSyncSelected(next);
  };

  const selectAllAgents = () => {
    if (syncSelected.size === syncAgents.length) setSyncSelected(new Set());
    else setSyncSelected(new Set(syncAgents.map(a => a.agent_id)));
  };

  const startEdit = (tpl?: AgentTemplate) => {
    if (tpl) {
      setEditing(tpl);
      setForm({ name: tpl.name, description: tpl.description, soul: tpl.soul, paradigm: tpl.paradigm, standards: tpl.standards, default_model: tpl.default_model, default_skills: [...tpl.default_skills], has_agent_dir: tpl.has_agent_dir, agent_dir_root: tpl.agent_dir_root as "workspace" | "server", agent_dir_prefix: tpl.agent_dir_prefix });
    } else {
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    }
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setMessage("");
    try {
      const body: Record<string, unknown> = { ...form, category: "department" };
      if (editing) {
        await adminFetch(`/api/v1/agent-templates/${encodeURIComponent(editing.template_id)}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await adminFetch("/api/v1/agent-templates", { method: "POST", body: JSON.stringify(body) });
      }
      setMessage("ok"); closeForm();
      void loadTemplates();
    } catch (err) { setMessage(err instanceof Error ? err.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const remove = async (tpl: AgentTemplate) => {
    if (!window.confirm(copy.confirmDelete)) return;
    try { await adminFetch(`/api/v1/agent-templates/${encodeURIComponent(tpl.template_id)}`, { method: "DELETE" }); void loadTemplates(); }
    catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
  };

  const addSkill = () => {
    const name = window.prompt("Skill ID:");
    if (!name?.trim()) return;
    if (form.default_skills.includes(name.trim())) return;
    setForm({ ...form, default_skills: [...form.default_skills, name.trim()] });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void loadTemplates()} disabled={loading} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">{copy.refresh}</button>
          <button onClick={() => startEdit()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">{copy.newTemplate}</button>
        </div>
      </div>

      {/* Message */}
      {message === "ok" && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">保存成功</div>}
      {message && message !== "ok" && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Tab switcher */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {(["department", "personal"] as TemplatesTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t === "department" ? copy.department : copy.personal}
          </button>
        ))}
      </div>

      {/* Templates list */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-100 bg-white" />)}</div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((tpl) => (
            <div key={tpl.template_id} className="rounded-xl border border-slate-200 bg-white p-5 cursor-pointer hover:border-slate-300 hover:shadow-sm transition" onClick={() => setViewing(tpl)}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{tpl.name}</span>
                    {tpl.category === "personal" && <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 uppercase">{copy.preset}</span>}
                  </div>
                  {tpl.description && <p className="text-xs text-slate-500">{tpl.description}</p>}
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                    {tpl.default_model && <span className="rounded-md border border-slate-100 bg-slate-50 px-1.5 py-0.5">Model: {tpl.default_model}</span>}
                    {tpl.default_skills.length > 0 && <span className="rounded-md border border-slate-100 bg-slate-50 px-1.5 py-0.5">{copy.skillsCount.replace("{n}", String(tpl.default_skills.length))}</span>}
                    {tpl.has_agent_dir && <span className="rounded-md border border-slate-100 bg-slate-50 px-1.5 py-0.5">{copy.dirLabel.replace("{root}", tpl.agent_dir_root === "server" ? "{server}" : tpl.agent_dir_root === "shared" ? "{server}" : tpl.agent_dir_root).replace("{prefix}", tpl.agent_dir_prefix)}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(tpl.agent_count ?? 0) > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); void openAgentList(tpl); }} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100">
                      {tpl.agent_count} 个智能体
                    </button>
                  )}
                  {(tpl.agent_count ?? 0) > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); void openSync(tpl); }} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">同步</button>
                  )}
                  {tpl.category === "department" && (
                    <>
                      <button onClick={() => startEdit(tpl)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">{copy.edit}</button>
                      <button onClick={() => void remove(tpl)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">{copy.delete}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-2xl">📋</div>
          <p className="mx-auto max-w-md text-sm text-slate-500">{copy.noTemplates}</p>
        </div>
      )}

      {/* Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 pt-12 backdrop-blur-sm" onClick={closeForm}>
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div><div className="text-base font-semibold text-slate-900">{editing ? copy.editTitle : copy.createTitle}</div><div className="text-xs text-slate-400">{copy.department}</div></div>
              <button onClick={closeForm} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{copy.cancel}</button>
            </div>
            <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-5">
              {/* Basic */}
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">{copy.name}</span><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="销售部 Agent" /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">{copy.description}</span><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="简短说明" /></label>

              {/* Identity */}
              <div className="border-t border-slate-100 pt-4"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{locale === "zh" ? "身份设定" : "Identity"}</span></div>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">{copy.soul}</span><textarea className="min-h-[80px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed" value={form.soul} onChange={(e) => setForm({ ...form, soul: e.target.value })} placeholder={copy.soulPlaceholder} /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">{copy.paradigm}</span><textarea className="min-h-[64px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed" value={form.paradigm} onChange={(e) => setForm({ ...form, paradigm: e.target.value })} placeholder={copy.paradigmPlaceholder} /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">{copy.standards}</span><textarea className="min-h-[64px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed" value={form.standards} onChange={(e) => setForm({ ...form, standards: e.target.value })} placeholder={copy.standardsPlaceholder} /></label>

              {/* Defaults */}
              <div className="border-t border-slate-100 pt-4"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{locale === "zh" ? "默认配置" : "Defaults"}</span></div>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">{copy.defaultModel}</span><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.default_model} onChange={(e) => setForm({ ...form, default_model: e.target.value })} placeholder="deepseek-v4-pro" /></label>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-700">{copy.defaultSkills} ({form.default_skills.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {form.default_skills.map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">{s}<button onClick={() => setForm({ ...form, default_skills: form.default_skills.filter((x) => x !== s) })} className="ml-0.5 text-slate-400 hover:text-red-500">×</button></span>)}
                </div>
                <button onClick={addSkill} className="mt-1.5 text-xs text-slate-500 hover:text-slate-700">{copy.addSkill}</button>
              </div>

              {/* Workspace dir */}
              <div className="border-t border-slate-100 pt-4"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.workspaceDir}</span></div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.has_agent_dir} onChange={(e) => setForm({ ...form, has_agent_dir: e.target.checked })} /><span className="text-sm text-slate-700">{copy.initDir}</span></label>
              {form.has_agent_dir && (
                <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-center gap-4">
                    <div className="text-xs text-slate-500">{copy.dirRoot}</div>
                    {(["workspace", "server"] as const).map((r) => <label key={r} className="flex items-center gap-1.5"><input type="radio" name="dirRoot" checked={form.agent_dir_root === r} onChange={() => setForm({ ...form, agent_dir_root: r })} /><span className="text-sm text-slate-700">{r === "workspace" ? copy.dirRootWorkspace : copy.dirRootServer}</span></label>)}
                  </div>
                  <label className="block"><span className="mb-1 block text-xs text-slate-500">{copy.dirPrefix}</span><input className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={form.agent_dir_prefix} onChange={(e) => setForm({ ...form, agent_dir_prefix: e.target.value })} placeholder="skills/" /></label>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-slate-100 px-6 py-4">
              <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="flex-1 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{saving ? "保存中…" : copy.save}</button>
              <button onClick={closeForm} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">{copy.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {/* View modal */}
      {viewing && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 pt-12 backdrop-blur-sm" onClick={() => setViewing(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <div className="text-base font-semibold text-slate-900">{viewing.name}</div>
                <div className="text-xs text-slate-400">{viewing.category === "personal" ? copy.personal : copy.department}{viewing.category === "personal" ? " · " + copy.preset : ""}</div>
              </div>
              <button onClick={() => setViewing(null)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{copy.cancel}</button>
            </div>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5 text-sm">
              {viewing.description && <p className="text-slate-500">{viewing.description}</p>}
              {viewing.soul && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.soul}</div><p className="whitespace-pre-wrap text-slate-700">{viewing.soul}</p></div>}
              {viewing.paradigm && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.paradigm}</div><p className="whitespace-pre-wrap text-slate-700">{viewing.paradigm}</p></div>}
              {viewing.standards && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.standards}</div><p className="whitespace-pre-wrap text-slate-700">{viewing.standards}</p></div>}
              {viewing.default_model && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.defaultModel}</div><p className="text-slate-700">{viewing.default_model}</p></div>}
              {viewing.default_skills.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.defaultSkills}</div><div className="flex flex-wrap gap-1.5">{viewing.default_skills.map(s => <span key={s} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{s}</span>)}</div></div>}
              {viewing.has_agent_dir && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{copy.workspaceDir}</div><p className="text-slate-700">{copy.dirLabel.replace("{root}", viewing.agent_dir_root === "server" ? "{server}" : viewing.agent_dir_root === "shared" ? "{server}" : viewing.agent_dir_root).replace("{prefix}", viewing.agent_dir_prefix)}</p></div>}
            </div>
            <div className="flex border-t border-slate-100 px-6 py-4">
              <button onClick={() => setViewing(null)} className="w-full rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">{locale === "zh" ? "关闭" : "Close"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Agent list modal */}
      {agentListOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" onClick={() => setAgentListOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">使用「{agentListTitle}」的智能体</h3>
              <button onClick={() => setAgentListOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {agentList.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">暂无绑定</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {agentList.map((a) => (
                  <div key={a.agent_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-slate-900">{a.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{a.agent_id}</p>
                    </div>
                    <span className="text-[10px] text-slate-400">{a.status === "active" ? "● 活动" : "○ 归档"}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setAgentListOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Sync modal */}
      {syncTpl && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" onClick={() => setSyncTpl(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">同步模板「{syncTpl.name}」</h3>
                <p className="text-xs text-slate-500 mt-0.5">将覆盖所选智能体的 soul / paradigm / standards</p>
              </div>
              <button onClick={() => setSyncTpl(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {syncAgents.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">该模板暂无绑定智能体</p>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={syncSelected.size === syncAgents.length} onChange={selectAllAgents} />
                    <span className="text-xs text-slate-600">全选 ({syncAgents.length} 个)</span>
                  </label>
                  <span className="text-[10px] text-slate-400">已选 {syncSelected.size}</span>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                  {syncAgents.map((a) => (
                    <label key={a.agent_id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={syncSelected.has(a.agent_id)} onChange={() => toggleSyncAgent(a.agent_id)} />
                      <span className="text-xs text-slate-900">{a.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{a.agent_id}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setSyncTpl(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={doSync} disabled={syncing || syncSelected.size === 0} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                {syncing ? "同步中…" : `同步 ${syncSelected.size} 个`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
