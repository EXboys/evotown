import { useState, type ReactNode } from "react";

import { EmployeeConfigPanel } from "./market/EmployeeConfigPanel";
import { GatewayModelRoutesPanel } from "./GatewayModelRoutesPanel";
import { GatewayUpstreamModelsPanel } from "./GatewayUpstreamModelsPanel";

type GatewayConversation = {
  conversation_id: string;
  last_seen_at?: string;
  requests?: number;
  cost_usd?: number;
  agent_id?: string;
  model?: string;
};

export type GatewayConsoleData = {
  gateway: {
    total?: Record<string, number>;
    by_model?: Array<Record<string, string | number>>;
    by_agent?: Array<Record<string, string | number>>;
    by_account?: Array<Record<string, string | number>>;
  } | null;
  conversations: GatewayConversation[];
  gatewayKeys: unknown[];
};

type GatewayTab = "config" | "connect" | "observe";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{note}</div>
    </div>
  );
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function SimpleUsageTable({
  rows,
  nameKey,
  empty,
}: {
  rows: Array<Record<string, string | number>>;
  nameKey: string;
  empty: string;
}) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="w-20 px-3 py-2 font-semibold">Req</th>
            <th className="w-20 px-3 py-2 font-semibold">Cost</th>
            <th className="w-20 px-3 py-2 font-semibold">Tok</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={String(row[nameKey])}>
              <td className="truncate px-3 py-2 font-mono text-xs font-semibold text-slate-950">{row[nameKey] || "-"}</td>
              <td className="px-3 py-2 text-slate-600">{row.requests || 0}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">${asNumber(row.cost_usd).toFixed(4)}</td>
              <td className="px-3 py-2 text-slate-600">{row.total_tokens || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConversationTable({ conversations }: { conversations: GatewayConversation[] }) {
  if (!conversations.length) return <EmptyState>暂无会话记录。</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Conversation</th>
            <th className="w-28 px-3 py-2 font-semibold">Agent</th>
            <th className="w-24 px-3 py-2 font-semibold">Model</th>
            <th className="w-16 px-3 py-2 font-semibold">Req</th>
            <th className="w-20 px-3 py-2 font-semibold">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {conversations.map((c) => (
            <tr key={c.conversation_id}>
              <td className="truncate px-3 py-2 font-mono text-xs text-slate-950">{c.conversation_id}</td>
              <td className="truncate px-3 py-2 font-mono text-xs text-slate-600">{c.agent_id || "—"}</td>
              <td className="truncate px-3 py-2 font-mono text-xs text-slate-600">{c.model || "—"}</td>
              <td className="px-3 py-2 text-slate-600">{c.requests ?? 0}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">${asNumber(c.cost_usd).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS: { id: GatewayTab; label: string; desc: string }[] = [
  { id: "config", label: "模型配置", desc: "上游模型与别名" },
  { id: "connect", label: "员工接入", desc: "两行配置" },
  { id: "observe", label: "用量审计", desc: "统计与会话" },
];

export function GatewayConsole({ data }: { data: GatewayConsoleData }) {
  const [tab, setTab] = useState<GatewayTab>("config");
  const total = data.gateway?.total || {};
  const byModel = data.gateway?.by_model || [];
  const byAgent = data.gateway?.by_agent || [];
  const byAccount = data.gateway?.by_account || [];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="请求" value={total.total_requests || 0} note="网关调用" />
        <StatCard label="成本" value={`$${asNumber(total.total_cost_usd).toFixed(4)}`} note="累计" />
        <StatCard label="Token" value={total.total_tokens || 0} note="prompt + completion" />
        <StatCard label="延迟" value={total.avg_latency_ms ? `${Math.round(total.avg_latency_ms)}ms` : "—"} note="平均" />
      </section>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.id
                ? "border border-b-white border-slate-200 bg-white text-slate-950 -mb-px"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {item.label}
            <span className="ml-2 hidden text-xs font-normal text-slate-400 sm:inline">{item.desc}</span>
          </button>
        ))}
      </div>

      {tab === "config" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="p-4">
            <SectionHeader title="上游模型" subtitle="厂商 endpoint 与 API Key" />
            <GatewayUpstreamModelsPanel />
          </Card>
          <Card className="p-4">
            <SectionHeader title="别名路由" subtitle="客户端 model 名 → 上游 model_name" />
            <GatewayModelRoutesPanel />
          </Card>
        </div>
      )}

      {tab === "connect" && (
        <Card className="p-5">
          <SectionHeader
            title="员工接入"
            subtitle={`将 OpenAI 兼容 endpoint 指向 Evotown；已配置 Key：${data.gatewayKeys.length} 个`}
          />
          <EmployeeConfigPanel compact className="border-slate-200 bg-slate-50/50" />
          <p className="mt-4 text-xs text-slate-500">
            Evotown 负责身份、审计与配额；可选 LiteLLM 负责多厂商 fallback。账号与 Key 管理见「账号」页。
          </p>
        </Card>
      )}

      {tab === "observe" && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="p-4">
              <SectionHeader title="按模型" subtitle="用量 Top" />
              <SimpleUsageTable rows={byModel} nameKey="model" empty="暂无数据" />
            </Card>
            <Card className="p-4">
              <SectionHeader title="按 Agent" subtitle="用量 Top" />
              <SimpleUsageTable rows={byAgent} nameKey="agent_id" empty="暂无数据" />
            </Card>
            <Card className="p-4">
              <SectionHeader title="按账号" subtitle="用量 Top" />
              <SimpleUsageTable rows={byAccount} nameKey="account_id" empty="暂无数据" />
            </Card>
          </div>
          <Card className="p-4">
            <SectionHeader title="会话" subtitle="最近对话流" />
            <ConversationTable conversations={data.conversations} />
          </Card>
        </div>
      )}
    </div>
  );
}
