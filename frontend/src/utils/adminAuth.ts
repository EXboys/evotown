const STORAGE_KEY = "evotown_admin_token";

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY)?.trim() || "";
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  const trimmed = token.trim();
  if (trimmed) {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function adminHeaders(): HeadersInit {
  const token = getAdminToken();
  return token ? { "X-Admin-Token": token } : {};
}

export async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAdminToken();
  if (token) {
    headers.set("X-Admin-Token", token);
  }
  return fetch(input, { ...init, headers });
}
