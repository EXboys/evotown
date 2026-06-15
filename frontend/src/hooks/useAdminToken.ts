/**
 * Console authentication via account API keys (evk_…).
 *
 * Legacy X-Admin-Token is still supported when explicitly stored for bootstrap.
 * No browser prompt — unauthenticated users are redirected to /login.
 */

const SESSION_KEY = "evotown_console_api_key";
const LEGACY_ADMIN_KEY = "evotown_admin_token";
const STAFF_TOKEN_KEY = "evotown_staff_token";

export function getConsoleApiKey(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(SESSION_KEY)?.trim() ?? "";
}

export function setConsoleApiKey(key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (trimmed) {
    sessionStorage.setItem(SESSION_KEY, trimmed);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function clearConsoleApiKey(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(LEGACY_ADMIN_KEY)?.trim() ?? "";
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  const trimmed = token.trim();
  if (trimmed) {
    sessionStorage.setItem(LEGACY_ADMIN_KEY, trimmed);
  } else {
    sessionStorage.removeItem(LEGACY_ADMIN_KEY);
  }
}

export function clearAdminToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(LEGACY_ADMIN_KEY);
}

// ── Staff session token (account + password login) ──────────────────

export function getStaffToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(STAFF_TOKEN_KEY)?.trim() ?? "";
}

export function setStaffToken(token: string): void {
  if (typeof window === "undefined") return;
  const trimmed = token.trim();
  if (trimmed) {
    sessionStorage.setItem(STAFF_TOKEN_KEY, trimmed);
  } else {
    sessionStorage.removeItem(STAFF_TOKEN_KEY);
  }
}

const STAFF_ROLE_KEY = "evotown_staff_role";

export function getStaffRole(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(STAFF_ROLE_KEY) ?? "";
}

export function setStaffRole(role: string): void {
  if (typeof window === "undefined") return;
  if (role) {
    sessionStorage.setItem(STAFF_ROLE_KEY, role);
  } else {
    sessionStorage.removeItem(STAFF_ROLE_KEY);
  }
}

export function isAdmin(): boolean {
  return getStaffRole() === "admin";
}

export function clearStaffToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STAFF_TOKEN_KEY);
}

export function clearConsoleSession(): void {
  clearConsoleApiKey();
  clearAdminToken();
  clearStaffToken();
  setStaffRole("");
}

export function isConsoleAuthenticated(): boolean {
  return Boolean(getConsoleApiKey() || getAdminToken() || getStaffToken());
}

export function authHeaders(): HeadersInit {
  const staffToken = getStaffToken();
  if (staffToken) {
    return { Authorization: `Bearer ${staffToken}` };
  }
  const apiKey = getConsoleApiKey();
  if (apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  }
  const adminToken = getAdminToken();
  return adminToken ? { "X-Admin-Token": adminToken } : {};
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/login?return=${returnTo}`);
}

/**
 * Fetch wrapper for console/admin APIs.
 * Uses Bearer evk_ key when signed in; falls back to legacy admin token if set.
 */
export async function adminFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const staffToken = getStaffToken();
  const apiKey = getConsoleApiKey();
  const adminToken = getAdminToken();

  if (!staffToken && !apiKey && !adminToken) {
    redirectToLogin();
    return new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers(init.headers);
  if (staffToken) {
    headers.set("Authorization", `Bearer ${staffToken}`);
  } else if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  } else if (adminToken) {
    headers.set("X-Admin-Token", adminToken);
  }
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });

  // 403 = 已认证但权限不足（如仅有 console.read）；勿清 session，避免登录后闪回 /login
  if (res.status === 401) {
    clearConsoleSession();
    redirectToLogin();
  }

  return res;
}
