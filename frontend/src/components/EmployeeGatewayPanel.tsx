import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch, getConsoleApiKey } from "../hooks/useAdminToken";
import {
  buildAgentEnvFileContent,
  buildGatewayEnv,
  copyText,
  downloadTextFile,
  getEvotownPublicUrl,
  maskApiKey,
} from "../lib/employeeConfig";

export type GatewayCredentials = {
  evotown_url: string;
  gateway_base_url: string;
  skills_manifest_url?: string;
  api_key?: string;
  has_key?: boolean;
  key_prefix?: string;
  key_label?: string;
};

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    const detail = typeof (data as { detail?: string })?.detail === "string"
      ? (data as { detail: string }).detail
      : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function CopyRow({
  label,
  hint,
  value,
  copied,
  onCopy,
}: {
  label: string;
  hint?: string;
  value: string;
  copied: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-700">{label}</p>
          {hint ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{hint}</p> : null}
          <p className="mt-1.5 break-all font-mono text-xs text-slate-900">{value}</p>
        </div>
        <button
          type="button"
          onClick={() => onCopy(label, value)}
          className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          {copied === label ? "已复制" : "复制"}
        </button>
      </div>
    </div>
  );
}

export function EmployeeGatewayPanel() {
  const [credentials, setCredentials] = useState<GatewayCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const sessionApiKey = getConsoleApiKey();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/auth/my-gateway-credentials");
      const data = await readJson<{ credentials?: GatewayCredentials }>(res);
      setCredentials(data.credentials ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issueKey = async () => {
    setIssuing(true);
    setError("");
    try {
      const res = await adminFetch("/api/v1/auth/my-gateway-credentials/issue", { method: "POST" });
      const data = await readJson<{ credentials?: GatewayCredentials; warning?: string }>(res);
      if (data.credentials) setCredentials(data.credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "签发失败");
    } finally {
      setIssuing(false);
    }
  };

  const baseUrl = credentials?.evotown_url || getEvotownPublicUrl();
  const gatewayUrl = credentials?.gateway_base_url || `${baseUrl.replace(/\/$/, "")}/api/gateway/v1`;
  const apiKey = sessionApiKey || credentials?.api_key || "";
  const hasVisibleKey = apiKey.startsWith("evk_");

  const envContent = useMemo(() => {
    if (!hasVisibleKey) return "";
    return buildAgentEnvFileContent(baseUrl, apiKey);
  }, [baseUrl, apiKey, hasVisibleKey]);

  const flashCopy = async (label: string, value: string) => {
    if (await copyText(value)) {
      setCopied(label);
      window.setTimeout(() => setCopied(""), 2000);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-400">加载网关配置…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        先签发 Key，再点<strong className="font-medium text-slate-800">「复制两行 .env（推荐）」</strong>写到本机{" "}
        <code className="text-xs">~/.config/evotown/evotown.agent.env</code>。OpenClaw / Hermes 手写配置见下方「高级字段」。
      </p>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {!hasVisibleKey ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">第 1 步：获取 API Key</p>
          <p className="mt-1 text-amber-900/90">
            {credentials?.has_key && credentials.key_prefix
              ? `账号已有 Key（${maskApiKey(credentials.key_prefix)}），本机没保存就重新签发。`
              : "为当前账号签发本地部署 Key，签发后页面会显示完整密钥。"}
          </p>
          <button
            type="button"
            disabled={issuing}
            onClick={() => void issueKey()}
            className="mt-3 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-950 disabled:opacity-50"
          >
            {issuing ? "签发中…" : credentials?.has_key ? "重新签发 Key" : "获取 API Key"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
          <p className="text-sm font-medium text-emerald-950">第 2 步：复制到本机</p>
          <p className="mt-1 text-xs leading-5 text-emerald-900/90">
            {sessionApiKey
              ? "当前浏览器已保存 API Key。"
              : "请立即保存 Key，关闭页面后无法再次查看完整密钥。"}
            {!sessionApiKey && credentials?.key_prefix ? ` 前缀 ${credentials.key_prefix}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void flashCopy("推荐·两行 .env", envContent.trim())}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
            >
              {copied === "推荐·两行 .env" ? "已复制" : "复制两行 .env（推荐）"}
            </button>
            <button
              type="button"
              onClick={() => void flashCopy("OpenClaw/Hermes 两行", buildGatewayEnv(baseUrl, apiKey).trim())}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50"
            >
              {copied === "OpenClaw/Hermes 两行" ? "已复制" : "复制 OpenClaw/Hermes 两行"}
            </button>
            <button
              type="button"
              onClick={() => {
                downloadTextFile("evotown.agent.env", envContent);
                setCopied("download");
                window.setTimeout(() => setCopied(""), 2000);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {copied === "download" ? "已下载" : "下载 .env"}
            </button>
            {!sessionApiKey && (
              <button
                type="button"
                disabled={issuing}
                onClick={() => void issueKey()}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {issuing ? "签发中…" : "重新签发 Key"}
              </button>
            )}
          </div>
        </div>
      )}

      <details className="group rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            高级：各字段单独复制
            <span className="text-xs font-normal text-slate-400 group-open:hidden">展开</span>
            <span className="hidden text-xs font-normal text-slate-400 group-open:inline">收起</span>
          </span>
        </summary>
        <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
          <CopyRow
            label="EVOTOWN_URL — 站点根地址"
            hint="SkillLite / evotown-agent-setup；OpenClaw/Hermes 配模型不要用这一行。"
            value={baseUrl}
            copied={copied}
            onCopy={flashCopy}
          />
          <CopyRow
            label="Gateway URL — 模型 API 地址"
            hint="OpenClaw / Hermes 的 base_url；等价 OPENAI_BASE_URL。"
            value={gatewayUrl}
            copied={copied}
            onCopy={flashCopy}
          />
          {hasVisibleKey ? (
            <CopyRow
              label="API Key — evk_…"
              hint="所有本机接入方式都要用。"
              value={apiKey}
              copied={copied}
              onCopy={flashCopy}
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}
