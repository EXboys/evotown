import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { getStaffRole, setStaffRole, setStaffToken } from "../hooks/useAdminToken";
import { resolveStaffPostLoginPath } from "../lib/staffRoutes";
import { useSystemConfig } from "../hooks/useSystemConfig";

type OidcConfig = { enabled?: boolean };

function formatApiDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const row = item as { loc?: unknown[]; msg?: string };
          const loc = Array.isArray(row.loc) ? row.loc.join(".") : "";
          return loc ? `${loc}: ${row.msg ?? ""}` : String(row.msg ?? "");
        }
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message?: string }).message ?? fallback);
  }
  return fallback;
}

export function ConsoleLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return") || "/";
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const sysConfig = useSystemConfig();
  const brand = sysConfig.brand_name || "Evotown";
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Handle OIDC staff_token from SSO callback
  useEffect(() => {
    const staffToken = searchParams.get("staff_token");
    if (staffToken) {
      // Fetch staff info to get role
      fetch("/api/v1/auth/staff-me", {
        headers: { Authorization: `Bearer ${staffToken}` },
      })
        .then(async (r) => {
          const data = await r.json() as { account?: { role?: string } };
          if (r.ok && data.account) {
            const role = data.account.role ?? "";
            setStaffToken(staffToken);
            setStaffRole(role);
            navigate(returnTo, { replace: true });
          }
        })
        .catch(() => {
          setError("SSO 登录失败，请重试。");
        });
    }
  }, [searchParams, navigate, returnTo]);

  useEffect(() => {
    fetch("/api/v1/auth/oidc/status")
      .then((r) => r.json() as Promise<OidcConfig>)
      .then((data) => {
        setOidcEnabled(Boolean(data.enabled));
      })
      .catch(() => {});
  }, []);

  const submitStaffLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!loginName.trim() || !loginPassword) {
      setError("请填写登录名和密码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/staff-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login_name: loginName.trim(), password: loginPassword }),
      });
      const data = await res.json() as {
        session_token?: string;
        account?: { name?: string; role?: string };
        detail?: unknown;
      };
      if (!res.ok) {
        throw new Error(formatApiDetail(data.detail, `登录失败 (${res.status})`));
      }
      if (!data.session_token) {
        throw new Error("登录成功但未返回 session。");
      }
      const role = data.account?.role ?? "";
      setStaffToken(data.session_token);
      setStaffRole(role);
      navigate(resolveStaffPostLoginPath(role, returnTo), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{brand}</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">员工登录</h1>
          <p className="mt-2 text-sm text-slate-500">使用企业账号和密码登录智能体工作台</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {oidcEnabled && (
            <>
              <a
                href={`/api/v1/auth/oidc/start?return_to=${encodeURIComponent(returnTo)}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                企业 SSO 登录
              </a>
              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                或使用账号密码
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          )}

          <form onSubmit={submitStaffLogin} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">登录名</span>
              <input
                type="text"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-3 focus:ring-indigo-100"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">密码</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="密码"
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-3 focus:ring-indigo-100"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !loginName.trim() || !loginPassword}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-40"
            >
              {busy ? "登录中..." : "登 录"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-sm">
          <Link to="/" className="text-slate-500 hover:text-slate-700 transition">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
