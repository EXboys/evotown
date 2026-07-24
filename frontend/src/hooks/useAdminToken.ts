/**
 * Console authentication via staff session token (account + password login).
 *
 * No API key login — all users must use account + password.
 * Unauthenticated users are redirected to /login.
 */

const STAFF_TOKEN_KEY = "evotown_staff_token";
const STAFF_ROLE_KEY = "evotown_staff_role";

// ── Staff session token (account + password login) ──────────────────

export function getStaffToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STAFF_TOKEN_KEY)?.trim() ?? "";
}

export function setStaffToken(token: string): void {
  if (typeof window === "undefined") return;
  const trimmed = token.trim();
  if (trimmed) {
    localStorage.setItem(STAFF_TOKEN_KEY, trimmed);
  } else {
    localStorage.removeItem(STAFF_TOKEN_KEY);
  }
}

export function getStaffRole(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STAFF_ROLE_KEY) ?? "";
}

export function setStaffRole(role: string): void {
  if (typeof window === "undefined") return;
  if (role) {
    localStorage.setItem(STAFF_ROLE_KEY, role);
  } else {
    localStorage.removeItem(STAFF_ROLE_KEY);
  }
}

export function isAdmin(): boolean {
  return getStaffRole() === "admin";
}

/** Staff 账号密码登录且角色为员工。 */
export function isStaffEmployee(): boolean {
  return Boolean(getStaffToken()) && !isAdmin();
}

/** 是否应展示企业后台入口（导航、页内链接等）。 */
export function canAccessAdminConsole(): boolean {
  return isAdmin();
}

export function clearStaffToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STAFF_TOKEN_KEY);
}

export function clearConsoleSession(): void {
  clearStaffToken();
  setStaffRole("");
}

export function isConsoleAuthenticated(): boolean {
  return Boolean(getStaffToken());
}

export function authHeaders(): HeadersInit {
  const staffToken = getStaffToken();
  if (staffToken) {
    return { Authorization: `Bearer ${staffToken}` };
  }
  return {};
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/login?return=${returnTo}`);
}

/**
 * Fetch wrapper for console/admin APIs.
 * Uses Bearer staff session token when signed in.
 */
export async function adminFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const staffToken = getStaffToken();

  if (!staffToken) {
    redirectToLogin();
    return new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${staffToken}`);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });

  // 401 = session expired
  if (res.status === 401) {
    clearConsoleSession();
    redirectToLogin();
  }

  return res;
}
