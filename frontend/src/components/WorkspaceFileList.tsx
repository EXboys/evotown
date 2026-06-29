import { formatBytes, fileMeta } from "../lib/codingAgentUtils";

export type WorkspaceFileEntry = {
  path: string;
  name: string;
  size: number;
  is_dir?: boolean;
  modified_at?: string | null;
};

type Props = {
  entries: WorkspaceFileEntry[];
  loading?: boolean;
  truncated?: boolean;
  showSystemFiles: boolean;
  onToggleSystemFiles: () => void;
  onOpenFile: (path: string) => void;
  onEnterDir?: (path: string) => void;
  fileLoadingPath?: string;
  compact?: boolean;
  selectable?: boolean;
  selectedPaths?: Set<string>;
  onToggleSelect?: (path: string) => void;
};

export function WorkspaceFileList({
  entries,
  loading,
  truncated,
  showSystemFiles,
  onToggleSystemFiles,
  onOpenFile,
  onEnterDir,
  fileLoadingPath = "",
  compact = false,
  selectable = false,
  selectedPaths,
  onToggleSelect,
}: Props) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`font-medium text-slate-700 ${compact ? "text-xs" : "text-sm"}`}>工作区文件</span>
        <button
          type="button"
          onClick={onToggleSystemFiles}
          className="text-[10px] text-indigo-600 hover:text-indigo-800"
        >
          {showSystemFiles ? "隐藏系统文件" : "显示系统文件"}
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
          暂无文件。派发任务或上传附件后会出现在这里。
        </div>
      ) : (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {entries.map((entry) => {
            if (entry.is_dir) {
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => onEnterDir?.(entry.path)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <span className="text-base">📁</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-900">{entry.path}</span>
                    <span className="block text-[10px] text-slate-400">文件夹</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-300">›</span>
                </button>
              );
            }
            const meta = fileMeta(entry.path);
            const selected = selectable && selectedPaths?.has(entry.path);
            return (
              <div
                key={entry.path}
                className={`flex w-full items-center gap-2 rounded-lg border bg-white px-2.5 py-2 transition ${
                  selected ? "border-indigo-400 bg-indigo-50/60" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                }`}
              >
                {selectable ? (
                  <input
                    type="checkbox"
                    checked={!!selected}
                    onChange={() => onToggleSelect?.(entry.path)}
                    className="shrink-0 rounded border-slate-300"
                    aria-label={`选择 ${entry.path}`}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenFile(entry.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-base" aria-hidden>
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-900">{entry.path}</span>
                    <span className="block text-[10px] text-slate-400">
                      {meta.label} · {formatBytes(entry.size)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-300">
                    {fileLoadingPath === entry.path ? "…" : "›"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {truncated ? (
        <p className="mt-1.5 text-[10px] text-amber-600">文件较多，仅显示前 {entries.length} 项</p>
      ) : null}
    </div>
  );
}
