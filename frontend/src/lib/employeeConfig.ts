export type EmployeeRuntime = "openclaw" | "hermes" | "skilllite";

export function getEvotownPublicUrl(): string {
  if (typeof window === "undefined") return "https://evotown.company.internal";
  return window.location.origin.replace(/\/$/, "");
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 12) return `${trimmed.slice(0, 4)}…`;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function manifestUrl(baseUrl: string, runtime: EmployeeRuntime): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=${runtime}`;
}

export function buildAgentEnv(baseUrl: string, apiKey: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const key = apiKey.trim() || "evk_replace_with_it_issued_key";
  return `# Evotown 员工端配置 — 复制到 ~/.config/evotown/evotown.agent.env
EVOTOWN_URL=${base}
EVOTOWN_API_KEY=${key}
`;
}

export function buildGatewayEnv(baseUrl: string, apiKey: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const key = apiKey.trim() || "evk_replace_with_it_issued_key";
  return `OPENAI_BASE_URL=${base}/api/gateway/v1
OPENAI_API_KEY=${key}
`;
}

export function buildOpenClawYaml(baseUrl: string, apiKey: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const key = apiKey.trim() || "evk_replace_with_it_issued_key";
  return `# OpenClaw — 先 source evotown.agent.env，或替换下方变量
llm:
  openai_base_url: ${base}/api/gateway/v1
  openai_api_key: ${key}

skills_market:
  manifest_url: ${manifestUrl(base, "openclaw")}
  auth_header: Authorization
  auth_prefix: "Bearer "
  auth_token: ${key}
  channel: stable
`;
}

export function buildHermesYaml(baseUrl: string, apiKey: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const key = apiKey.trim() || "evk_replace_with_it_issued_key";
  return `# Hermes — 先 source evotown.agent.env，或替换下方变量
model:
  base_url: ${base}/api/gateway/v1
  api_key: ${key}

skills_market:
  manifest_url: ${manifestUrl(base, "hermes")}
  auth_header: Authorization
  auth_prefix: "Bearer "
  auth_token: ${key}
  install_scope: team
`;
}

export function buildSkillLiteYaml(baseUrl: string, apiKey: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const key = apiKey.trim() || "evk_replace_with_it_issued_key";
  return `# SkillLite
OPENAI_BASE_URL=${base}/api/gateway/v1
OPENAI_API_KEY=${key}

skills_market:
  manifest_url: ${manifestUrl(base, "skilllite")}
  auth_header: Authorization
  auth_prefix: "Bearer "
  auth_token: ${key}
  install_dir: .skills
`;
}

export function buildRuntimeSnippet(
  runtime: EmployeeRuntime,
  baseUrl: string,
  apiKey: string,
): string {
  if (runtime === "openclaw") return buildOpenClawYaml(baseUrl, apiKey);
  if (runtime === "hermes") return buildHermesYaml(baseUrl, apiKey);
  return buildSkillLiteYaml(baseUrl, apiKey);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
