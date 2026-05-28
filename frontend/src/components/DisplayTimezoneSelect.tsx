import { useCallback } from "react";
import { adminFetch, isConsoleAuthenticated } from "../hooks/useAdminToken";
import { useDisplayTimezone } from "../hooks/useDisplayTimezone";
import { TIMEZONE_OPTIONS, timezoneOptionLabel } from "../lib/datetime";

type Props = {
  className?: string;
  /** inline：工具条一行；card：侧栏底部卡片 */
  layout?: "inline" | "card";
  /** 配色：slate=协作地图侧栏，dark=企业管理侧栏，light=浅色页头 */
  tone?: "slate" | "dark" | "light";
};

function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TONE_STYLES = {
  slate: {
    card: "border-slate-600/40 bg-slate-900/50",
    label: "text-slate-400",
    hint: "text-slate-500",
    select: "border-slate-600/50 bg-slate-950/80 text-slate-200 focus:ring-sky-500/40",
    icon: "text-sky-400/90",
  },
  dark: {
    card: "border-white/10 bg-white/[0.04]",
    label: "text-slate-300",
    hint: "text-slate-500",
    select: "border-white/10 bg-slate-900/80 text-slate-100 focus:ring-blue-500/50",
    icon: "text-sky-400",
  },
  light: {
    card: "border-slate-200 bg-slate-50/90",
    label: "text-slate-600",
    hint: "text-slate-400",
    select: "border-slate-200 bg-white text-slate-800 shadow-sm focus:ring-violet-500/30",
    icon: "text-violet-600",
  },
} as const;

export function DisplayTimezoneSelect({
  className = "",
  layout = "inline",
  tone = "slate",
}: Props) {
  const { timezone, setTimezone } = useDisplayTimezone();
  const styles = TONE_STYLES[tone];

  const onChange = useCallback(
    (tz: string) => {
      setTimezone(tz);
      if (isConsoleAuthenticated()) {
        adminFetch("/config/display", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timezone: tz }),
        }).catch(() => {});
      }
    },
    [setTimezone]
  );

  const options = TIMEZONE_OPTIONS.some((o) => o.id === timezone)
    ? TIMEZONE_OPTIONS
    : [{ id: timezone, label: timezoneOptionLabel(timezone) }, ...TIMEZONE_OPTIONS];

  const selectEl = (
    <div className="relative min-w-0 flex-1">
      <select
        value={timezone}
        onChange={(e) => onChange(e.target.value)}
        title="界面时间按此时区显示；数据仍以 UTC 存储"
        className={`w-full appearance-none rounded-lg border py-2 pl-3 pr-9 text-xs font-medium transition focus:outline-none focus:ring-2 ${styles.select}`}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );

  if (layout === "card") {
    return (
      <div className={`rounded-xl border p-3 ${styles.card} ${className}`}>
        <div className="mb-2 flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 ${styles.icon}`}>
            <ClockIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className={`text-xs font-medium ${styles.label}`}>显示时区</div>
            <div className={`text-[10px] ${styles.hint}`}>列表与日报时间</div>
          </div>
        </div>
        {selectEl}
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <ClockIcon className={`h-3.5 w-3.5 shrink-0 ${styles.icon}`} />
      <span className={`shrink-0 text-[10px] font-medium ${styles.label}`}>时区</span>
      {selectEl}
    </div>
  );
}
