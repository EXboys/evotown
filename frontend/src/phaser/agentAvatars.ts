/**
 * 办公场景 Agent 头像 — 数字员工角色（抽象像素徽章，非真人肖像）
 */

export type AvatarId =
  | "engineer"
  | "analyst"
  | "ops"
  | "lead"
  | "qa"
  | "devops"
  | "security"
  | "data"
  | "pm"
  | "architect"
  | "support"
  | "intern"
  | "generic";

export interface AgentAvatarInfo {
  id: AvatarId;
  name: string;
  title: string;
  color: string;
  /** 部门色（组队旗帜等） */
  dept: string;
  deptColor: string;
}

export const AGENT_AVATARS: Record<AvatarId, AgentAvatarInfo> = {
  engineer:  { id: "engineer",  name: "陈工程师",   title: "研发·执行",     color: "#3B82F6", dept: "研发", deptColor: "#3B82F6" },
  analyst:   { id: "analyst",   name: "林分析师",   title: "数据·洞察",     color: "#06B6D4", dept: "数据", deptColor: "#06B6D4" },
  ops:       { id: "ops",       name: "周运维",     title: "运维·稳定",     color: "#22C55E", dept: "平台", deptColor: "#22C55E" },
  lead:      { id: "lead",      name: "吴负责人",   title: "技术·牵头",     color: "#8B5CF6", dept: "平台", deptColor: "#8B5CF6" },
  qa:        { id: "qa",        name: "郑测试",     title: "质量·验收",     color: "#F97316", dept: "质量", deptColor: "#F97316" },
  devops:    { id: "devops",    name: "孙 DevOps",  title: "交付·流水线",   color: "#14B8A6", dept: "平台", deptColor: "#14B8A6" },
  security:  { id: "security",  name: "钱安全",     title: "安全·合规",     color: "#EF4444", dept: "安全", deptColor: "#EF4444" },
  data:      { id: "data",      name: "冯数据",     title: "数据·工程",     color: "#0EA5E9", dept: "数据", deptColor: "#0EA5E9" },
  pm:        { id: "pm",        name: "赵产品",     title: "产品·协调",     color: "#EAB308", dept: "产品", deptColor: "#EAB308" },
  architect: { id: "architect", name: "陆架构师",   title: "架构·设计",     color: "#6366F1", dept: "研发", deptColor: "#6366F1" },
  support:   { id: "support",   name: "何支持",     title: "支持·响应",     color: "#84CC16", dept: "支持", deptColor: "#84CC16" },
  intern:    { id: "intern",    name: "实习生小许", title: "实习·学习",     color: "#94A3B8", dept: "研发", deptColor: "#94A3B8" },
  generic:   { id: "generic",   name: "数字员工",   title: "Agent·Runner", color: "#64748B", dept: "—",    deptColor: "#94A3B8" },
};

const AVATAR_IDS: AvatarId[] = [
  "engineer", "analyst", "ops", "lead", "qa", "devops",
  "security", "data", "pm", "architect", "support", "intern",
];

/** 根据显示名或关键词匹配角色 */
export function getAvatarForAgent(displayName: string): AvatarId {
  const n = (displayName ?? "").toLowerCase();
  if (n.includes("工程") || n.includes("engineer") || n.includes("dev")) return "engineer";
  if (n.includes("分析") || n.includes("analyst")) return "analyst";
  if (n.includes("运维") || n.includes("ops") || n.includes("sre")) return "ops";
  if (n.includes("负责") || n.includes("lead") || n.includes("owner")) return "lead";
  if (n.includes("测试") || n.includes("qa")) return "qa";
  if (n.includes("devops") || n.includes("交付")) return "devops";
  if (n.includes("安全") || n.includes("security")) return "security";
  if (n.includes("数据") || n.includes("data")) return "data";
  if (n.includes("产品") || n.includes("pm")) return "pm";
  if (n.includes("架构") || n.includes("architect")) return "architect";
  if (n.includes("支持") || n.includes("support")) return "support";
  if (n.includes("实习") || n.includes("intern")) return "intern";
  const hash = (displayName ?? "").split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  return AVATAR_IDS[Math.abs(hash) % AVATAR_IDS.length];
}

export function avatarColorHex(avatarId: AvatarId): number {
  const hex = AGENT_AVATARS[avatarId]?.color ?? AGENT_AVATARS.generic.color;
  return parseInt(hex.replace("#", ""), 16);
}

function r(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** 32×48 抽象数字员工徽章（立绘/列表用） */
export function drawAgentAvatar(ctx: CanvasRenderingContext2D, avatarId: AvatarId): void {
  const info = AGENT_AVATARS[avatarId] ?? AGENT_AVATARS.generic;
  const accent = info.color;
  const dark = "#1E293B";
  const shirt = accent;
  const shirtDark = "#0F172A";
  const screen = "#38BDF8";
  const skin = "#F0B080";

  r(ctx, 0, 0, 32, 48, "#0F172A");
  r(ctx, 4, 0, 24, 48, "#111827");

  // 显示器/工牌头
  r(ctx, 10, 4, 12, 10, dark);
  r(ctx, 11, 5, 10, 7, screen);
  r(ctx, 13, 14, 6, 4, skin);

  // 躯干（工服）
  r(ctx, 8, 18, 16, 14, shirt);
  r(ctx, 8, 18, 4, 14, shirtDark);
  r(ctx, 20, 18, 4, 14, shirtDark);
  // 口袋徽章
  r(ctx, 14, 22, 4, 3, "#F8FAFC");

  // 腿
  r(ctx, 10, 32, 5, 12, dark);
  r(ctx, 17, 32, 5, 12, dark);
  r(ctx, 10, 42, 5, 2, "#334155");
  r(ctx, 17, 42, 5, 2, "#334155");
}

export function createAvatarCanvas(avatarId: AvatarId, scale = 3): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 32 * scale;
  c.height = 48 * scale;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  drawAgentAvatar(ctx, avatarId);
  return c;
}
