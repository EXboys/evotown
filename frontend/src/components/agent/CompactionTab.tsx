/** 记忆压缩记录 — 按 agent 单独展示，不混在任务明细中。
 * 压缩由 SkillLite 自动执行并写入磁盘（transcript 文件），不是仅内存；达到阈值（默认 16 条对话）时自动触发。 */
import { useState, useEffect } from "react";

export interface CompactionItem {
  id: string;
  parent_id?: string | null;
  first_kept_entry_id?: string;
  tokens_before?: number;
  summary: string;
}

const SUMMARY_PREVIEW_LEN = 280;

type DebugInfo = {
  transcript_dir?: string;
  chat_root_used?: string;
  exists?: boolean;
  file_count?: number;
  file_names?: string[];
  message_count?: number;
  compaction_count?: number;
  compaction_count_all_files?: number;
  hint?: string;
  error?: string;
};

export function CompactionTab({ agentId, compactions }: { agentId: string; compactions: CompactionItem[] }) {
  const [debug, setDebug] = useState<DebugInfo | null>(null);

  useEffect(() => {
    if (compactions.length > 0) {
      setDebug(null);
      return;
    }
    let cancelled = false;
    fetch(`/agents/${agentId}/compactions/debug`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDebug(d); })
      .catch(() => { if (!cancelled) setDebug(null); });
    return () => { cancelled = true; };
  }, [agentId, compactions.length]);

  if (compactions.length === 0) {
    return (
      <div className="text-sm text-slate-500 space-y-3">
        <p className="italic">该 Agent 暂无记忆压缩记录。</p>
        <p className="text-xs text-slate-600">
          <strong>说明：</strong>压缩是自动的且写入磁盘（transcript 文件），不是仅内存。
          当对话条数达到阈值（默认 16 条）时，SkillLite 会自动执行压缩并在此显示。
        </p>
        {debug && (
          <div className="rounded-lg border border-slate-600/40 bg-slate-800/30 p-3 text-xs space-y-1.5">
            {debug.hint && <p className="text-amber-400/90">{debug.hint}</p>}
            {debug.chat_root_used != null && (
              <p className="text-slate-500 font-mono truncate" title={debug.chat_root_used}>
                chat_root: {debug.chat_root_used || "—"}
              </p>
            )}
            {debug.transcript_dir != null && (
              <p className="text-slate-500 font-mono truncate" title={debug.transcript_dir}>
                transcript 目录: {debug.exists ? "存在" : "不存在"} — {debug.transcript_dir || "—"}
              </p>
            )}
            {debug.file_count != null && debug.message_count != null && (
              <p className="text-slate-500">
                transcript 文件数: {debug.file_count}，对话条数: {debug.message_count}
                {debug.compaction_count != null && `，按 session_key 压缩记录: ${debug.compaction_count}`}
                {debug.compaction_count_all_files != null && `，全部文件压缩记录: ${debug.compaction_count_all_files}`}
              </p>
            )}
            {debug.file_names != null && debug.file_names.length > 0 && (
              <p className="text-slate-500" title={debug.file_names.join("\n")}>
                文件名: {debug.file_names.slice(0, 5).join(", ")}
                {debug.file_names.length > 5 ? ` 等 ${debug.file_names.length} 个` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        共 {compactions.length} 次压缩（仅展示本 Agent 的 transcript 中的 compaction 条目）
      </p>
      <ul className="space-y-3">
        {compactions.map((c, i) => (
          <CompactionCard key={c.id || i} item={c} index={i} />
        ))}
      </ul>
    </div>
  );
}

function CompactionCard({ item, index }: { item: CompactionItem; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const summary = item.summary || "";
  const showExpand = summary.length > SUMMARY_PREVIEW_LEN;
  const displaySummary = expanded ? summary : summary.slice(0, SUMMARY_PREVIEW_LEN) + (showExpand ? "…" : "");

  return (
    <li className="rounded-xl border border-slate-600/50 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-800/50 border-b border-slate-600/30">
        <span className="text-[10px] font-mono text-slate-400 truncate" title={item.id}>
          #{index + 1} {item.id ? item.id.slice(0, 8) + "…" : "—"}
        </span>
        {item.tokens_before != null && (
          <span className="text-[10px] text-amber-500/90 shrink-0">
            压缩前约 {item.tokens_before.toLocaleString()} tokens
          </span>
        )}
      </div>
      <div className="p-3 text-xs">
        <pre className="whitespace-pre-wrap break-words text-slate-300 font-sans leading-relaxed">
          {displaySummary || "(无摘要)"}
        </pre>
        {showExpand && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-2 text-[10px] text-amber-400 hover:text-amber-300"
          >
            {expanded ? "收起" : "展开全文"}
          </button>
        )}
      </div>
    </li>
  );
}
