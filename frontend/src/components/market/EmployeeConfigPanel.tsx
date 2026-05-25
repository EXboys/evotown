import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getConsoleApiKey } from "../../hooks/useAdminToken";
import {
  buildAgentEnv,
  buildGatewayEnv,
  buildRuntimeSnippet,
  copyText,
  getEvotownPublicUrl,
  maskApiKey,
  type EmployeeRuntime,
} from "../../lib/employeeConfig";

type Props = {
  apiKeyOverride?: string;
  compact?: boolean;
  className?: string;
};

const RUNTIMES: Array<{ id: EmployeeRuntime; label: string }> = [
  { id: "openclaw", label: "OpenClaw" },
  { id: "hermes", label: "Hermes" },
  { id: "skilllite", label: "SkillLite" },
];

function CopyButton({ label, copied, onClick }: { label: string; copied: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
    >
      {copied === label ? "已复制" : "复制"}
    </button>
  );
}

function ConfigBlock({
  title,
  subtitle,
  code,
  copyLabel,
  copied,
  onCopy,
  primary = false,
}: {
  title: string;
  subtitle: string;
  code: string;
  copyLabel: string;
  copied: string;
  onCopy: (label: string, text: string) => void;
  primary?: boolean;
}) {
  const borderClass = primary ? "border-violet-200 bg-white" : "border-slate-200 bg-white/90";
  return (
    <div className={`rounded-xl border ${borderClass} p-4`}>
      <ConfigBlockHeader title={title} subtitle={subtitle} copyLabel={copyLabel} copied={copied} code={code} onCopy={onCopy} />
      <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-emerald-100">{code}</pre>
    </div>
  );
}

function ConfigBlockHeader({
  title,
  subtitle,
  copyLabel,
  copied,
  code,
  onCopy,
}: {
  title: string;
  subtitle: string;
  copyLabel: string;
  copied: string;
  code: string;
  onCopy: (label: string, text: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <CopyButton label={copyLabel} copied={copied} onClick={() => onCopy(copyLabel, code)} />
    </div>
  );
}
export function EmployeeConfigPanel({ apiKeyOverride, compact = false, className = "" }: Props) {
  const [runtime, setRuntime] = useState<EmployeeRuntime>("openclaw");
  const [copied, setCopied] = useState("");
  const baseUrl = getEvotownPublicUrl();
  const sessionKey = getConsoleApiKey();
  const apiKey = apiKeyOverride?.trim() || sessionKey;
  const hasEmployeeKey = Boolean(apiKey && apiKey.startsWith("evk_"));

  const agentEnv = useMemo(() => buildAgentEnv(baseUrl, apiKey), [baseUrl, apiKey]);
  const gatewayEnv = useMemo(() => buildGatewayEnv(baseUrl, apiKey), [baseUrl, apiKey]);
  const runtimeYaml = useMemo(() => buildRuntimeSnippet(runtime, baseUrl, apiKey), [runtime, baseUrl, apiKey]);

  const handleCopy = async (label: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? label : "");
    if (ok) window.setTimeout(() => setCopied(""), 2000);
  };

  const pad = compact ? "p-5" : "p-6 md:p-8";
  const headerPad = compact ? "px-5 py-4" : "px-6 py-5 md:px-8";
  const keyHint = hasEmployeeKey ? `Key: ${maskApiKey(apiKey)}` : "需 evk_ 员工 key";

  return (
    <section
      className={`rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-blue-50/60 shadow-sm ${className}`}
    >
      <div className={`border-b border-violet-100/80 ${headerPad}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Employee Onboarding</p>
        <h2 className={`mt-1 font-semibold text-slate-950 ${compact ? "text-base" : "text-lg"}`}>
          员工两行配置 · 复制即用
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          同一 <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs text-violet-700">evk_</code> key 用于模型网关与私有 SkillHub。
          IT 部署：<span className="font-mono text-xs text-slate-500">./scripts/enterprise-deploy.sh</span>
        </p>
      </div>

      <div className={`space-y-5 ${pad}`}>
        {!hasEmployeeKey && <EmployeeKeyWarning />}

        <div className="grid gap-4 lg:grid-cols-2">
          <ConfigBlock
            title="evotown.agent.env（推荐 · 两行）"
            subtitle={keyHint}
            code={agentEnv}
            copyLabel="env"
            copied={copied}
            onCopy={handleCopy}
            primary
          />
          <ConfigBlock
            title="模型网关（OpenAI 兼容）"
            subtitle="OpenClaw / Hermes 可直接映射"
            code={gatewayEnv}
            copyLabel="gateway"
            copied={copied}
            onCopy={handleCopy}
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Runtime 配置片段</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {RUNTIMES.find((r) => r.id === runtime)?.label} · {baseUrl}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {RUNTIMES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRuntime(item.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                    runtime === item.id
                      ? "bg-violet-600 text-white ring-violet-600"
                      : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <CopyButton label="runtime" copied={copied} onClick={() => handleCopy("runtime", runtimeYaml)} />
            </div>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-cyan-100">{runtimeYaml}</pre>
          {hasEmployeeKey && (
            <p className="mt-2 text-xs text-slate-500">
              当前 key：<span className="font-mono">{maskApiKey(apiKey)}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function EmployeeKeyWarning() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">请使用员工 evk_ API Key</p>
      <p className="mt-1 text-amber-800/90">
        IT 在{" "}
        <Link to="/accounts" className="font-medium underline hover:text-amber-950">
          账号管理
        </Link>{" "}
        签发含 <code className="text-xs">gateway.chat</code> + <code className="text-xs">console.read</code> 的 key。Admin Token 勿下发员工。
      </p>
    </div>
  );
}
