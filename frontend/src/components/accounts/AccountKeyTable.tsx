import type { GatewayApiKey } from "../GatewayAccountsPanel";

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type AccountKeyTableProps = {
  keys: GatewayApiKey[];
  busy: boolean;
  onEdit: (key: GatewayApiKey) => void;
  onRevoke: (keyId: string) => void;
};

export function AccountKeyTable({ keys, busy, onEdit, onRevoke }: AccountKeyTableProps) {
  if (!keys.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-500">
        该账号暂无 API Key，点击「签发 Key」生成员工 evk_ 密钥。
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5">Key</th>
            <th className="hidden px-3 py-2.5 md:table-cell">用量</th>
            <th className="px-3 py-2.5">状态</th>
            <th className="w-24 px-3 py-2.5 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {keys.map((key) => {
            const usedTokens = key.monthly_usage?.total_tokens ?? 0;
            const usedCost = key.monthly_usage?.cost_usd ?? 0;
            const tokenLimit = key.monthly_token_limit ?? 0;
            const costLimit = key.monthly_cost_limit_usd ?? 0;
            return (
              <tr key={key.key_id}>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-900">{key.label || key.key_id}</div>
                  <div className="font-mono text-xs text-slate-500">{key.key_prefix}…</div>
                  <div className="mt-0.5 text-xs text-slate-400">{(key.scopes || []).join(", ") || "gateway.chat"}</div>
                </td>
                <td className="hidden px-3 py-2.5 text-xs text-slate-600 md:table-cell">
                  <div>{usedTokens} / {tokenLimit || "∞"} tok</div>
                  <div>${Number(usedCost).toFixed(4)} / {costLimit ? `$${costLimit}` : "∞"}</div>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      key.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {key.status === "active" ? "有效" : "已吊销"}
                  </span>
                  <div className="mt-1 text-xs text-slate-400">{formatDate(key.last_used_at)}</div>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    {key.status === "active" && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onEdit(key)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onRevoke(key.key_id)}
                          className="text-xs font-medium text-red-600 hover:text-red-800"
                        >
                          吊销
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
