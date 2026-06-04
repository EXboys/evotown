import { useEffect, useState } from "react";

export type Locale = "zh" | "en";

const LOCALE_STORAGE_KEY = "evotown_locale";

function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  return value.toLowerCase().startsWith("zh") ? "zh" : value.toLowerCase().startsWith("en") ? "en" : null;
}

function initialLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
    ?? normalizeLocale(window.navigator.language)
    ?? "zh";
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    }
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    }
  }, [locale]);

  return {
    locale,
    setLocale,
    toggleLocale: () => setLocale(locale === "zh" ? "en" : "zh"),
  };
}
