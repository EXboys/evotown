import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { isConsoleAuthenticated, setConsoleApiKey } from "../hooks/useAdminToken";

type RegistrationStatus = {
  public_registration_allowed?: boolean;
  account_count?: number;
};

type SessionInfo = {
  account_id: string;
  account_name: string;
  team_id?: string;
  key_label?: string;
  scopes?: string[];
};

export function ConsoleLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return") || "/dashboard";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [apiKey, setApiKey] = useState("");
  const [registerForm, setRegisterForm] = useState({ name: "", owner_email: "", team_id: "" });
  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isConsoleAuthenticated()) {
      navigate(returnTo, { replace: true });
      return;
    }
    fetch("/api/v1/auth/registration-status")
      .then((r) => r.json() as Promise<RegistrationStatus>)
      .then((data) => setRegistrationAllowed(Boolean(data.public_registration_allowed)))
      .catch(() => setRegistrationAllowed(true));
  }, [navigate, returnTo]);

  const finishLogin = (key: string, session?: SessionInfo) => {
    setConsoleApiKey(key);
    setMessage(session ? `已登录：${session.account_name}` : "已登录");
    navigate(returnTo, { replace: true });
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const data = await res.json() as { session?: SessionInfo; detail?: string };
      if (!res.ok) {
        throw new Error(data.detail || `登录失败 (${res.status})`);
      }
      finishLogin(apiKey.trim(), data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event: FormEvent) => {
    event.preventDefault();
    if (!registerForm.name.trim()) {
      setError("请填写账号名称。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerForm),
      });
      const data = await res.json() as {
        api_key?: string;
        account?: { name?: string };
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(data.detail || `注册失败 (${res.status})`);
      }
      if (!data.api_key) {
        throw new Error("注册成功但未返回 API Key。");
      }
      setCreatedKey(data.api_key);
      setApiKey(data.api_key);
      setMessage(`账号「${data.account?.name ?? registerForm.name}」已创建。请保存下方 API Key 并继续登录。`);
      setMode("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Evotown Console</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">企业控制台登录</h1>
          <p className="mt-2 text-sm text-slate-400">使用账号 API Key（evk_…）登录，不再弹出 Admin Token 输入框。</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="mb-6 flex rounded-xl bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${mode === "login" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              disabled={!registrationAllowed}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${mode === "register" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              注册账号
            </button>
          </div>

          {message && <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</div>}
          {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}

          {mode === "login" ? (
            <form onSubmit={submitLogin} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-2 block font-medium text-slate-300">API Key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="evk_xxxxxxxxxxxxxxxx"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !apiKey.trim()}
                className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-slate-100 disabled:opacity-50"
              >
                {busy ? "登录中..." : "登录"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitRegister} className="space-y-4">
              {!registrationAllowed && (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  公开注册已关闭，请联系管理员在账号页为你创建账号并签发 API Key。
                </p>
              )}
              <input
                value={registerForm.name}
                onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                placeholder="账号名称 *"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                value={registerForm.owner_email}
                onChange={(e) => setRegisterForm({ ...registerForm, owner_email: e.target.value })}
                placeholder="邮箱（可选）"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                value={registerForm.team_id}
                onChange={(e) => setRegisterForm({ ...registerForm, team_id: e.target.value })}
                placeholder="团队 ID（可选）"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={busy || !registrationAllowed}
                className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-slate-100 disabled:opacity-50"
              >
                {busy ? "注册中..." : "注册并获取 API Key"}
              </button>
            </form>
          )}

          {createdKey && (
            <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-100">请立即保存 API Key（只显示一次）</p>
              <div className="mt-2 break-all rounded-lg bg-slate-950 p-3 font-mono text-xs text-amber-50">{createdKey}</div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
          <Link to="/" className="hover:text-slate-300">返回首页</Link>
          <Link to="/arena" className="hover:text-slate-300">进入协作地图</Link>
        </div>
      </div>
    </div>
  );
}
