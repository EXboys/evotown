/**
 * 社交图谱 — NES/FC 风格力导向关系图（纯 React + SVG，无外部依赖）
 * 节点 = 武将，边 = 消息往来权重，队伍颜色区分阵营
 */
import { useEffect, useRef, useState, useCallback } from "react";

interface GraphNode {
  id: string;
  name: string;
  team_id: string | null;
  team_name: string | null;
  // 物理模拟状态（运行时附加）
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  types: Record<string, number>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface SocialMessage {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  content: string;
  msg_type: string;
  ts: number;
}

/** 根据 team_id 哈希分配阵营颜色（NES 调色板） */
function teamColor(teamId: string | null): string {
  if (!teamId) return "#94a3b8"; // 无队伍 → 灰
  const hash = teamId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  const palette = ["#ef4444", "#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#eab308"];
  return palette[Math.abs(hash) % palette.length];
}

function edgeLabel(types: Record<string, number>): string {
  const map: Record<string, string> = { greeting: "礼", challenge: "战", alliance: "盟", strategy: "谋", chat: "叙", reply: "回复" };
  return Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k]) => map[k] ?? k).slice(0, 2).join("");
}

const WIDTH = 340;
const HEIGHT = 280;
const NODE_R = 14;

export function SocialGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  // tick 仅用于触发 React 重渲染（force 模拟每帧更新物理状态后调用）
  const [, setTick] = useState(0);
  const rafRef = useRef<number>(0);
  const stableRef = useRef(false);

  // 消息列表状态
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const fetchGraph = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/teams/social/graph?limit=300")
      .then((r) => r.json())
      .then((d: GraphData) => {
        // 初始化节点位置（圆形散布）
        const n = d.nodes.length;
        const initNodes: GraphNode[] = d.nodes.map((node, i) => ({
          ...node,
          x: WIDTH / 2 + Math.cos((i / n) * Math.PI * 2) * 100,
          y: HEIGHT / 2 + Math.sin((i / n) * Math.PI * 2) * 80,
          vx: 0, vy: 0,
        }));
        nodesRef.current = initNodes;
        stableRef.current = false;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError("加载失败");
        setLoading(false);
      });
  }, []);

  const fetchMessages = useCallback(() => {
    setMessagesLoading(true);
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (selectedNode) {
      params.set("agent_id", selectedNode);
    }
    fetch(`/teams/social/messages?${params}`)
      .then((r) => r.json())
      .then((d: { messages: SocialMessage[] }) => {
        setMessages(d.messages || []);
      })
      .catch(() => {
        setMessages([]);
      })
      .finally(() => {
        setMessagesLoading(false);
      });
  }, [selectedNode]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // 当选中节点变化时，重新获取消息
  useEffect(() => {
    if (data && selectedNode) {
      fetchMessages();
    } else if (data && !selectedNode) {
      // 没有选中节点时，获取所有消息
      fetchMessages();
    }
  }, [selectedNode, data, fetchMessages]);

  // 力导向模拟（斥力 + 弹簧 + 阻尼）
  useEffect(() => {
    if (!data) return;
    const edgeMap = new Map<string, number>();
    const currentData = data;
    currentData.edges.forEach((e) => {
      edgeMap.set(`${e.source}|${e.target}`, e.weight);
      edgeMap.set(`${e.target}|${e.source}`, e.weight);
    });

    let frameCount = 0;
    function simulate() {
      if (stableRef.current) return;
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;

      // 斥力（节点间）
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = Math.min(1200 / (dist * dist), 8);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx; nodes[i].vy -= fy;
          nodes[j].vx += fx; nodes[j].vy += fy;
        }
      }

      // 弹簧引力（有边的节点对）
      currentData.edges.forEach((e) => {
        const src = nodes.find((n) => n.id === e.source);
        const tgt = nodes.find((n) => n.id === e.target);
        if (!src || !tgt) return;
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealDist = Math.max(60, 100 - e.weight * 5);
        const spring = (dist - idealDist) * 0.04;
        const fx = (dx / dist) * spring;
        const fy = (dy / dist) * spring;
        src.vx += fx; src.vy += fy;
        tgt.vx -= fx; tgt.vy -= fy;
      });

      // 中心引力
      nodes.forEach((n) => {
        n.vx += (WIDTH / 2 - n.x) * 0.01;
        n.vy += (HEIGHT / 2 - n.y) * 0.01;
      });

      // 阻尼 + 位置更新 + 边界
      let totalKE = 0;
      nodes.forEach((n) => {
        n.vx *= 0.85; n.vy *= 0.85;
        n.x = Math.max(NODE_R + 2, Math.min(WIDTH - NODE_R - 2, n.x + n.vx));
        n.y = Math.max(NODE_R + 2, Math.min(HEIGHT - NODE_R - 2, n.y + n.vy));
        totalKE += n.vx * n.vx + n.vy * n.vy;
      });

      frameCount++;
      if (totalKE < 0.05 || frameCount > 300) {
        stableRef.current = true;
      }
      setTick((t) => t + 1);
      if (!stableRef.current) {
        rafRef.current = requestAnimationFrame(simulate);
      }
    }
    rafRef.current = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [data]);

  const nodes = nodesRef.current;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">🕸 社交图谱</h3>
        <div className="flex gap-1">
          {selectedNode && (
            <button
              onClick={() => setSelectedNode(null)}
              className="text-[10px] text-amber-400 hover:text-amber-300 px-1.5 py-0.5 rounded border border-amber-600/40"
            >
              清除筛选
            </button>
          )}
          <button onClick={fetchGraph} className="text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded border border-slate-600/40">刷新</button>
        </div>
      </div>

      {loading && <p className="text-xs text-slate-500 text-center py-8 animate-pulse">载入中…</p>}
      {error && <p className="text-xs text-red-400 text-center py-4">{error}</p>}
      {!loading && !error && data && data.nodes.length === 0 && (
        <p className="text-xs text-slate-500 italic text-center py-8">暂无社交记录，武将尚未互通书信</p>
      )}

      {!loading && data && nodes.length > 0 && (
        <div className="rounded border border-slate-700/50 overflow-hidden bg-slate-900/80" style={{ imageRendering: "pixelated" }}>
          <svg width={WIDTH} height={HEIGHT} style={{ display: "block" }}>
            {/* 边 */}
            {data.edges.map((e, i) => {
              const src = nodes.find((n) => n.id === e.source);
              const tgt = nodes.find((n) => n.id === e.target);
              if (!src || !tgt) return null;
              const w = Math.min(Math.max(e.weight, 1), 5);
              const isHighlight = selectedNode && (e.source === selectedNode || e.target === selectedNode);
              return (
                <g key={i}>
                  <line
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke={isHighlight ? "#f59e0b" : "#475569"}
                    strokeWidth={w}
                    strokeOpacity={isHighlight ? 0.8 : 0.5}
                  />
                  <text x={(src.x + tgt.x) / 2} y={(src.y + tgt.y) / 2}
                    fontSize={7} fill={isHighlight ? "#f59e0b" : "#94a3b8"} textAnchor="middle" dominantBaseline="middle">
                    {edgeLabel(e.types)}
                  </text>
                </g>
              );
            })}
            {/* 节点 */}
            {nodes.map((n) => {
              const color = teamColor(n.team_id);
              const isSelected = selectedNode === n.id;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  onClick={() => setSelectedNode(isSelected ? null : n.id)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={-NODE_R - 2} y={-NODE_R - 2}
                    width={NODE_R * 2 + 4} height={NODE_R * 2 + 4}
                    fill={isSelected ? "#f59e0b33" : "transparent"}
                    stroke={isSelected ? "#f59e0b" : color}
                    strokeWidth={isSelected ? 3 : 2}
                    rx={4}
                  />
                  <rect x={-NODE_R} y={-NODE_R} width={NODE_R * 2} height={NODE_R * 2}
                    fill="#1e293b" stroke={color} strokeWidth={2} rx={2} />
                  <text fontSize={8} fill={color} textAnchor="middle" dominantBaseline="middle" fontWeight="bold">
                    {n.name.slice(0, 2)}
                  </text>
                  <text y={NODE_R + 8} fontSize={7} fill="#cbd5e1" textAnchor="middle">
                    {n.team_name ? `[${n.team_name}]` : ""}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* 图例 */}
      {data && data.nodes.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
          <span>边粗 = 消息频率</span>
          <span>礼=问候 战=挑战 盟=结盟 谋=策略 叙=闲聊 回复=回复</span>
        </div>
      )}

      {/* 消息列表 */}
      {data && data.nodes.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-700/50">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-slate-400">
              {selectedNode ? `与 ${nodes.find(n => n.id === selectedNode)?.name || selectedNode} 的对话` : "最近对话"}
            </h4>
            <span className="text-[10px] text-slate-500">{messages.length} 条</span>
          </div>

          {messagesLoading ? (
            <p className="text-xs text-slate-500 text-center py-4 animate-pulse">加载中…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-slate-500 italic text-center py-4">暂无消息</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {messages.slice(0, 50).map((msg, i) => {
                const isToSelected = selectedNode && msg.to_id === selectedNode;
                const isFromSelected = selectedNode && msg.from_id === selectedNode;
                const msgTypeLabel: Record<string, string> = {
                  greeting: "问候", challenge: "挑战", alliance: "结盟", strategy: "策略", chat: "闲聊", reply: "回复"
                };
                return (
                  <div
                    key={i}
                    className={`p-2 rounded border text-xs ${
                      isToSelected || isFromSelected
                        ? "bg-amber-900/20 border-amber-700/40"
                        : "bg-slate-800/40 border-slate-700/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-medium text-slate-300">{msg.from_name}</span>
                      <span className="text-slate-500">→</span>
                      <span className="font-medium text-slate-300">{msg.to_name}</span>
                      <span className="ml-auto text-[10px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-400">
                        {msgTypeLabel[msg.msg_type] || msg.msg_type}
                      </span>
                    </div>
                    <p className="text-slate-400 leading-relaxed line-clamp-3" title={msg.content}>
                      {msg.content}
                    </p>
                    <p className="text-[10px] text-slate-600 mt-1">
                      {new Date(msg.ts * 1000).toLocaleString("zh-CN")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

