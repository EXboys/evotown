import { useEffect, useState } from "react";
import { adminFetch } from "../hooks/useAdminToken";
import type { Locale } from "../lib/i18n";

type ConfigRow = {
  key: string;
  value: string;
  env_var: string | null;
  category: string;
  label: string;
  input_type: string;
  options: string | null;
};

const COPY = {
  zh: {
    title: "系统配置",
    subtitle: "配置企业信息与系统参数",
    enterpriseTitle: "企业信息",
    systemTitle: "系统参数",
    save: "保存配置",
    saving: "保存中...",
    saved: "保存成功",
    saveErr: "保存失败",
    logoLabel: "企业 Logo",
    logoHint: "点击或拖拽上传图片（PNG/JPG，最大 5MB）",
    logoUploaded: "Logo 已更新，刷新页面查看效果",
    restartTitle: "需要重启",
    restartMsg: (keys: string) => `以下配置需要重启后端服务才能生效：${keys}`,
    restartNow: "立即重启",
    restartLater: "稍后手动重启",
    restarting: "正在重启...",
    restartOk: "重启指令已发送，等待服务恢复...",
    restartErr: "自动重启失败，请手动执行 docker restart evotown-backend-1",
  },
  en: {
    title: "System Config",
    subtitle: "Configure enterprise info and system parameters",
    enterpriseTitle: "Enterprise Info",
    systemTitle: "System Parameters",
    save: "Save",
    saving: "Saving...",
    saved: "Saved",
    saveErr: "Save failed",
    logoLabel: "Logo",
    logoHint: "Click or drag to upload (PNG/JPG, max 5MB)",
    logoUploaded: "Logo updated, refresh to see changes",
    restartTitle: "Restart Required",
    restartMsg: (keys: string) => `The following changes require a backend restart: ${keys}`,
    restartNow: "Restart Now",
    restartLater: "Later",
    restarting: "Restarting...",
    restartOk: "Restart command sent, waiting for service to recover...",
    restartErr: "Auto-restart failed. Please run: docker restart evotown-backend-1",
  },
};

export default function SystemConfigPage({ locale = "zh" }: { locale?: Locale }) {
  const c = COPY[locale] || COPY.zh;
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [restartNeeded, setRestartNeeded] = useState<string[] | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    adminFetch("/api/v1/system-config/admin")
      .then((r) => r.json())
      .then((data) => {
        const rows = data.configs || [];
        setConfigs(rows);
        const initial: Record<string, string> = {};
        rows.forEach((r: ConfigRow) => { initial[r.key] = r.value; });
        setEdits(initial);
      })
      .catch(() => setMsg({ type: "err", text: c.saveErr }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const resp = await adminFetch("/api/v1/system-config/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edits),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || c.saveErr);
      if (data.restart_needed && data.restart_needed.length > 0) {
        setRestartNeeded(data.restart_needed);
      }
      setMsg({ type: "ok", text: c.saved });
    } catch (e: unknown) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : c.saveErr });
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      const resp = await adminFetch("/api/v1/system-config/restart", { method: "POST" });
      const data = await resp.json();
      if (data.ok) {
        setMsg({ type: "ok", text: c.restartOk });
        setTimeout(() => window.location.reload(), 8000);
      } else {
        setMsg({ type: "err", text: c.restartErr });
      }
    } catch {
      setMsg({ type: "err", text: c.restartErr });
    } finally {
      setRestarting(false);
      setRestartNeeded(null);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const resp = await adminFetch("/api/v1/system-config/logo", {
        method: "POST",
        body: form,
      });
      if (resp.ok) {
        setMsg({ type: "ok", text: c.logoUploaded });
        // Add cache buster
        const logoEl = document.querySelector<HTMLImageElement>("img[data-system-logo]");
        if (logoEl) logoEl.src = `/system/logo.png?t=${Date.now()}`;
      } else {
        const data = await resp.json();
        setMsg({ type: "err", text: data.detail || c.saveErr });
      }
    } catch {
      setMsg({ type: "err", text: c.saveErr });
    }
  };

  const enterpriseRows = configs.filter((r) => r.category === "enterprise");
  const systemRows = configs.filter((r) => r.category === "system");

  const renderInput = (row: ConfigRow) => {
    const val = edits[row.key] ?? row.value;
    const onChange = (v: string) => setEdits((prev) => ({ ...prev, [row.key]: v }));

    if (row.input_type === "textarea") {
      return (
        <textarea
          value={val}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y"
        />
      );
    }
    if (row.input_type === "select" && row.options) {
      let opts: string[] = [];
      try { opts = JSON.parse(row.options); } catch { /* ignore */ }
      return (
        <select
          value={val}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {opts.map((o) => (
            <option key={o} value={o}>{o === "routes_only" ? "仅路由别名" : o === "all" ? "全部模型" : o}</option>
          ))}
        </select>
      );
    }
    if (row.input_type === "number") {
      return (
        <input
          type="number"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      );
    }
    return (
      <input
        type="text"
        value={val}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    );
  };

  if (loading) return <div className="p-6 text-sm text-slate-400">加载中...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{c.title}</h2>
        <p className="text-sm text-slate-500 mt-1">{c.subtitle}</p>
      </div>

      {msg && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${msg.type === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-700"}`}
        >
          {msg.text}
        </div>
      )}

      {/* Restart dialog */}
      {restartNeeded && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">{c.restartTitle}</p>
          <p className="text-sm text-amber-700 mt-1">
            {c.restartMsg(restartNeeded.map((k) => {
              const r = configs.find((cr) => cr.key === k);
              return r ? r.label : k;
            }).join("、"))}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleRestart}
              disabled={restarting}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {restarting ? c.restarting : c.restartNow}
            </button>
            <button
              type="button"
              onClick={() => setRestartNeeded(null)}
              className="rounded-lg border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              {c.restartLater}
            </button>
          </div>
        </div>
      )}

      {/* Enterprise section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900 mb-4">{c.enterpriseTitle}</h3>

        {/* Logo upload */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">{c.logoLabel}</label>
          <div className="flex items-center gap-4">
            <img
              data-system-logo
              src={`/system/logo.png?t=${Date.now()}`}
              alt="Logo"
              className="h-10 w-auto object-contain rounded border border-slate-200"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              {c.logoHint}
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleLogoUpload} className="hidden" />
            </label>
          </div>
        </div>

        {enterpriseRows.map((row) => (
          <div key={row.key} className="mb-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">{row.label}</label>
            {renderInput(row)}
          </div>
        ))}
      </div>

      {/* System section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900 mb-4">{c.systemTitle}</h3>
        {systemRows.map((row) => (
          <div key={row.key} className="mb-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {row.label}
              {row.env_var && <span className="text-slate-400 font-normal ml-2">({row.env_var})</span>}
            </label>
            {renderInput(row)}
          </div>
        ))}
      </div>

      {/* Save button */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? c.saving : c.save}
        </button>
      </div>
    </div>
  );
}
