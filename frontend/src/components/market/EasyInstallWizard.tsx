import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getConsoleApiKey } from "../../hooks/useAdminToken";
import {
  buildAgentEnvFileContent,
  buildInstallShellScript,
  copyText,
  downloadTextFile,
  getEvotownPublicUrl,
  maskApiKey,
  testEmployeeConnection,
  type EmployeeRuntime,
} from "../../lib/employeeConfig";

const RUNTIMES: Array<{ id: EmployeeRuntime; label: string }> = [
  { id: "openclaw", label: "OpenClaw" },
  { id: "hermes", label: "Hermes" },
  { id: "skilllite", label: "SkillLite" },
];

type Layout = "sidebar" | "panel";

type Props = {
  apiKeyOverride?: string;
  className?: string;
  /** sidebar：市场页右侧紧凑条；panel：账号页等全宽块 */
  layout?: Layout;
};

export function EasyInstallWizard({ apiKeyOverride, className = "", layout = "sidebar" }: Props) {
  const navigate = useNavigate();
  const isSidebar = layout === "sidebar";
  const [runtime, setRuntime] = useState<EmployeeRuntime>("openclaw");
  const [pastedKey, setPastedKey] = useState("");
  const [expanded, setExpanded] = useState(!isSidebar);
  const [showCommand, setShowCommand] = useState(false);
  const [copied, setCopied] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const baseUrl = getEvotownPublicUrl();
  const sessionKey = getConsoleApiKey();
  const apiKey = (apiKeyOverride?.trim() || pastedKey.trim() || sessionKey).trim();
  const hasValidKey = apiKey.startsWith("evk_");

  const envFile = useMemo(() => buildAgentEnvFileContent(baseUrl, apiKey), [baseUrl, apiKey]);
  const installScript = useMemo(
    () => buildInstallShellScript(baseUrl, apiKey, runtime),
    [baseUrl, apiKey, runtime],
  );

  const flash = (label: string) => {
    setCopied(label);
    window.setTimeout(() => setCopied(""), 2000);
  };

  const handleCopyScript = async () => {
    if (!hasValidKey) return;
    if (await copyText(installScript)) flash("script");
  };

  const handleDownload = () => {
    if (!hasValidKey) return;
    downloadTextFile("evotown.agent.env", envFile);
    flash("download");
  };

  const handleTest = async () => {
    if (!hasValidKey) return;
    setTesting(true);
    setTestResult(null);
    const result = await testEmployeeConnection(baseUrl, apiKey, runtime);
    setTestResult({ ok: result.ok, message: result.message });
    setTesting(false);
  };

  const shellClass = isSidebar
    ? `rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`
    : `overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm ${className}`;

  const header = (
    <div
      className={`flex items-start justify-between gap-2 ${
        isSidebar ? "border-b border-slate-100 px-4 py-3" : "border-b border-violet-100 bg-violet-50/80 px-5 py-4"
      }`}
    >
      <div className="min-w-0">
        <h2 className={`font-semibold text-slate-950 ${isSidebar ? "text-sm" : "text-base"}`}>
          {isSidebar ? "快速接入" : "傻瓜式接入"}
        </h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          {isSidebar ? "选 Runtime · 填 Key · 一键安装" : "下载配置或复制终端命令，自动 sync 技能包"}
        </p>
      </div>
      {isSidebar && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50"
          aria-expanded={expanded}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );

  const body = (
    <div className={`space-y-4 ${isSidebar ? "px-4 py-3" : "px-5 py-4"}`}>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Runtime</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RUNTIMES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRuntime(item.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
                runtime === item.id
                  ? "bg-violet-600 text-white ring-violet-600"
                  : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">API Key</p>
        {sessionKey.startsWith("evk_") && !apiKeyOverride ? (
          <p className="mt-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
            已登录 <span className="font-mono">{maskApiKey(sessionKey)}</span>
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            <input
              type="password"
              value={pastedKey}
              onChange={(e) => {
                setPastedKey(e.target.value);
                setTestResult(null);
              }}
              placeholder="evk_…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-violet-200"
            />
            <p className="text-[10px] text-slate-500">
              <button
                type="button"
                onClick={() => navigate("/login?return=%2Fmarket")}
                className="font-medium text-violet-700 hover:underline"
              >
                登录
              </button>
              {" · "}
              <Link to="/accounts" className="font-medium text-violet-700 hover:underline">
                申请 Key
              </Link>
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!hasValidKey}
          onClick={handleCopyScript}
          className="w-full rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {copied === "script" ? "已复制" : "复制一键安装命令"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!hasValidKey}
            onClick={handleDownload}
            className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {copied === "download" ? "已下载" : "下载 .env"}
          </button>
          <button
            type="button"
            disabled={!hasValidKey || testing}
            onClick={handleTest}
            className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? "…" : "测试连接"}
          </button>
        </div>
      </div>

      {!hasValidKey && <p className="text-[11px] text-amber-800">请先登录或粘贴 evk_ Key</p>}

      {testResult && (
        <p
          className={`rounded-lg px-2.5 py-2 text-[11px] leading-4 ${
            testResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
          }`}
        >
          {testResult.ok ? "✓ " : "✗ "}
          {testResult.message}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowCommand((v) => !v)}
        className="text-[10px] font-medium text-violet-700 hover:text-violet-900"
      >
        {showCommand ? "隐藏命令" : "查看终端命令"}
      </button>
      {showCommand && (
        <pre className="max-h-36 overflow-auto rounded-lg bg-slate-950 p-2.5 text-[10px] leading-5 text-emerald-100">
          {hasValidKey ? installScript : "# 填写 Key 后预览"}
        </pre>
      )}
    </div>
  );

  if (isSidebar && !expanded) {
    return (
      <section className={shellClass}>
        {header}
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full rounded-lg border border-dashed border-violet-200 bg-violet-50/50 py-2 text-xs font-medium text-violet-800 hover:bg-violet-50"
          >
            首次使用？展开一键接入
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={shellClass}>
      {header}
      {body}
    </section>
  );
}
