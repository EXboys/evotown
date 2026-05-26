/**
 * AgentAvatarCanvas — 办公场景数字员工像素徽章
 */
import { useEffect, useRef } from "react";
import {
  AGENT_AVATARS,
  createAvatarCanvas,
  drawAgentAvatar,
  getAvatarForAgent,
  type AvatarId,
} from "../phaser/agentAvatars";

interface Props {
  avatarId?: AvatarId;
  agentDisplayName?: string;
  scale?: number;
  className?: string;
  title?: string;
}

export function AgentAvatarCanvas({
  avatarId,
  agentDisplayName,
  scale = 3,
  className = "",
  title,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wid: AvatarId =
    avatarId ?? (agentDisplayName ? getAvatarForAgent(agentDisplayName) : "generic");
  const info = AGENT_AVATARS[wid];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const px = 32 * scale;
    const py = 48 * scale;
    canvas.width = px;
    canvas.height = py;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, py);
    ctx.scale(scale, scale);
    drawAgentAvatar(ctx, wid);
  }, [wid, scale]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ imageRendering: "pixelated", width: 32 * scale, height: 48 * scale }}
      title={title ?? `${info.name} · ${info.title}`}
    />
  );
}

/** 离屏导出用 */
export { createAvatarCanvas };
