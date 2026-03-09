/**
 * 📜 三国·进化演绎 — 章节式史书展示
 *
 * 仿《三国演义》回目布局：
 *   左栏：章节目录（第N回 · 日期）
 *   右栏：正文（文言文战报全文 + 武将军功表）
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminFetch } from "../hooks/useAdminToken";

interface ChronicleListItem {
  chapter: number;
  chapter_label: string;
  virtual_date: string;
  generated_at: string;
  total_tasks: number;
  preview: string;
}

interface AgentStat {
  agent_id: string;
  display_name: string;
  completed: number;
  failed: number;
  total_reward: number;
  best_task: string;
}

interface ChronicleDetail {
  chapter?: number;
  chapter_label?: string;
  virtual_date?: string;
  generated_at: string;
  title?: string;
  text: string;
  summary: { total_tasks: number; total_completed: number; total_failed: number };
  agent_stats: AgentStat[];
}

function formatChapterTitle(item: ChronicleListItem): string {
  return `${item.chapter_label || `第${item.chapter}回`} · ${item.virtual_date || ""}`;
}

function RewardBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${pos ? "bg-amber-500/20 text-amber-300" : "bg-red-500/20 text-red-400"}`}>
      {pos ? "+" : ""}{value}
    </span>
  );
}

export function ChronicleBook() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState<ChronicleListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const urlChapter = searchParams.get("chapter");
  const parsedUrl = urlChapter ? parseInt(urlChapter, 10) : NaN;
  const [selectedChapter, setSelectedChapter] = useState<number | null>(
    !isNaN(parsedUrl) ? parsedUrl : null
  );
  const [detail, setDetail] = useState<ChronicleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  const handleSelectChapter = useCallback((chapter: number) => {
    setSelectedChapter(chapter);
    setSearchParams({ chapter: String(chapter) }, { replace: true });
  }, [setSearchParams]);

  const loadList = useCallback(() => {
    setLoadingList(true);
    fetch(`/api/chronicle`)
      .then((r) => r.json())
      .then((data) => {
        setList(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) {
          const urlCh = searchParams.get("chapter");
          const urlChapterNum = urlCh ? parseInt(urlCh, 10) : NaN;
          const validUrl = !isNaN(urlChapterNum) && data.some((i: ChronicleListItem) => i.chapter === urlChapterNum);
          setSelectedChapter((prev) => (prev != null ? prev : validUrl ? urlChapterNum : data[0].chapter));
        }
      })
      .catch(() => setList([]))
      .finally(() => setLoadingList(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    if (selectedChapter == null) return;
    setLoadingDetail(true);
    setDetail(null);
    fetch(`/api/chronicle/${selectedChapter}`)
      .then((r) => r.json())
      .then((data) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedChapter]);

  const handleRegenerate = async (chapter: number) => {
    setRegenerating(true);
    setGenMsg("");
    try {
      const r = await adminFetch(`/api/chronicle/${chapter}/regenerate`, { method: "POST" });
      if (!r.ok) {
        const errText = await r.text().catch(() => r.statusText);
        setGenMsg(`❌ 重新生成失败 (${r.status})：${errText.slice(0, 120)}`);
        return;
      }
      const data = await r.json();
      setGenMsg(`✅ 已重新生成 ${data.chapter_label || `第${data.chapter}回`} 战报`);
      loadList();
      setDetail(null);
      setLoadingDetail(true);
      const res = await fetch(`/api/chronicle/${chapter}`);
      const updated = await res.json();
      setDetail(updated);
    } catch (e) {
      setGenMsg(`❌ 网络错误：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegenerating(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenMsg("");
    try {
      const r = await adminFetch(`/api/chronicle/generate`, { method: "POST", body: JSON.stringify({}) });
      if (!r.ok) {
        const errText = await r.text().catch(() => r.statusText);
        setGenMsg(`❌ 生成失败 (${r.status})：${errText.slice(0, 120)}`);
        return;
      }
      const data = await r.json();
      setGenMsg(`✅ 已生成 ${data.chapter_label || `第${data.chapter}回`} 战报`);
      loadList();
      if (data.chapter != null) handleSelectChapter(data.chapter);
    } catch (e) {
      setGenMsg(`❌ 网络错误：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0b07] text-[#e8d5a3] flex flex-col" style={{ fontFamily: "'Noto Serif SC', 'Source Han Serif CN', serif" }}>
      {/* 顶部书脊 */}
      <header className="flex items-center justify-between px-8 py-3 border-b border-amber-900/50 bg-[#13100a]">
        <button onClick={() => navigate("/")} className="text-amber-600 hover:text-amber-400 text-sm transition-colors">← 返回</button>
        <div className="text-center">
          <div className="text-xs tracking-[0.4em] text-amber-700 uppercase mb-0.5">Evolution Town · Three Kingdoms</div>
          <h1 className="text-lg font-bold tracking-[0.25em] text-amber-300">三 国 · 进 化 演 绎</h1>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs px-3 py-1.5 rounded border border-amber-800 text-amber-600 hover:border-amber-500 hover:text-amber-300 transition-colors disabled:opacity-40"
        >
          {generating ? "生成中…" : "手动生成战报"}
        </button>
      </header>
      {genMsg && (
        <div className="text-center text-xs py-1.5 bg-amber-900/20 text-amber-400 border-b border-amber-900/30">{genMsg}</div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* 左侧目录 — 时间线样式 */}
        <aside className="w-56 shrink-0 border-r border-amber-900/40 bg-[#0f0c08] overflow-y-auto">
          <div className="px-4 py-3 text-xs text-amber-700 tracking-widest border-b border-amber-900/30 flex items-center gap-2">
            <span className="w-px h-3 bg-amber-800/60" />
            <span>战 报 时 间 线</span>
          </div>
          {loadingList && <div className="px-4 py-6 text-amber-800 text-xs animate-pulse">加载中…</div>}
          {!loadingList && list.length === 0 && (
            <div className="px-4 py-6 text-amber-800/60 text-xs text-center leading-relaxed">
              尚无战报<br/>点击右上角生成
            </div>
          )}
          {/* Timeline container */}
          <div className="relative">
            {/* Vertical connecting line */}
            {list.length > 1 && (
              <div className="absolute left-[22px] top-5 bottom-5 w-px bg-amber-900/35 pointer-events-none" />
            )}
            {list.map((item, idx) => {
              const isSelected = selectedChapter === item.chapter;
              const isLatest = idx === 0;
              return (
                <button
                  key={item.chapter}
                  onClick={() => handleSelectChapter(item.chapter)}
                  className={`w-full text-left py-3 pr-3 pl-3 border-b border-amber-900/20 transition-colors group relative ${
                    isSelected ? "bg-amber-900/30" : "hover:bg-amber-900/15"
                  }`}
                >
                  {/* Timeline dot */}
                  <div className={`absolute left-[17px] top-[18px] w-[11px] h-[11px] rounded-full z-10 transition-all ${
                    isSelected
                      ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                      : isLatest
                        ? "bg-amber-700 border border-amber-600 animate-pulse"
                        : "bg-[#1a1409] border border-amber-800/60"
                  }`} />
                  <div className="pl-6 min-w-0">
                    {isLatest && (
                      <span className="inline-block text-[9px] bg-amber-600/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-700/40 mb-1 tracking-wide leading-none">
                        最新
                      </span>
                    )}
                    <div className={`text-xs font-bold mb-1 leading-snug ${isSelected ? "text-amber-300" : "text-amber-700 group-hover:text-amber-500"}`}>
                      {formatChapterTitle(item)}
                    </div>
                    <div className="text-[10px] text-amber-800/80 leading-relaxed line-clamp-2">{item.preview || "（无预览）"}</div>
                    <div className="text-[9px] text-amber-900/50 mt-1">军令 {item.total_tasks} 条</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 右侧正文 */}
        <main className="flex-1 overflow-y-auto px-10 py-8 max-w-3xl mx-auto">
          {selectedChapter == null && !loadingList && (
            <div className="text-center mt-32 text-amber-800/50 text-sm tracking-widest">选择左侧章节以阅读史记</div>
          )}
          {loadingDetail && (
            <div className="text-center mt-32 text-amber-700 text-sm animate-pulse tracking-widest">载入战报中…</div>
          )}
          {detail && !loadingDetail && selectedChapter != null && (
            <ChapterContent
              detail={detail}
              chapterNum={detail.chapter ?? list.length - list.findIndex((i) => i.chapter === selectedChapter)}
              onRegenerate={() => handleRegenerate(selectedChapter)}
              regenerating={regenerating}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ChapterContent({
  detail,
  chapterNum,
  onRegenerate,
  regenerating,
}: {
  detail: ChronicleDetail;
  chapterNum: number;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const chNums = ["零","一","二","三","四","五","六","七","八","九","十","十一","十二","十三","十四","十五","十六","十七","十八","十九","二十"];
  const genTime = detail.generated_at ? new Date(detail.generated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
  const fallbackTitle = detail.virtual_date ? `${detail.virtual_date} · 战场实录` : "战场实录";
  return (
    <article>
      {/* 回目标题 */}
      <div className="text-center mb-8">
        <div className="text-xs text-amber-700 tracking-[0.5em] mb-3">{detail.chapter_label ?? `第${chNums[chapterNum] ?? chapterNum}回`}</div>
        {detail.title ? (
          /* 有 LLM 生成的回目标题：上下句竖排展示 */
          <div className="flex flex-col items-center gap-1 mb-2">
            {detail.title.split(" ").filter(Boolean).map((line, i) => (
              <div key={i} className="text-xl font-bold text-amber-300 tracking-[0.25em]">{line}</div>
            ))}
          </div>
        ) : (
          /* 旧战报无标题时兜底 */
          <div className="text-xl font-bold text-amber-300 tracking-[0.2em] mb-1">{fallbackTitle}</div>
        )}
        <div className="flex items-center justify-center gap-4 mt-2">
          <span className="text-xs text-amber-800">{genTime && `说书人注：录于 ${genTime}`}</span>
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="text-xs px-2.5 py-1 rounded border border-amber-800/60 text-amber-600 hover:border-amber-500 hover:text-amber-400 transition-colors disabled:opacity-40"
          >
            {regenerating ? "重新生成中…" : "重新生成"}
          </button>
        </div>
        <div className="mt-4 border-t border-amber-900/40" />
      </div>

      {/* 统计徽章 */}
      <div className="flex gap-4 justify-center mb-8 flex-wrap">
        {[
          { label: "军令", value: detail.summary.total_tasks },
          { label: "告捷", value: detail.summary.total_completed },
          { label: "兵败", value: detail.summary.total_failed },
        ].map(({ label, value }) => (
          <div key={label} className="text-center px-5 py-2 border border-amber-900/40 rounded bg-amber-900/10">
            <div className="text-xl font-bold text-amber-300">{value}</div>
            <div className="text-[10px] text-amber-700 tracking-widest">{label}</div>
          </div>
        ))}
      </div>

      {/* 战报正文 */}
      <div
        className="leading-[2.2] text-[#d4b87a] text-[15px] mb-10 whitespace-pre-wrap tracking-[0.05em]"
        style={{ textIndent: "2em" }}
      >
        {detail.text || "（战报内容为空）"}
      </div>

      {/* 武将军功录 */}
      {detail.agent_stats && detail.agent_stats.length > 0 && (
        <section className="mt-4">
          <div className="text-center text-sm text-amber-600 tracking-[0.4em] mb-4 border-t border-amber-900/30 pt-6">— 武 将 军 功 录 —</div>
          <div className="space-y-2">
            {detail.agent_stats.map((s, i) => (
              <div key={s.agent_id} className="flex items-center gap-3 px-4 py-2.5 rounded border border-amber-900/25 bg-amber-900/8 hover:bg-amber-900/15 transition-colors">
                <span className="text-amber-800 text-xs w-5 text-right shrink-0">{i + 1}</span>
                <span className="font-bold text-amber-200 w-16 shrink-0">{s.display_name}</span>
                <RewardBadge value={s.total_reward} />
                <span className="text-amber-800/70 text-xs">告捷 {s.completed} · 兵败 {s.failed}</span>
                {s.best_task && <span className="ml-auto text-[11px] text-amber-800/50 truncate max-w-[200px]" title={s.best_task}>最佳：{s.best_task}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-12 text-center text-amber-900/40 text-xs tracking-widest">— 卷终 —</div>
    </article>
  );
}

