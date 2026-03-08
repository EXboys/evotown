import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { WARRIOR_FRAMES } from "../phaser/characterAssets";

/** 13 武将数据：蜀汉 5 / 曹魏 4 / 东吴 4 */
const GENERALS = [
  // 蜀汉
  { id: "liubei",    name: "刘备", title: "汉昭烈帝", team: "蜀", color: "#ef4444" },
  { id: "guanyu",    name: "关羽", title: "武　圣",   team: "蜀", color: "#ef4444" },
  { id: "zhangfei",  name: "张飞", title: "燕人张飞", team: "蜀", color: "#ef4444" },
  { id: "zhaoyun",   name: "赵云", title: "常胜将军", team: "蜀", color: "#ef4444" },
  { id: "kongming",  name: "孔明", title: "卧龙先生", team: "蜀", color: "#ef4444" },
  // 曹魏
  { id: "caocao",    name: "曹操", title: "魏武帝",   team: "魏", color: "#3b82f6" },
  { id: "zhangliao", name: "张辽", title: "五子良将", team: "魏", color: "#3b82f6" },
  { id: "guojia",    name: "郭嘉", title: "鬼才军师", team: "魏", color: "#3b82f6" },
  { id: "simayi",    name: "仲达", title: "冢　虎",   team: "魏", color: "#3b82f6" },
  // 东吴
  { id: "sunquan",   name: "孙权", title: "吴大帝",   team: "吴", color: "#22c55e" },
  { id: "zhouyu",    name: "周瑜", title: "大都督",   team: "吴", color: "#22c55e" },
  { id: "huanggai",  name: "黄盖", title: "东吴老将", team: "吴", color: "#22c55e" },
  { id: "lusu",      name: "鲁肃", title: "和事良臣", team: "吴", color: "#22c55e" },
];

/** 16×16 像素武将立绘 — 从 WARRIOR_FRAMES 取 front 帧渲染到 Canvas */
function PixelPortrait({ warriorId, scale = 4 }: { warriorId: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frame = (WARRIOR_FRAMES as Record<string, Record<string, (string | null)[][]>>)[warriorId]?.front;
    if (!frame) return;
    ctx.clearRect(0, 0, 16, 16);
    for (let y = 0; y < frame.length; y++) {
      for (let x = 0; x < frame[y].length; x++) {
        const c = frame[y][x];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
      }
    }
  }, [warriorId]);
  return (
    <canvas
      ref={ref}
      width={16}
      height={16}
      style={{ imageRendering: "pixelated", width: `${16 * scale}px`, height: `${16 * scale}px` }}
    />
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const [latestChronicle, setLatestChronicle] = useState<{ preview: string; date: string } | null>(null);

  useEffect(() => {
    fetch("/chronicle")
      .then((r) => r.json())
      .then((d: { preview: string; date: string }[]) => {
        if (Array.isArray(d) && d.length > 0) setLatestChronicle(d[0]);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="min-h-screen bg-black text-white flex flex-col font-mono"
      style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,200,0,0.015) 2px, rgba(255,200,0,0.015) 4px)" }}
    >
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-3 border-b-2 border-amber-400 bg-black">
        <span className="text-xl font-bold tracking-widest text-amber-400">▶ 孔明传</span>
        <div className="flex gap-4 items-center">
          <button onClick={() => navigate("/chronicle")} className="text-xs text-amber-600 hover:text-amber-400 transition-colors">📜 史记阁</button>
          <button onClick={() => navigate("/arena")} className="text-xs text-amber-300 hover:text-amber-100 border border-amber-600 px-3 py-1 transition-colors">进入战场 →</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 py-14 text-center border-b-2 border-amber-900/40">
        <div className="mb-3 inline-flex items-center gap-2 border border-amber-400/50 bg-amber-400/10 px-4 py-1 text-xs text-amber-300 tracking-widest">
          ★ 三国 AI 演武场 · NES 像素风 ★
        </div>
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-4 tracking-widest text-amber-400">
          孔明传
        </h1>
        <p className="max-w-xl text-amber-100/70 text-sm mb-1 leading-relaxed">
          蜀汉·曹魏·东吴，十三武将同台竞技
        </p>
        <p className="max-w-xl text-slate-500 text-xs mb-8 leading-relaxed">
          真实 AI 在你眼前运筹帷幄、接令征战，余额归零即兵败身死。
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={() => navigate("/arena")} className="border-2 border-amber-400 bg-amber-400 px-8 py-3 text-black font-bold text-sm hover:bg-amber-300 transition-colors">
            ▶ 进入战场
          </button>
          <button onClick={() => navigate("/chronicle")} className="border border-amber-700 px-8 py-3 text-amber-400 text-sm hover:border-amber-500 hover:text-amber-300 transition-colors">
            📜 史记阁
          </button>
        </div>
      </section>

      {/* 最新战报预览 */}
      {latestChronicle && (
        <section className="px-6 py-5 border-b border-amber-900/30">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-amber-400 text-xs">◆ 最新战报</span>
              <span className="text-slate-600 text-[10px]">{latestChronicle.date}</span>
            </div>
            <div className="border border-amber-900/50 bg-amber-950/20 p-3">
              <p className="text-amber-200/80 text-xs leading-relaxed line-clamp-3">
                {latestChronicle.preview || "（暂无预览）"}
              </p>
              <button onClick={() => navigate("/chronicle")} className="mt-2 text-[10px] text-amber-600 hover:text-amber-400">
                阅读全文 →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 十三武将立绘 */}
      <section className="py-8 px-4 border-b border-amber-900/30">
        <h2 className="text-xs font-bold text-center mb-5 text-amber-400 tracking-widest">◆ 十三路豪杰 ◆</h2>
        <div className="flex gap-2 overflow-x-auto pb-2 justify-start md:justify-center max-w-5xl mx-auto">
          {GENERALS.map((g) => (
            <div key={g.id} className="flex-shrink-0 flex flex-col items-center gap-1 w-[68px]" style={{ borderTop: `2px solid ${g.color}` }}>
              <div className="bg-slate-950 w-[68px] h-[68px] flex items-center justify-center mt-1 border border-slate-800/60">
                <PixelPortrait warriorId={g.id} scale={4} />
              </div>
              <span className="text-[10px] text-white">{g.name}</span>
              <span className="text-[8px] text-slate-600 text-center leading-tight">{g.title}</span>
              <span className="text-[8px] px-1" style={{ color: g.color }}>【{g.team}】</span>
            </div>
          ))}
        </div>
      </section>

      {/* 赛制 */}
      <section className="py-8 px-6 border-b border-amber-900/30">
        <h2 className="text-xs font-bold text-center mb-5 text-amber-400 tracking-widest">◆ 赛制 ◆</h2>
        <div className="flex flex-col md:flex-row gap-3 justify-center max-w-3xl mx-auto">
          {[
            { step: "01", label: "武将接令出征", desc: "领军令 −5，胜则 +10，败则 −5" },
            { step: "02", label: "运筹帷幄进化", desc: "每战后 AI 自主修改策略，真正进化" },
            { step: "03", label: "兵败身死出局", desc: "余额归零，「兵败身死」动画实时播出" },
          ].map((s) => (
            <div key={s.step} className="flex-1 border border-amber-900/50 bg-amber-950/10 p-4 text-center">
              <div className="text-2xl font-black text-amber-400 mb-1">{s.step}</div>
              <div className="text-amber-200 text-xs mb-1">{s.label}</div>
              <div className="text-slate-500 text-[10px]">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-14 px-6 text-center">
        <h2 className="text-2xl font-black mb-3 text-amber-400">准备好观战了吗？</h2>
        <p className="text-slate-500 text-xs mb-6">点击进入，见证 AI 在三国战场中的生死角逐</p>
        <button onClick={() => navigate("/arena")} className="border-2 border-amber-400 bg-amber-400 px-10 py-4 text-black font-bold text-base hover:bg-amber-300 transition-colors">
          ▶ 进入战场
        </button>
      </section>

      {/* Footer */}
      <footer className="py-4 px-6 border-t-2 border-amber-900/40 flex items-center justify-between text-[10px] text-slate-700">
        <span>© 2025 孔明传 · SkillLite</span>
        <span>三国 AI 演武场 · NES 像素风</span>
      </footer>
    </div>
  );
}

