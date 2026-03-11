/** EGL 收敛曲线 + 成功率趋势图 */
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useEvotownStore, type MetricsPoint } from "../store/evotownStore";

const AGENT_COLORS: Record<string, string> = {
  agent_1: "#38bdf8",
  agent_2: "#a78bfa",
  agent_3: "#34d399",
  agent_4: "#fbbf24",
  agent_5: "#f87171",
};

function agentColor(id: string) {
  return AGENT_COLORS[id] ?? "#94a3b8";
}

function formatDate(d: string): string {
  try {
    const date = new Date(d);
    return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  } catch {
    return d;
  }
}

export function MetricsDashboard({ agents }: { agents: { id: string; display_name?: string }[] }) {
  const [data, setData] = useState<{ date: string; [key: string]: string | number | undefined }[]>([]);
  const setMetricsCache = useEvotownStore((s) => s.setMetricsCache);

  useEffect(() => {
    const load = async () => {
      const all: Record<string, MetricsPoint[]> = {};
      for (const a of agents) {
        try {
          const r = await fetch(`/agents/${a.id}/metrics?limit=50`);
          const raw = await r.json();
          // 兼容：接口返回 { daily, egl_7d, egl_all_time } 或旧版直接为数组
          const rows: MetricsPoint[] = Array.isArray(raw) ? raw : (raw?.daily ?? []);
          setMetricsCache(a.id, rows);
          all[a.id] = rows;
        } catch (err) {
          console.warn(`[evotown] fetch metrics for ${a.id} failed`, err);
          all[a.id] = [];
        }
      }
      // 合并为按 date 的表格
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
            row[`${a.id}_egl`] = point.egl;
            row[`${a.id}_rate`] = point.first_success_rate;
          }
        }
        return row;
      });
      setData(merged);
    };
    if (agents.length) load();
  }, [agents.map((a) => a.id).join(",")]);

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
              tickFormatter={formatDate}
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
              labelFormatter={formatDate}
              formatter={(v: number) => [(v ?? 0).toFixed(2), ""]}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value) => String(value).replace(/_egl$/, "")}
            />
            <ReferenceLine y={0.7} stroke="#64748b" strokeDasharray="3 3" />
            {agents.map((a) => (
              <Line
                key={a.id}
                type="monotone"
                dataKey={`${a.id}_egl`}
                name={a.display_name || a.id}
                stroke={agentColor(a.id)}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-slate-500">
        EGL = 每千次决策的进化产出数（规则/示例/技能）。约 10～100 表示有稳定学习；结合成功率与纠正率综合看。
      </p>
    </div>
  );
}
