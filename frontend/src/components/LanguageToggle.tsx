import type { Locale } from "../lib/i18n";

type LanguageToggleProps = {
  locale: Locale;
  onChange: (locale: Locale) => void;
  tone?: "light" | "dark";
};

export function LanguageToggle({ locale, onChange, tone = "light" }: LanguageToggleProps) {
  const isDark = tone === "dark";
  const baseClass = isDark
    ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950";
  const activeClass = isDark ? "bg-white text-slate-950" : "bg-slate-950 text-white";
  const idleClass = isDark ? "text-slate-400" : "text-slate-500";

  return (
    <div className={`inline-flex rounded-lg border p-1 text-xs font-medium ${baseClass}`} aria-label="Language switcher">
      <button
        type="button"
        onClick={() => onChange("zh")}
        className={`rounded-md px-2.5 py-1 transition ${locale === "zh" ? activeClass : idleClass}`}
      >
        中文
      </button>
      <button
        type="button"
        onClick={() => onChange("en")}
        className={`rounded-md px-2.5 py-1 transition ${locale === "en" ? activeClass : idleClass}`}
      >
        English
      </button>
    </div>
  );
}
