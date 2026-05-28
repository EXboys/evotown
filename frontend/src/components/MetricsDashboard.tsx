/** 成功率 / 重规划 / 纠正率趋势图 */
import { useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatChartDay } from "../lib/datetime";
import { useEvotownStore, type MetricsPoint } from "../store/evotownStore";

const AGENT_COLORS: Record<string, string> = {
  agent_1: "#38bdf8",
  agent_2: "#a78bfa",
  agent_3: "#34d399",
  agent_4: "#fbbf24",
  agent_5: "#f87171",
};

const METRICS_CACHE_TTL_MS = 60_000;

function agentColor(id: string) {
  return AGENT_COLORS[id] ?? "#94a3b8";
}

async function fetchMetrics(agentId: string): Promise<MetricsPoint[]> {
  const r = await fetch(`/agents/${agentId}/metrics?limit=50`);
  const raw = await r.json();
  return Array.isArray(raw) ? raw : (raw?.daily ?? []);
}

export function MetricsDashboard({ agents }: { agents: { id: string; display_name?: string }[] }) {
  const [data, setData] = useState<{ date: string; [key: string]: string | number | undefined }[]>([]);
  const setMetricsCache = useEvotownStore((s) => s.setMetricsCache);
  const cacheFetchedAt = useRef<Record<string, number>>({});
  const agentIds = agents.map((a) => a.id).join(",");

  useEffect(() => {
    const load = async () => {
      const now = Date.now();
      const cachedSnapshot = useEvotownStore.getState().metricsCache;
      const all: Record<string, MetricsPoint[]> = {};
      const pending = agents.map(async (agent) => {
        const cached = cachedSnapshot[agent.id];
        const fetchedAt = cacheFetchedAt.current[agent.id] ?? 0;
        if (cached?.length && now - fetchedAt < METRICS_CACHE_TTL_MS) {
          all[agent.id] = cached;
          return;
        }
        try {
          const rows = await fetchMetrics(agent.id);
          cacheFetchedAt.current[agent.id] = now;
          setMetricsCache(agent.id, rows);
          all[agent.id] = rows;
        } catch (err) {
          console.warn(`[evotown] fetch metrics for ${agent.id} failed`, err);
          all[agent.id] = cached ?? [];
        }
      });
      await Promise.all(pending);

      const dateSet = new Set<string>();
      for (const rows of Object.values(all)) {
        for (const row of rows) {
          if (row.date) dateSet.add(row.date);
        }
      }
      const dates = Array.from(dateSet).sort();
      const merged = dates.map((date) => {
        const row: { date: string; [key: string]: string | number | undefined } = { date };
        for (const a of agents) {
          const point = all[a.id]?.find((p) => p.date === date);
          if (point) {
            row[`${a.id}_first_success_rate`] = point.first_success_rate;
            row[`${a.id}_avg_replans`] = point.avg_replans;
            row[`${a.id}_user_correction_rate`] = point.user_correction_rate;
          }
        }
        return row;
      });
      setData(merged);
    };
    if (agents.length) load();
  }, [agentIds, setMetricsCache]);

  if (agents.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-6 text-center">暂无 Agent，请先创建</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="date"
              tickFormatter={formatChartDay}
              stroke="#64748b"
              tick={{ fontSize: 10 }}
            />
            <YAxis
              domain={[0, 1]}
              stroke="#64748b"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
              labelFormatter={formatChartDay}
              formatter={(v: number) => [(v ?? 0).toFixed(2), ""]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />

            {agents.map((a) => (
              <Line
                key={`${a.id}_first_success_rate`}
                type="monotone"
                dataKey={`${a.id}_first_success_rate`}
                name={`${a.display_name || a.id} FSR`}
                stroke={agentColor(a.id)}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
            {agents.map((a) => (
              <Line
                key={`${a.id}_avg_replans`}
                type="monotone"
                dataKey={`${a.id}_avg_replans`}
                name={`${a.display_name || a.id} Avg Replans`}
                stroke={agentColor(a.id)}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
            {agents.map((a) => (
              <Line
                key={`${a.id}_user_correction_rate`}
                type="monotone"
                dataKey={`${a.id}_user_correction_rate`}
                name={`${a.display_name || a.id} UCR`}
                stroke={agentColor(a.id)}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
