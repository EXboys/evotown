/**
 * 企业运行日报 — 按期汇总 Agent 运行与协作实录
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminFetch } from "../hooks/useAdminToken";
import { formatDateTimeShort } from "../lib/datetime";
import { DisplayTimezoneSelect } from "./DisplayTimezoneSelect";

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

function formatPeriodTitle(item: ChronicleListItem): string {
  const label = item.chapter_label || `第 ${item.chapter} 期`;
  return item.virtual_date ? `${label} · ${item.virtual_date}` : label;
}

function MetricBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-center shadow-sm">
      <div className="text-2xl font-semibold tabular-nums text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function RewardBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pos ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-red-50 text-red-600 ring-1 ring-red-100"}`}>
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
        setGenMsg(`重新生成失败 (${r.status})：${errText.slice(0, 120)}`);
        return;
      }
      const data = await r.json();
      setGenMsg(`已重新生成 ${data.chapter_label || `第 ${data.chapter} 期`} 运行日报`);
      loadList();
      setDetail(null);
      setLoadingDetail(true);
      const res = await fetch(`/api/chronicle/${chapter}`);
      const updated = await res.json();
      setDetail(updated);
    } catch (e) {
      setGenMsg(`网络错误：${e instanceof Error ? e.message : String(e)}`);
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
        setGenMsg(`生成失败 (${r.status})：${errText.slice(0, 120)}`);
        return;
      }
      const data = await r.json();
      setGenMsg(`已生成 ${data.chapter_label || `第 ${data.chapter} 期`} 运行日报`);
      loadList();
      if (data.chapter != null) handleSelectChapter(data.chapter);
    } catch (e) {
      setGenMsg(`网络错误：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-900" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <button onClick={() => navigate("/arena")} className="text-sm text-slate-500 transition-colors hover:text-slate-800">← 协作地图</button>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Evotown Operations</div>
            <h1 className="text-lg font-semibold text-slate-950">企业运行日报</h1>
          </div>
          <div className="flex items-center gap-3">
            <DisplayTimezoneSelect tone="light" className="min-w-[200px]" />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-40"
            >
              {generating ? "生成中…" : "生成日报"}
            </button>
          </div>
        </div>
      </header>

      {genMsg && (
        <div className="border-b border-sky-100 bg-sky-50 py-2 text-center text-xs text-sky-800">{genMsg}</div>
      )}

      <div className="mx-auto flex min-h-[calc(100vh-65px)] max-w-6xl">
        <aside className="w-72 shrink-0 border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            日报时间线
          </div>
          {loadingList && <div className="px-4 py-6 text-xs text-slate-400 animate-pulse">加载中…</div>}
          {!loadingList && list.length === 0 && (
            <div className="px-4 py-8 text-center text-xs leading-relaxed text-slate-500">
              尚无运行日报<br />点击右上角生成
            </div>
          )}
          <div className="relative">
            {list.length > 1 && (
              <div className="pointer-events-none absolute bottom-5 left-[22px] top-5 w-px bg-slate-200" />
            )}
            {list.map((item, idx) => {
              const isSelected = selectedChapter === item.chapter;
              const isLatest = idx === 0;
              return (
                <button
                  key={item.chapter}
                  onClick={() => handleSelectChapter(item.chapter)}
                  className={`relative w-full border-b border-slate-100 py-3 pl-3 pr-3 text-left transition-colors ${
                    isSelected ? "bg-violet-50/80" : "hover:bg-slate-50"
                  }`}
                >
                  <div className={`absolute left-[17px] top-[18px] z-10 h-[11px] w-[11px] rounded-full transition-all ${
                    isSelected
                      ? "bg-violet-500 shadow-[0_0_0_4px_rgba(139,92,246,0.15)]"
                      : isLatest
                        ? "border border-violet-400 bg-violet-100"
                        : "border border-slate-300 bg-white"
                  }`} />
                  <div className="min-w-0 pl-6">
                    {isLatest && (
                      <span className="mb-1 inline-block rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700">
                        最新
                      </span>
                    )}
                    <div className={`mb-1 text-xs font-semibold leading-snug ${isSelected ? "text-violet-900" : "text-slate-700"}`}>
                      {formatPeriodTitle(item)}
                    </div>
                    <div className="line-clamp-2 text-[11px] leading-relaxed text-slate-500">{item.preview || "（无预览）"}</div>
                    <div className="mt-1 text-[10px] text-slate-400">任务 {item.total_tasks} 条 · {formatDateTimeShort(item.generated_at)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">
          {selectedChapter == null && !loadingList && (
            <div className="mt-32 text-center text-sm text-slate-500">选择左侧期次查看运行日报</div>
          )}
          {loadingDetail && (
            <div className="mt-32 text-center text-sm text-slate-400 animate-pulse">载入日报中…</div>
          )}
          {detail && !loadingDetail && selectedChapter != null && (
            <ChapterContent
              detail={detail}
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
  onRegenerate,
  regenerating,
}: {
  detail: ChronicleDetail;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const fallbackTitle = detail.virtual_date ? `${detail.virtual_date} 运行摘要` : "运行摘要";
  return (
    <article className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-violet-600">
              {detail.chapter_label ?? "运行日报"}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {detail.title || fallbackTitle}
            </h2>
            {detail.virtual_date && (
              <p className="mt-2 text-sm text-slate-500">报告周期：{detail.virtual_date}</p>
            )}
          </div>
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-violet-300 hover:text-violet-700 disabled:opacity-40"
          >
            {regenerating ? "重新生成中…" : "重新生成"}
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MetricBadge label="任务" value={detail.summary.total_tasks} />
          <MetricBadge label="完成" value={detail.summary.total_completed} />
          <MetricBadge label="失败" value={detail.summary.total_failed} />
        </div>

        <div className="mt-6 border-t border-slate-100 pt-6 text-[15px] leading-7 text-slate-700 whitespace-pre-wrap">
          {detail.text || "（日报内容为空）"}
        </div>

        {detail.generated_at && (
          <p className="mt-6 text-xs text-slate-400">生成于 {formatDateTimeShort(detail.generated_at)}</p>
        )}
      </div>

      {detail.agent_stats && detail.agent_stats.length > 0 && (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-950">Agent 贡献统计</h3>
          <p className="mt-1 text-xs text-slate-500">本期各 Agent 任务完成与绩效概览</p>
          <div className="mt-4 space-y-2">
            {detail.agent_stats.map((s, i) => (
              <div key={s.agent_id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <span className="w-5 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
                <span className="w-24 shrink-0 truncate font-medium text-slate-900">{s.display_name}</span>
                <RewardBadge value={s.total_reward} />
                <span className="text-xs text-slate-500">完成 {s.completed} · 失败 {s.failed}</span>
                {s.best_task && (
                  <span className="ml-auto max-w-[220px] truncate text-[11px] text-slate-400" title={s.best_task}>
                    代表任务：{s.best_task}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
