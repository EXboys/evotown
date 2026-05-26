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

export function buildAgentEnvLines(baseUrl: string, apiKey: string): { url: string; key: string } {
  const base = baseUrl.replace(/\/$/, "");
  const key = apiKey.trim() || "evk_replace_with_it_issued_key";
  return { url: base, key };
}

export function buildAgentEnv(baseUrl: string, apiKey: string): string {
  const { url, key } = buildAgentEnvLines(baseUrl, apiKey);
  return `# Evotown 员工端配置 — 复制到 ~/.config/evotown/evotown.agent.env
EVOTOWN_URL=${url}
EVOTOWN_API_KEY=${key}
`;
}

/** 仅两行，用于下载 .env 文件 */
export function buildAgentEnvFileContent(baseUrl: string, apiKey: string): string {
  const { url, key } = buildAgentEnvLines(baseUrl, apiKey);
  return `EVOTOWN_URL=${url}\nEVOTOWN_API_KEY=${key}\n`;
}

/** 终端一键粘贴：写入配置并提示 sync（不嵌入密钥到 URL） */
export function buildInstallShellScript(baseUrl: string, apiKey: string, runtime: EmployeeRuntime): string {
  const { url, key } = buildAgentEnvLines(baseUrl, apiKey);
  return `#!/usr/bin/env bash
# Evotown 一键接入 — ${runtime}
set -euo pipefail
mkdir -p "$HOME/.config/evotown"
cat > "$HOME/.config/evotown/evotown.agent.env" <<'EVOTOWN_ENV_EOF'
EVOTOWN_URL=${url}
EVOTOWN_API_KEY=${key}
EVOTOWN_ENV_EOF
echo "✓ 已写入 ~/.config/evotown/evotown.agent.env"
if command -v evotown-agent-setup.py >/dev/null 2>&1; then
  evotown-agent-setup.py check && evotown-agent-setup.py sync
elif [ -f "./scripts/evotown-agent-setup.py" ]; then
  python3 ./scripts/evotown-agent-setup.py check && python3 ./scripts/evotown-agent-setup.py sync
else
  echo "→ 请在本机执行（Evotown 仓库或 IT 下发的脚本路径）："
  echo "   python3 scripts/evotown-agent-setup.py check"
  echo "   python3 scripts/evotown-agent-setup.py sync"
fi
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

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  skillCount?: number;
};

/** 浏览器内测试 evk_ 能否拉取 SkillHub manifest */
export async function testEmployeeConnection(
  baseUrl: string,
  apiKey: string,
  runtime: EmployeeRuntime,
): Promise<ConnectionTestResult> {
  const key = apiKey.trim();
  if (!key.startsWith("evk_")) {
    return { ok: false, message: "请填写以 evk_ 开头的员工 API Key" };
  }
  const manifestPath = `/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=${runtime}`;
  try {
    const res = await fetch(manifestPath, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Key 无效或缺少 console.read 权限" };
    }
    if (!res.ok) {
      return { ok: false, message: `连接失败 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as { manifest?: { skills?: unknown[] } };
    const count = data.manifest?.skills?.length ?? 0;
    return {
      ok: true,
      message: count > 0 ? `已连通，当前 bundle 含 ${count} 个技能` : "已连通，bundle 暂无技能（请 IT 发布 Bundle）",
      skillCount: count,
    };
  } catch {
    return { ok: false, message: "无法连接服务器，请检查 EVOTOWN_URL 与网络" };
  }
}
