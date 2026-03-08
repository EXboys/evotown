/** 分享卡片组件 — 1080×1080px 进化里程碑卡片，支持预览 + 下载 */
import { useCallback, useState } from "react";

export interface ShareCardProps {
  agentId: string;
  agentName: string;
  balance: number;
  taskCount: number;
  successCount: number;
  rulesCount: number;
  skillsCount: number;
  evolutionCount: number;
  /** 最新进化顿悟内容（rule reason / skill description） */
  latestEpiphany: string;
  onClose: () => void;
}

/** 在 canvas 上换行绘制文本（中文按字符拆分） */
function canvasWrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  let line = "";
  let lineY = y;
  for (let i = 0; i < text.length; i++) {
    const test = line + text[i];
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, lineY);
      line = text[i];
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
  return lineY + lineHeight;
}

export function ShareCard({
  agentId,
  agentName,
  balance,
  taskCount,
  successCount,
  rulesCount,
  skillsCount,
  evolutionCount,
  latestEpiphany,
  onClose,
}: ShareCardProps) {
  const successRate = taskCount > 0 ? Math.round((successCount / taskCount) * 100) : 0;
  const epiphanyText = latestEpiphany || "持续进化中…";
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  /** 从后端下载 Pillow 生成的三国战报 PNG */
  const downloadServerCard = useCallback(async () => {
    setServerLoading(true);
    setServerError(null);
    try {
      const res = await fetch(`/snapshot/card?agent_id=${encodeURIComponent(agentId)}`);
      if (!res.ok) {
        setServerError(`生成失败 (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = `${agentName}-战报.png`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setServerError("网络错误，请重试");
    } finally {
      setServerLoading(false);
    }
  }, [agentId, agentName]);

  const downloadCanvas = useCallback(() => {
    const S = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CJK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, "#0f172a");
    bg.addColorStop(0.5, "#1e1b4b");
    bg.addColorStop(1, "#0f172a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    // Border glow
    ctx.shadowColor = "#7c3aed";
    ctx.shadowBlur = 40;
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 6;
    ctx.strokeRect(32, 32, S - 64, S - 64);
    ctx.shadowBlur = 0;

    // Top accent line
    const accentGrad = ctx.createLinearGradient(0, 0, S, 0);
    accentGrad.addColorStop(0, "transparent");
    accentGrad.addColorStop(0.5, "#7c3aed");
    accentGrad.addColorStop(1, "transparent");
    ctx.strokeStyle = accentGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 80);
    ctx.lineTo(S - 80, 80);
    ctx.stroke();

    // Icon
    ctx.font = `88px ${CJK}`;
    ctx.textAlign = "center";
    ctx.fillText("🧠", S / 2, 220);

    // Agent name
    ctx.fillStyle = "#c4b5fd";
    ctx.font = `bold 80px ${CJK}`;
    ctx.fillText(agentName, S / 2, 340);

    // Subtitle
    ctx.fillStyle = "#8b5cf6";
    ctx.font = `38px ${CJK}`;
    ctx.fillText(`第 ${evolutionCount} 次进化顿悟`, S / 2, 410);

    // Divider
    const divGrad = ctx.createLinearGradient(0, 0, S, 0);
    divGrad.addColorStop(0, "transparent");
    divGrad.addColorStop(0.5, "rgba(139,92,246,0.45)");
    divGrad.addColorStop(1, "transparent");
    ctx.strokeStyle = divGrad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(80, 450);
    ctx.lineTo(S - 80, 450);
    ctx.stroke();

    // Quote mark decoration
    ctx.fillStyle = "rgba(139,92,246,0.15)";
    ctx.font = `220px Georgia, serif`;
    ctx.textAlign = "left";
    ctx.fillText('"', 55, 660);

    // Epiphany text
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `46px ${CJK}`;
    ctx.textAlign = "center";
    canvasWrapText(ctx, epiphanyText, S / 2, 510, 860, 70);

    // Stats box
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.strokeStyle = "rgba(139,92,246,0.25)";
    ctx.lineWidth = 1.5;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx as any).roundRect(80, 760, S - 160, 190, 20);
    } catch {
      ctx.rect(80, 760, S - 160, 190);
    }
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#94a3b8";
    ctx.font = `34px ${CJK}`;
    ctx.fillText(`任务 ${taskCount} 次 · 成功率 ${successRate}% · 余额 $${balance}`, S / 2, 825);
    ctx.fillText(`规则 ${rulesCount} 条 · 技能 ${skillsCount} 个 · 进化 ${evolutionCount} 次`, S / 2, 880);

    // Branding
    ctx.fillStyle = "#475569";
    ctx.font = `30px ${CJK}`;
    ctx.fillText("Evotown · SkillLite", S / 2, 990);
    ctx.fillStyle = "#6366f1";
    ctx.font = `26px ${CJK}`;
    ctx.fillText("#AI进化  #Evotown  #AI智能体", S / 2, 1032);

    const a = document.createElement("a");
    a.download = `${agentName}-evo${evolutionCount}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }, [agentName, balance, taskCount, successCount, rulesCount, skillsCount, evolutionCount, epiphanyText, successRate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-xs flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-slate-300 text-sm font-medium">📤 分享卡片</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Card Preview */}
        <div
          className="aspect-square w-full rounded-2xl overflow-hidden flex flex-col items-center justify-between p-5 relative"
          style={{ background: "linear-gradient(180deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)", border: "2px solid #7c3aed", boxShadow: "0 0 36px rgba(124,58,237,0.35)" }}
        >
          <div className="w-full h-px bg-gradient-to-r from-transparent via-violet-500 to-transparent" />
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-1">
            <div className="text-3xl">🧠</div>
            <div>
              <p className="text-violet-300 font-bold text-base leading-tight">{agentName}</p>
              <p className="text-violet-500 text-[10px] mt-0.5">第 {evolutionCount} 次进化顿悟</p>
            </div>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
            <p className="text-slate-200 text-[10px] leading-relaxed max-w-[220px] text-center">
              "{epiphanyText}"
            </p>
          </div>
          <div className="w-full rounded-xl bg-white/5 border border-violet-500/20 p-2.5 text-center space-y-1">
            <p className="text-slate-400 text-[9px]">任务 {taskCount} · 成功率 {successRate}% · 余额 ${balance}</p>
            <p className="text-slate-400 text-[9px]">规则 {rulesCount} 条 · 技能 {skillsCount} 个 · 进化 {evolutionCount} 次</p>
            <div className="pt-1 border-t border-slate-700/50">
              <p className="text-slate-600 text-[8px]">Evotown · SkillLite</p>
              <p className="text-indigo-500 text-[8px]">#AI进化 #Evotown</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <button
          onClick={downloadServerCard}
          disabled={serverLoading}
          className="w-full py-2.5 rounded-lg text-sm font-medium bg-amber-700/80 hover:bg-amber-600 text-amber-100 border border-amber-600/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {serverLoading ? "生成中…" : "🏯 下载三国战报（后端高清）"}
        </button>
        {serverError && (
          <p className="text-center text-rose-400 text-[10px]">{serverError}</p>
        )}
        <button
          onClick={downloadCanvas}
          className="w-full py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          ⬇ 下载进化卡片 1080×1080
        </button>
        <p className="text-center text-slate-600 text-[10px]">下载后直接发布到社交媒体</p>
      </div>
    </div>
  );
}

