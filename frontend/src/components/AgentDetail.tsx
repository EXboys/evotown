/** Agent 详情抽屉 — 规则 / 技能 / 决策 / Soul */
import { useEffect, useState } from "react";
import { evotownEvents } from "../phaser/events";
import { useEvotownStore } from "../store/evotownStore";
import { adminFetch } from "../hooks/useAdminToken";
import { ShareCard } from "./ShareCard";
import { AgentHeader, TabBar } from "./agent/AgentHeader";
import { ExecutionTab } from "./agent/ExecutionTab";
import { DecisionList } from "./agent/DecisionList";
import { RuleTab, type Rule } from "./agent/RuleTab";
import { PromptTab } from "./agent/PromptTab";
import { SkillTab, type Skill } from "./agent/SkillTab";
import { EvolutionTab, type EvolutionLogItem } from "./agent/EvolutionTab";
import { SoulTab, type SoulData } from "./agent/SoulTab";

type TabType = "executions" | "decisions" | "rules" | "prompts" | "skills" | "evolution" | "soul";

interface PromptItem {
  name: string;
  filename: string;
  content: string;
  evolved: boolean;
  original_content?: string | null;
}

interface ExecutionLogItem {
  ts: string | number;
  task: string;
  status: "refused" | "executed";
  refusal_reason?: string;
  task_completed?: boolean;
  total_tools?: number;
  failed_tools?: number;
  elapsed_ms?: number;
}

export function AgentDetail({
  agentId,
  onClose,
  initialTab,
}: {
  agentId: string;
  onClose: () => void;
  initialTab?: TabType;
}) {
  const [tab, setTab] = useState<TabType>(initialTab ?? "executions");
  const [rules, setRules] = useState<Rule[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [decisions, setDecisions] = useState<{ id?: number; ts?: string; total_tools?: number; failed_tools?: number; replans?: number; elapsed_ms?: number; task_completed?: boolean; feedback?: string; evolved?: boolean; task_description?: string; tools_detail?: string; [k: string]: unknown }[]>([]);
  const [executionLog, setExecutionLog] = useState<ExecutionLogItem[]>([]);
  const [evolutionLog, setEvolutionLog] = useState<EvolutionLogItem[]>([]);
  const [metrics, setMetrics] = useState<{ daily: { date?: string; first_success_rate?: number; avg_replans?: number; user_correction_rate?: number; egl?: number }[]; egl_7d: number; egl_all_time: number } | null>(null);
  const [soul, setSoul] = useState<SoulData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [promptsLoading, setPromptsLoading] = useState(false);

  const removeAgent = useEvotownStore((s) => s.removeAgent);
  const agent = useEvotownStore((s) => s.agents.find((a) => a.id === agentId));

  const loadPrompts = async () => {
    setPromptsLoading(true);
    try {
      const res = await fetch(`/agents/${agentId}/prompts`);
      const safeJson = async (r: Response, fb: unknown = []) => {
        try { return r.ok ? (await r.json()) ?? fb : fb; } catch { return fb; }
      };
      const raw = (await safeJson(res, [])) as PromptItem[];
      setPrompts(Array.isArray(raw) ? raw : []);
    } catch { /* ignore */ } finally {
      setPromptsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) setLoading(true);
      try {
        const [rRes, sRes, dRes, exeRes, soulRes, evoRes, metricsRes] = await Promise.all([
          fetch(`/agents/${agentId}/rules`),
          fetch(`/agents/${agentId}/skills`),
          fetch(`/agents/${agentId}/decisions?limit=50`),
          fetch(`/agents/${agentId}/execution_log?limit=30`),
          fetch(`/agents/${agentId}/soul`),
          fetch(`/agents/${agentId}/evolution_log?limit=100`),
          fetch(`/agents/${agentId}/metrics?limit=7`),
        ]);
        if (cancelled) return;

        const safeJson = async (res: Response, fallback: unknown = []) => {
          try { return res.ok ? (await res.json()) ?? fallback : fallback; }
          catch { return fallback; }
        };

        const rawRules = (await safeJson(rRes, [])) as Rule[];
        setRules([...rawRules].sort((a, b) => {
          const aEvolved = a.origin === "evolved" ? 0 : 1;
          const bEvolved = b.origin === "evolved" ? 0 : 1;
          return aEvolved - bEvolved;
        }));

        const skillsRaw = (await safeJson(sRes, [])) as unknown[];
        setSkills(
          Array.isArray(skillsRaw)
            ? skillsRaw.map((s: unknown) =>
                typeof s === "string" ? { name: s, status: "confirmed" } : s as Skill
              )
            : []
        );

        const decisionsData = (await safeJson(dRes, [])) as typeof decisions;
        setDecisions(decisionsData);

        if (exeRes.ok) {
          setExecutionLog((await safeJson(exeRes, [])) as ExecutionLogItem[]);
        } else {
          setExecutionLog(
            decisionsData.slice(0, 30).map((d) => ({
              ts: d.ts ?? "",
              task: d.task_description ?? "-",
              status: "executed" as const,
              task_completed: d.task_completed,
              total_tools: d.total_tools,
              failed_tools: d.failed_tools,
              elapsed_ms: d.elapsed_ms,
            }))
          );
        }

        const evoRaw = (await safeJson(evoRes, [])) as Record<string, unknown>[];
        setEvolutionLog(
          Array.isArray(evoRaw)
            ? evoRaw.map((r) => ({
                ts: String(r.ts ?? r.timestamp ?? ""),
                type: String(r.type ?? r.event_type ?? ""),
                target_id: String(r.target_id ?? r.id ?? ""),
                reason: String(r.reason ?? ""),
              }))
            : []
        );

        const soulData = await safeJson(soulRes, null);
        if (soulData && typeof soulData === "object" && "content" in (soulData as Record<string, unknown>)) {
          setSoul(soulData as SoulData);
        } else {
          setSoul(null);
        }

        const metricsData = await safeJson(metricsRes, null);
        if (metricsData && typeof metricsData === "object" && "daily" in (metricsData as Record<string, unknown>)) {
          const m = metricsData as { daily?: unknown[]; egl_7d?: number; egl_all_time?: number };
          const dailyRows = Array.isArray(m.daily) ? m.daily : [];
          setMetrics({
            daily: dailyRows as { date?: string; first_success_rate?: number; avg_replans?: number; user_correction_rate?: number; egl?: number }[],
            egl_7d: typeof m.egl_7d === "number" ? m.egl_7d : 0,
            egl_all_time: typeof m.egl_all_time === "number" ? m.egl_all_time : 0,
          });
        } else if (Array.isArray(metricsData)) {
          setMetrics({
            daily: metricsData as { date?: string; first_success_rate?: number; avg_replans?: number; user_correction_rate?: number; egl?: number }[],
            egl_7d: 0,
            egl_all_time: 0,
          });
        } else {
          setMetrics(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn(`[evotown] AgentDetail load failed for ${agentId}`, err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    loadPrompts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [agentId, initialTab]);

  const handleDelete = async () => {
    const displayName = agent?.display_name || agentId;
    if (!window.confirm(`确定要删除 Agent「${displayName}」吗？删除后可从竞技场重新创建。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        removeAgent(agentId);
        evotownEvents.emit("agent_eliminated", { agent_id: agentId, reason: "user_deleted" });
        evotownEvents.emit("request_sync", {});
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? "删除失败");
      }
    } catch (err) {
      console.warn("[evotown] delete agent failed", err);
      alert("删除失败，请检查网络");
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateBalance = async (newBalance: number) => {
    try {
      const res = await adminFetch(`/agents/${agentId}/balance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: newBalance }),
      });
      // adminFetch 内部已处理 403 错误并弹窗，此处不再重复提示
      if (res.ok) {
        setAgent((prev) => prev ? { ...prev, balance: newBalance } : prev);
        evotownEvents.emit("request_sync", {});
      }
    } catch (err) {
      console.error("更新军功失败:", err);
      alert("修改军功失败");
    }
  };

  const renderTabContent = () => {
    if (loading) {
      return <p className="text-sm text-slate-500">加载中...</p>;
    }

    switch (tab) {
      case "executions":
        return <ExecutionTab logs={executionLog} />;
      case "rules":
        return <RuleTab rules={rules} />;
      case "prompts":
        return <PromptTab prompts={prompts} onRefresh={loadPrompts} loading={promptsLoading} />;
      case "skills":
        return <SkillTab agentId={agentId} skills={skills} onSkillsChange={setSkills} />;
      case "evolution":
        return <EvolutionTab evolutionLog={evolutionLog} metrics={metrics} />;
      case "soul":
        return <SoulTab agentId={agentId} soul={soul} onSoulChange={setSoul} />;
      case "decisions":
        return <DecisionList decisions={decisions} />;
      default:
        return null;
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-slate-900/95 backdrop-blur-sm border-l border-slate-600/50 min-w-0 overflow-hidden">
      <AgentHeader
        agentId={agentId}
        agent={agent}
        onDelete={handleDelete}
        deleting={deleting}
        onShowShare={() => setShowShare(true)}
        onUpdateBalance={handleUpdateBalance}
        onClose={onClose}
      />
      <TabBar currentTab={tab} onTabChange={setTab} />
      <div className="flex-1 overflow-y-auto p-3">
        {renderTabContent()}
      </div>

      {showShare && (() => {
        const latestEpiphany =
          [...evolutionLog]
            .reverse()
            .find((e) => e.reason && e.reason.length > 5)?.reason ?? "";
        return (
          <ShareCard
            agentId={agentId}
            agentName={agent?.display_name ?? agentId}
            balance={agent?.balance ?? 0}
            taskCount={agent?.task_count ?? 0}
            successCount={agent?.success_count ?? 0}
            rulesCount={rules.length}
            skillsCount={skills.length}
            evolutionCount={agent?.evolution_count ?? evolutionLog.length}
            latestEpiphany={latestEpiphany}
            onClose={() => setShowShare(false)}
          />
        );
      })()}
    </div>
  );
}
