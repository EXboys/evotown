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
  /** 控制台内嵌：略紧凑，默认展开高级项 */
  compact?: boolean;
  /** market：目录页简化；full：完整块（账号页新建 key 后） */
  mode?: "market" | "full";
  /** 仅 mode=market：默认折叠整段接入说明 */
  defaultCollapsed?: boolean;
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

function EmployeeKeyWarning() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">请使用员工 evk_ API Key</p>
      <p className="mt-1 text-amber-800/90">
        IT 在{" "}
        <Link to="/accounts" className="font-medium underline hover:text-amber-950">
          账号管理
        </Link>{" "}
        签发含 <code className="text-xs">gateway.chat</code> + <code className="text-xs">console.read</code> 的 key。
      </p>
    </div>
  );
}

export function EmployeeConfigPanel({
  apiKeyOverride,
  compact = false,
  mode = "full",
  defaultCollapsed = false,
  className = "",
}: Props) {
  const [runtime, setRuntime] = useState<EmployeeRuntime>("openclaw");
  const [copied, setCopied] = useState("");
  const [sectionOpen, setSectionOpen] = useState(!defaultCollapsed);
  const [advancedOpen, setAdvancedOpen] = useState(mode === "full" && !compact);

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

  const isMarket = mode === "market";
  const pad = compact ? "p-5" : "p-6 md:p-8";
  const headerPad = compact ? "px-5 py-4" : "px-6 py-5 md:px-8";

  const header = (
    <div className={`border-b border-violet-100/80 ${headerPad}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
            {isMarket ? "接入 SkillHub" : "Employee Onboarding"}
          </p>
          <h2 className={`mt-1 font-semibold text-slate-950 ${compact ? "text-base" : "text-lg"}`}>
            {isMarket ? "三步接入（推荐）" : "员工两行配置 · 复制即用"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {isMarket ? (
              <>
                同一 <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs text-violet-700">evk_</code> key
                拉取技能目录并走模型网关；无需手改 manifest。
              </>
            ) : (
              <>
                同一 <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs text-violet-700">evk_</code> key
                用于网关与 SkillHub。IT：<span className="font-mono text-xs">enterprise-deploy.sh</span>
                {" · "}员工：<span className="font-mono text-xs">evotown-agent-setup.py sync</span>
              </>
            )}
          </p>
        </div>
        {isMarket && (
          <button
            type="button"
            onClick={() => setSectionOpen((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {sectionOpen ? "收起" : "展开配置"}
          </button>
        )}
      </div>
    </div>
  );

  const simpleSteps = (
    <div className="space-y-4">
      {!hasEmployeeKey && <EmployeeKeyWarning />}

      <div className="rounded-xl border border-violet-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-violet-700">步骤 1</p>
            <h3 className="text-sm font-semibold text-slate-950">保存员工配置（两行）</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              路径：<span className="font-mono">~/.config/evotown/evotown.agent.env</span>
              {hasEmployeeKey ? ` · ${maskApiKey(apiKey)}` : ""}
            </p>
          </div>
          <CopyButton label="env" copied={copied} onClick={() => handleCopy("env", agentEnv)} />
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-emerald-100">
          {agentEnv.trim()}
        </pre>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-500">步骤 2</p>
        <h3 className="text-sm font-semibold text-slate-950">选择 Runtime 并同步技能包</h3>
        <div className="mt-3 flex flex-wrap gap-2">
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
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-6 text-slate-200">
            {`source ~/.config/evotown/evotown.agent.env
evotown-agent-setup.py sync   # ${runtime}`}
          </pre>
          <CopyButton
            label="sync-cmd"
            copied={copied}
            onClick={() =>
              handleCopy(
                "sync-cmd",
                `source ~/.config/evotown/evotown.agent.env\nevotown-agent-setup.py sync`,
              )
            }
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        className="text-xs font-medium text-violet-700 hover:text-violet-900"
      >
        {advancedOpen ? "▾ 收起网关 / YAML 高级配置" : "▸ 需要手改 OpenClaw/Hermes 配置？展开高级项"}
      </button>

      {advancedOpen && (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">模型网关（OpenAI 兼容）</h3>
                <p className="mt-0.5 text-xs text-slate-500">写入 runtime 的 llm / model 段</p>
              </div>
              <CopyButton label="gateway" copied={copied} onClick={() => handleCopy("gateway", gatewayEnv)} />
            </div>
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-emerald-100">
              {gatewayEnv}
            </pre>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  {RUNTIMES.find((r) => r.id === runtime)?.label} 配置片段
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 font-mono truncate">{baseUrl}</p>
              </div>
              <CopyButton label="runtime" copied={copied} onClick={() => handleCopy("runtime", runtimeYaml)} />
            </div>
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-cyan-100">
              {runtimeYaml}
            </pre>
          </div>
        </div>
      )}
    </div>
  );

  const fullLayout = (
    <div className="space-y-5">
      {!hasEmployeeKey && <EmployeeKeyWarning />}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-violet-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">evotown.agent.env</h3>
              <p className="mt-0.5 text-xs text-slate-500">{hasEmployeeKey ? maskApiKey(apiKey) : "需 evk_ key"}</p>
            </div>
            <CopyButton label="env" copied={copied} onClick={() => handleCopy("env", agentEnv)} />
          </div>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-emerald-100">
            {agentEnv}
          </pre>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">模型网关</h3>
              <p className="mt-0.5 text-xs text-slate-500">OpenAI 兼容</p>
            </div>
            <CopyButton label="gateway" copied={copied} onClick={() => handleCopy("gateway", gatewayEnv)} />
          </div>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-emerald-100">
            {gatewayEnv}
          </pre>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Runtime 配置片段</h3>
            <p className="mt-0.5 text-xs text-slate-500">{RUNTIMES.find((r) => r.id === runtime)?.label}</p>
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
        <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-cyan-100">
          {runtimeYaml}
        </pre>
      </div>
    </div>
  );

  if (isMarket && !sectionOpen) {
    return (
      <section
        className={`rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 shadow-sm ${className}`}
      >
        {header}
      </section>
    );
  }

  return (
    <section
      className={`rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-blue-50/60 shadow-sm ${className}`}
    >
      {header}
      <div className={pad}>{isMarket ? simpleSteps : fullLayout}</div>
    </section>
  );
}
