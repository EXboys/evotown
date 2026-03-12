import { useState } from "react";
import { adminFetch } from "../../hooks/useAdminToken";

export interface SoulData {
  content: string;
  soul_type: string;
}

interface SoulTabProps {
  agentId: string;
  soul: SoulData | null;
  onSoulChange: (soul: SoulData | null) => void;
}

export function SoulTab({ agentId, soul, onSoulChange }: SoulTabProps) {
  const [soulEdit, setSoulEdit] = useState(soul?.content ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await adminFetch(`/agents/${agentId}/soul`, {
        method: "PUT",
        body: JSON.stringify({ content: soulEdit }),
      });
      const data = await res.json();
      if (data?.ok) {
        onSoulChange(soulEdit ? { content: soulEdit, soul_type: "balanced" } : null);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {soul ? (
          <span className="text-slate-500 text-xs">
            类型: {soul.soul_type === "conservative" ? "保守" : soul.soul_type === "aggressive" ? "激进" : "均衡"}
          </span>
        ) : (
          <span className="text-slate-500 text-xs">Soul 文件</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || (soul ? soulEdit === soul.content : false)}
          className="px-3 py-1 text-xs rounded bg-evo-accent/20 text-evo-accent border border-evo-accent/20 hover:bg-evo-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
      <textarea
        value={soulEdit}
        onChange={(e) => setSoulEdit(e.target.value)}
        className="w-full h-64 p-3 rounded bg-slate-800/50 border border-slate-700/50 text-slate-300 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-evo-accent/50"
        placeholder="SOUL.md"
        spellCheck={false}
      />
    </div>
  );
}
