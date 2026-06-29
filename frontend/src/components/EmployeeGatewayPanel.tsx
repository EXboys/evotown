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
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-900">{value}</p>
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
        用于<strong className="font-medium text-slate-800">本机部署</strong>（OpenClaw / Hermes / SkillLite），与下方云端智能体无关。
        复制 Base URL 与 API Key 到本机即可走企业网关与 Skills 市场。
      </p>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <CopyRow label="EVOTOWN_URL（Base URL）" value={baseUrl} copied={copied} onCopy={flashCopy} />
      <CopyRow label="Gateway Base URL" value={gatewayUrl} copied={copied} onCopy={flashCopy} />

      {hasVisibleKey ? (
        <>
          <CopyRow label="API Key（evk_…）" value={apiKey} copied={copied} onCopy={flashCopy} />
          <p className="text-xs text-slate-400">
            {sessionApiKey ? "当前浏览器已保存 API Key。" : "请立即保存 Key，关闭页面后无法再次查看完整密钥。"}
            {!sessionApiKey && credentials?.key_prefix ? ` 前缀 ${credentials.key_prefix}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void flashCopy("两行配置", envContent.trim())}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {copied === "两行配置" ? "已复制" : "复制两行 .env"}
            </button>
            <button
              type="button"
              onClick={() => void flashCopy("Gateway 环境变量", buildGatewayEnv(baseUrl, apiKey).trim())}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {copied === "Gateway 环境变量" ? "已复制" : "复制 OPENAI_BASE_URL"}
            </button>
            <button
              type="button"
              onClick={() => {
                downloadTextFile("evotown.agent.env", envContent);
                setCopied("download");
                window.setTimeout(() => setCopied(""), 2000);
              }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
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
        </>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">尚未获取可复制的 API Key</p>
          <p className="mt-1 text-amber-900/90">
            {credentials?.has_key && credentials.key_prefix
              ? `账号已有 Key（${maskApiKey(credentials.key_prefix)}），若本机未保存可重新签发。`
              : "点击下方按钮为当前账号签发本地部署 Key。"}
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
      )}
    </div>
  );
}
