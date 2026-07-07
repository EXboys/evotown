/** Paths that require platform admin (console.write). */
export const ADMIN_CONSOLE_PREFIXES = [
  "/dashboard",
  "/gateway",
  "/accounts",
  "/engines",
  "/dispatch",
  "/runs",
  "/assets",
  "/policies",
  "/skills",
  "/console",
  "/costs",
  "/risk",
] as const;

export const STAFF_EMPLOYEE_HOME = "/agent";

export function isAdminConsolePath(path: string): boolean {
  const normalized = path.split("?")[0] ?? path;
  return ADMIN_CONSOLE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/** Where staff (账号密码) should land after login. */
export function resolveStaffPostLoginPath(role: string | undefined, returnTo: string): string {
  if (role === "admin") {
    return returnTo || "/dashboard";
  }
  if (!returnTo || returnTo === "/" || isAdminConsolePath(returnTo)) {
    return STAFF_EMPLOYEE_HOME;
  }
  return returnTo;
}
