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
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm leading-6 text-slate-700">
        <p className="font-medium text-slate-900">怎么配本机？</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            先点下方<strong className="font-medium text-slate-900">「获取 / 重新签发 Key」</strong>，拿到完整 <code className="text-xs">evk_…</code>
          </li>
          <li>
            <strong className="font-medium text-slate-900">SkillLite / evotown-agent-setup</strong>：点
            <strong className="font-medium text-slate-900">「复制两行 .env」</strong>，写入本机{" "}
            <code className="text-xs">~/.config/evotown/evotown.agent.env</code>（含站点地址 + Key，不用单独挑 URL）
          </li>
          <li>
            <strong className="font-medium text-slate-900">OpenClaw / Hermes 手写 YAML</strong>：模型地址填{" "}
            <strong className="font-medium text-slate-900">Gateway URL</strong>，Key 填 <code className="text-xs">evk_…</code>；或点
            <strong className="font-medium text-slate-900">「复制 OpenClaw/Hermes 两行」</strong>
          </li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">与下方「云端智能体」无关；云端在浏览器里直接用，不需要这些配置。</p>
      </div>

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

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">各字段含义（需要单独复制时再看）</p>

        <CopyRow
          label="EVOTOWN_URL — 站点根地址"
          hint="给 SkillLite / evotown-agent-setup 用；Skills 市场、同步脚本也认这个地址。OpenClaw/Hermes 配模型时不要用这一行。"
          value={baseUrl}
          copied={copied}
          onCopy={flashCopy}
        />

        <CopyRow
          label="Gateway URL — 模型 API 地址"
          hint="给 OpenClaw / Hermes 的 base_url、openai_base_url 用，等价于 OPENAI_BASE_URL。SkillLite 标准 .env 不需要单独复制这一行。"
          value={gatewayUrl}
          copied={copied}
          onCopy={flashCopy}
        />

        {hasVisibleKey ? (
          <CopyRow
            label="API Key — evk_…"
            hint="所有本机接入方式都要用；与上面两个 URL 搭配。"
            value={apiKey}
            copied={copied}
            onCopy={flashCopy}
          />
        ) : null}
      </div>
    </div>
  );
}
