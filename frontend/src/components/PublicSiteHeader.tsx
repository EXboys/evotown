import { Link, useLocation, useNavigate } from "react-router-dom";

import { clearConsoleSession, isAdmin, isConsoleAuthenticated } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";
import { LanguageToggle } from "./LanguageToggle";

const HEADER_COPY = {
  zh: {
    brand: "Evotown",
    subtitle: { default: "Enterprise Agent Platform", market: "Skills 市场" },
    nav: {
      home: "首页",
      arena: "协作地图",
      market: "Skills 市场",
      knowledge: "知识库",
      admin: "企业后台",
    },
    signedIn: "已登录",
    logout: "退出登录",
    login: "登录",
    openConsole: "企业后台",
  },
  en: {
    brand: "Evotown",
    subtitle: { default: "Enterprise Agent Platform", market: "Skills Market" },
    nav: {
      home: "Home",
      arena: "Collaboration Map",
      market: "Skills Market",
      knowledge: "Knowledge Base",
      admin: "Admin Console",
    },
    signedIn: "Signed in",
    logout: "Log out",
    login: "Log in",
    openConsole: "Admin Console",
  },
} as const;

type NavKey = keyof (typeof HEADER_COPY)["zh"]["nav"];

type NavItem = {
  key: NavKey;
  path: string;
  /** Path prefixes that also highlight this item (e.g. /market/:id) */
  activePrefixes?: string[];
};

const NAV_ITEMS: NavItem[] = [
  { key: "home", path: "/" },
  { key: "market", path: "/market", activePrefixes: ["/market"] },
  { key: "knowledge", path: "/knowledge" },
  { key: "arena", path: "/arena" },
  {
    key: "admin",
    path: "/dashboard",
    activePrefixes: [
      "/dashboard",
      "/gateway",
      "/accounts",
      "/engines",
      "/dispatch",
      "/runs",
      "/assets",
      "/policies",
      "/skills",
      "/costs",
      "/risk",
      "/console",
    ],
  },
];

function isNavActive(item: NavItem, pathname: string) {
  if (item.path === "/") return pathname === "/";
  if (pathname === item.path) return true;
  const prefixes = item.activePrefixes ?? [item.path];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

type PublicSiteHeaderProps = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  /** Market pages use a violet logo tile and market subtitle */
  variant?: "default" | "market";
  maxWidthClass?: string;
  loginReturnPath?: string;
};

export function PublicSiteHeader({
  locale,
  onLocaleChange,
  variant = "default",
  maxWidthClass = "max-w-7xl",
  loginReturnPath,
}: PublicSiteHeaderProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const copy = HEADER_COPY[locale];
  const signedIn = isConsoleAuthenticated();
  const adminUser = isAdmin();
  const isMarket = variant === "market";
  const loginTo = loginReturnPath
    ? `/login?return=${encodeURIComponent(loginReturnPath)}`
    : "/login";

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className={`mx-auto flex items-center justify-between gap-3 px-5 py-4 ${maxWidthClass}`}>
        <Link to="/" className="flex min-w-0 shrink items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white shadow-sm ${
              isMarket ? "rounded-xl bg-gradient-to-br from-violet-600 to-blue-600" : "bg-slate-950"
            }`}
          >
            {isMarket ? "S" : "E"}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-950">{copy.brand}</span>
            <span className="block truncate text-xs text-slate-500">{copy.subtitle[variant]}</span>
          </span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 text-sm md:flex">
          {(adminUser ? NAV_ITEMS : NAV_ITEMS.filter(i => i.key !== "admin")).map((item) => {
            const active = isNavActive(item, pathname);
            const label = copy.nav[item.key];
            return (
              <Link
                key={item.key}
                to={item.path}
                className={`whitespace-nowrap rounded-lg px-2.5 py-2 transition ${
                  active
                    ? "bg-slate-100 font-medium text-slate-950"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <LanguageToggle locale={locale} onChange={onLocaleChange} />
          {!signedIn && (
            <Link
              to={loginTo}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              {copy.login}
            </Link>
          )}
          {signedIn && (
            <button
              type="button"
              onClick={() => {
                clearConsoleSession();
                navigate("/login", { replace: true });
              }}
              className="whitespace-nowrap rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              {copy.logout}
            </button>
          )}
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-5 py-2 text-sm md:hidden">
        {(adminUser ? NAV_ITEMS : NAV_ITEMS.filter(i => i.key !== "admin")).map((item) => {
          const active = isNavActive(item, pathname);
          return (
            <Link
              key={item.key}
              to={item.path}
              className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 ${
                active ? "bg-slate-100 font-medium text-slate-950" : "text-slate-600"
              }`}
            >
              {copy.nav[item.key]}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

export { HEADER_COPY as PUBLIC_HEADER_COPY };
