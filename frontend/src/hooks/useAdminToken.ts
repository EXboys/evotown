/**
 * Admin Token management (sessionStorage — cleared when tab closes).
 *
 * Use adminFetch() for admin-authenticated API calls (reads and writes).
 * Prompts once per session if no token is stored.
 */

const SESSION_KEY = "evotown_admin_token";

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(SESSION_KEY)?.trim() ?? "";
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  const trimmed = token.trim();
  if (trimmed) {
    sessionStorage.setItem(SESSION_KEY, trimmed);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function clearAdminToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function adminHeaders(): HeadersInit {
  const token = getAdminToken();
  return token ? { "X-Admin-Token": token } : {};
}

async function ensureAdminToken(): Promise<string | null> {
  let token = getAdminToken();
  if (token) return token;

  const input = window.prompt(
    "请输入 Admin Token（仅本次会话保存，关闭 Tab 后自动清除）："
  );
  if (!input?.trim()) return null;
  token = input.trim();
  setAdminToken(token);
  return token;
}

/**
 * Fetch wrapper that attaches X-Admin-Token from sessionStorage.
 * Prompts once if missing; clears token on 403.
 */
export async function adminFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await ensureAdminToken();
  if (!token) {
    return new Response(JSON.stringify({ detail: "No token provided" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers(init.headers);
  headers.set("X-Admin-Token", token);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });

  if (res.status === 403) {
    clearAdminToken();
    window.alert("Admin Token 错误，已清除。请重试并输入正确的 Token。");
  }

  return res;
}
