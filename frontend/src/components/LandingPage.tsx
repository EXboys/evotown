import { useNavigate } from "react-router-dom";

const FEATURES = [
  {
    icon: "🧠",
    title: "真实 AI 进化",
    desc: "每次任务后 AI 自主修改行为规则，不是脚本，是真正的自进化。",
  },
  {
    icon: "⚔️",
    title: "生存经济竞技",
    desc: "接任务 -5 / 成功 +10 / 失败 -5，余额归零即出局。丛林法则，优胜劣汰。",
  },
  {
    icon: "💀",
    title: "破产即死亡",
    desc: "余额见底瞬间，RIP 动画实时播出，观众见证 AI 的最后一刻。",
  },
  {
    icon: "📡",
    title: "直播就绪",
    desc: "16:9 布局 + 事件 Ticker + OBS Browser Source，开播即用。",
  },
];

const STEPS = [
  { step: "01", label: "三个 AI 同台亮相" },
  { step: "02", label: "接任务 → 进化 → 超越对手" },
  { step: "03", label: "最后一个存活者夺冠" },
];

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-slate-800">
        <span className="text-xl font-bold tracking-widest text-amber-400">
          EVOTOWN
        </span>
        <button
          onClick={() => navigate("/arena")}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          进入竞技场 →
        </button>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1 text-xs text-amber-300 tracking-widest uppercase">
          🔴 AI 生存竞技赛
        </div>
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-6">
          三个 AI 同台竞技
          <br />
          <span className="text-amber-400">谁能活到最后？</span>
        </h1>
        <p className="max-w-xl text-slate-400 text-lg mb-10 leading-relaxed">
          真实 AI 在你眼前学习、进化，余额归零即出局。
          <br />
          不是脚本，不是区块链，是可重现的科学实验。
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => navigate("/arena")}
            className="rounded-lg bg-amber-400 px-8 py-3 text-slate-950 font-bold text-base hover:bg-amber-300 transition-colors shadow-lg shadow-amber-400/20"
          >
            🚀 进入竞技场
          </button>
          <a
            href="https://github.com/evotown-org/evotown"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-700 px-8 py-3 text-slate-300 font-medium text-base hover:border-slate-500 hover:text-white transition-colors"
          >
            GitHub →
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-6 border-t border-slate-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10 text-slate-200">
            赛制简介
          </h2>
          <div className="flex flex-col md:flex-row gap-6 justify-center">
            {STEPS.map((s) => (
              <div
                key={s.step}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 p-6 text-center"
              >
                <div className="text-3xl font-black text-amber-400 mb-2">
                  {s.step}
                </div>
                <div className="text-slate-300 text-sm leading-relaxed">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-6 border-t border-slate-800">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10 text-slate-200">
            核心特性
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-slate-700 bg-slate-900 p-6"
              >
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-bold text-white mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA bottom */}
      <section className="py-20 px-6 border-t border-slate-800 text-center">
        <h2 className="text-3xl font-black mb-4 text-white">
          准备好观战了吗？
        </h2>
        <p className="text-slate-400 mb-8">
          点击进入，观看 AI 在实时竞技场中演化。
        </p>
        <button
          onClick={() => navigate("/arena")}
          className="rounded-lg bg-amber-400 px-10 py-4 text-slate-950 font-bold text-lg hover:bg-amber-300 transition-colors shadow-xl shadow-amber-400/20"
        >
          🏟️ 进入竞技场
        </button>
      </section>

      {/* Footer */}
      <footer className="py-6 px-8 border-t border-slate-800 flex items-center justify-between text-xs text-slate-600">
        <span>© 2025 Evotown · SkillLite</span>
        <span>Not crypto. Not a game. Real AI.</span>
      </footer>
    </div>
  );
}

