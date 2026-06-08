import { useState, useMemo, type ReactNode } from "react";

import { GatewayAdvancedPanel } from "./gateway/GatewayAdvancedPanel";
import { GatewayPlaygroundPanel } from "./gateway/GatewayPlaygroundPanel";
import { EmployeeConfigPanel } from "./market/EmployeeConfigPanel";
import { GatewayModelRoutesPanel } from "./GatewayModelRoutesPanel";
import { GatewayUpstreamModelsPanel } from "./GatewayUpstreamModelsPanel";
import { formatDateTimeShort } from "../lib/datetime";

type GatewayConversation = {
  conversation_id: string;
  last_seen_at?: string;
  requests?: number;
  cost_usd?: number;
  agent_id?: string;
  account_id?: string;
  account_name?: string;
  user_message?: string;
  model?: string;
  model_alias?: string;
};

export type GatewayRequest = {
  request_id: string;
  conversation_id?: string;
  api_key_label?: string;
  agent_id?: string;
  account_id?: string;
  account_name?: string;
  team_id?: string;
  engine_id?: string;
  model?: string;
  model_alias?: string;
  status_code?: number;
  cost_usd?: number;
  total_tokens?: number;
  latency_ms?: number;
  risk_status?: string;
  created_at?: string;
  error?: string;
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
  gatewayRequests: GatewayRequest[];
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

/**
 * Reusable pagination control. Matches the existing Tailwind style.
 */
function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  // Build page number buttons with ellipsis
  const pages: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("ellipsis");
    const lo = Math.max(2, page - 1);
    const hi = Math.min(totalPages - 1, page + 1);
    for (let i = lo; i <= hi; i++) pages.push(i);
    if (page < totalPages - 2) pages.push("ellipsis");
    pages.push(totalPages);
  }

  const btnBase =
    "inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-3 py-2">
      <span className="text-xs text-slate-500">
        第 {start}-{end} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`${btnBase} text-slate-600 hover:bg-slate-200`}
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          ‹ 上一页
        </button>
        {pages.map((p, idx) =>
          p === "ellipsis" ? (
            <span key={`e${idx}`} className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`${btnBase} ${
                p === page
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-200"
              }`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className={`${btnBase} text-slate-600 hover:bg-slate-200`}
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页 ›
        </button>
      </div>
    </div>
  );
}

/**
 * Hook: slice an array into the current page and compute pagination metadata.
 */
function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // Clamp page when data shrinks
  const safePage = Math.min(page, totalPages);
  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  return { page: safePage, setPage, totalPages, pageSize, slice };
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

export function RecentRequestsTable({
  requests,
  compact = false,
}: {
  requests: GatewayRequest[];
  compact?: boolean;
}) {
  const { page, setPage, totalPages, pageSize, slice } = usePagination(requests, 10);

  if (!requests.length) {
    return (
      <EmptyState>
        暂无网关请求记录。请确认 Agent 已配置 evk_ Key，且请求发往 /api/gateway/v1/chat/completions。
      </EmptyState>
    );
  }
  const rows = compact ? requests.slice(0, 8) : slice;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">时间</th>
            <th className="w-40 px-3 py-2 font-semibold">模型</th>
            <th className="w-24 px-3 py-2 font-semibold">账号</th>
            <th className="w-14 px-3 py-2 font-semibold">状态</th>
            <th className="w-16 px-3 py-2 font-semibold">Tok</th>
            <th className="w-20 px-3 py-2 font-semibold">成本</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((req) => (
            <tr key={req.request_id}>
              <td className="truncate px-3 py-2 text-xs text-slate-600">{formatDateTimeShort(req.created_at)}</td>
              <td className="px-3 py-2">
                <div className="truncate font-mono text-xs text-slate-950">{req.model || "—"}</div>
                {req.model_alias && req.model_alias !== req.model && (
                  <div className="truncate font-mono text-[10px] text-slate-400">via: {req.model_alias}</div>
                )}
              </td>
              <td className="truncate px-3 py-2 font-mono text-xs text-slate-600">{req.account_name || req.agent_id || "—"}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{req.status_code ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{req.total_tokens ?? 0}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">${asNumber(req.cost_usd).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={requests.length}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function ConversationTable({ conversations }: { conversations: GatewayConversation[] }) {
  const { page, setPage, totalPages, pageSize, slice } = usePagination(conversations, 10);
  if (!conversations.length) return <EmptyState>暂无会话记录。</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-40 px-3 py-2 font-semibold">Conversation</th>
            <th className="px-3 py-2 font-semibold">User Message</th>
            <th className="w-24 px-3 py-2 font-semibold">Agent</th>
            <th className="w-36 px-3 py-2 font-semibold">Model</th>
            <th className="w-14 px-3 py-2 font-semibold">Req</th>
            <th className="w-20 px-3 py-2 font-semibold">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {slice.map((c) => (
            <tr key={c.conversation_id}>
              <td className="truncate px-3 py-2 font-mono text-xs text-slate-950">{c.conversation_id}</td>
              <td className="px-3 py-2 max-w-0 w-full">
                <div className="truncate text-xs text-slate-700" title={c.user_message || undefined}>{c.user_message || "—"}</div>
              </td>
              <td className="truncate px-3 py-2 font-mono text-xs text-slate-600">{c.account_name || c.agent_id || "—"}</td>
              <td className="px-3 py-2">
                <div className="truncate font-mono text-xs text-slate-600">{c.model || "—"}</div>
                {c.model_alias && c.model_alias !== c.model && (
                  <div className="truncate font-mono text-[10px] text-slate-400">via: {c.model_alias}</div>
                )}
              </td>
              <td className="px-3 py-2 text-slate-600">{c.requests ?? 0}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">${asNumber(c.cost_usd).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination
        page={page}
        totalPages={totalPages}
        total={conversations.length}
        pageSize={pageSize}
        onPageChange={setPage}
      />
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
        <div className="space-y-5">
          <Card className="p-4">
            <SectionHeader
              title="在线试调"
              subtitle="在浏览器里直接调用网关，查看最终模型、尝试次数与重试/降级审计"
            />
            <GatewayPlaygroundPanel />
          </Card>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="p-4">
              <SectionHeader title="上游模型" subtitle="企业网关直连的厂商 endpoint 与 API Key" />
              <GatewayUpstreamModelsPanel />
            </Card>
            <Card className="p-4">
              <SectionHeader title="别名路由" subtitle="员工 Agent 使用的 model 名 → 上游 model_name" />
              <GatewayModelRoutesPanel />
            </Card>
          </div>
          <GatewayAdvancedPanel />
        </div>
      )}

      {tab === "connect" && (
        <Card className="p-5">
          <SectionHeader
            title="员工接入"
            subtitle={`模型请求统一走 Evotown 企业网关；已签发 Key：${data.gatewayKeys.length} 个`}
          />
          <EmployeeConfigPanel compact className="border-slate-200 bg-slate-50/50" />
          <p className="mt-4 text-xs text-slate-500">
            员工只需配置 Evotown 地址与 evk_ Key；身份、审计、配额与模型路由由企业控制台统一管理。Key 签发见「账号」页。
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
              <SimpleUsageTable rows={byAccount} nameKey="account_name" empty="暂无数据" />
            </Card>
          </div>
          <Card className="p-4">
            <SectionHeader title="请求调用" subtitle="最近 chat/completions 审计记录" />
            <RecentRequestsTable requests={data.gatewayRequests} />
          </Card>
          <Card className="p-4">
            <SectionHeader title="会话" subtitle="按 conversation_id 聚合" />
            <ConversationTable conversations={data.conversations} />
          </Card>
        </div>
      )}
    </div>
  );
}
