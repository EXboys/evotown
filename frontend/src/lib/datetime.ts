/** 显示时区：存储仍用 UTC ISO；展示按用户选择的 IANA 时区格式化 */

export const DISPLAY_TIMEZONE_STORAGE_KEY = "evotown.displayTimezone";
export const DISPLAY_TIMEZONE_EVENT = "evotown:display-timezone-change";

export const TIMEZONE_OPTIONS: { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "Asia/Shanghai", label: "中国（北京）" },
  { id: "Asia/Hong_Kong", label: "香港" },
  { id: "Asia/Tokyo", label: "东京" },
  { id: "Asia/Singapore", label: "新加坡" },
  { id: "Europe/London", label: "伦敦" },
  { id: "Europe/Paris", label: "巴黎" },
  { id: "America/New_York", label: "纽约" },
  { id: "America/Los_Angeles", label: "洛杉矶" },
  { id: "Australia/Sydney", label: "悉尼" },
];

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function isValidTimezone(tz: string): boolean {
  if (!tz?.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getDisplayTimezone(): string {
  try {
    const stored = localStorage.getItem(DISPLAY_TIMEZONE_STORAGE_KEY);
    if (stored && isValidTimezone(stored)) return stored;
  } catch {
    /* private mode */
  }
  const browser = getBrowserTimezone();
  return isValidTimezone(browser) ? browser : "UTC";
}

export function setDisplayTimezone(tz: string): void {
  if (!isValidTimezone(tz)) {
    throw new Error(`Invalid timezone: ${tz}`);
  }
  localStorage.setItem(DISPLAY_TIMEZONE_STORAGE_KEY, tz);
  window.dispatchEvent(new CustomEvent(DISPLAY_TIMEZONE_EVENT, { detail: tz }));
}

export function parseEvotownTimestamp(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let s = String(value).trim();
  // 后端 SQLite datetime('now') 产生的字符串不带时区标记，
  // 浏览器会当作本地时间解析导致偏移。统一补 Z 当作 UTC。
  if (s && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s + "Z";
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type FormatDateTimeOptions = Intl.DateTimeFormatOptions & {
  locale?: string;
  /** 无法解析时返回；默认 "-" */
  fallback?: string;
};

export function formatDateTime(
  value: string | number | null | undefined,
  options?: FormatDateTimeOptions
): string {
  const { locale = "zh-CN", fallback = "-", ...intlOpts } = options ?? {};
  const d = parseEvotownTimestamp(value);
  if (!d) {
    if (fallback === "" && typeof value === "string" && value) return value;
    return fallback;
  }
  const tz = getDisplayTimezone();
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, hour12: false, ...intlOpts }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** 日期 + 时间（常用列表） */
export function formatDateTimeShort(value: string | number | null | undefined): string {
  return formatDateTime(value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 仅日期 */
export function formatDateOnly(value: string | number | null | undefined): string {
  return formatDateTime(value, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 仅时间 */
export function formatTimeOnly(value: string | number | null | undefined): string {
  return formatDateTime(value, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 图表轴：月/日 */
export function formatChartDay(value: string | number | null | undefined): string {
  return formatDateTime(value, { month: "numeric", day: "numeric" });
}

/** yyyy-MM-dd HH:mm 固定格式 */
export function formatDateTimeFull(value: string | number | null | undefined): string {
  const d = parseEvotownTimestamp(value);
  if (!d) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timezoneOptionLabel(tz: string): string {
  return TIMEZONE_OPTIONS.find((o) => o.id === tz)?.label ?? tz;
}

/** 无本地偏好时，用服务器默认（如日报周期标签） */
export async function initDisplayTimezoneFromServer(): Promise<void> {
  try {
    if (localStorage.getItem(DISPLAY_TIMEZONE_STORAGE_KEY)) return;
    const res = await fetch("/config/display");
    if (!res.ok) return;
    const data = (await res.json()) as { timezone?: string };
    if (data.timezone && isValidTimezone(data.timezone)) {
      localStorage.setItem(DISPLAY_TIMEZONE_STORAGE_KEY, data.timezone);
      window.dispatchEvent(new CustomEvent(DISPLAY_TIMEZONE_EVENT, { detail: data.timezone }));
    }
  } catch {
    /* offline */
  }
}
