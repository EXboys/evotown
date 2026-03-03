import { ReactNode } from "react";

/** FC 风格菜单项 — 带黑色三角光标 */
export function PixelMenu({
  items,
  selectedIndex,
  onSelect,
  renderItem,
}: {
  items: unknown[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem?: (item: unknown, index: number) => ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={`flex items-center gap-1 py-1 px-2 text-left text-3xs font-pixel text-white hover:bg-white/10 transition-none ${
            selectedIndex === i ? "bg-white/15" : ""
          }`}
        >
          {selectedIndex === i && (
            <span
              className="shrink-0 w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-black"
              style={{ marginRight: 4 }}
            />
          )}
          {renderItem ? renderItem(item, i) : String(item)}
        </button>
      ))}
    </div>
  );
}
