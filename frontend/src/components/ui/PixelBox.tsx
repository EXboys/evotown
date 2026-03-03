import { ReactNode } from "react";

/** FC 风格像素框 — 黑底 + 白边，直角 */
export function PixelBox({
  children,
  className = "",
  border = true,
}: {
  children: ReactNode;
  className?: string;
  border?: boolean;
}) {
  return (
    <div
      className={`bg-black ${border ? "border-2 border-white" : ""} ${className}`}
      style={{ boxShadow: border ? "inset 0 0 0 1px rgba(255,255,255,0.2)" : undefined }}
    >
      {children}
    </div>
  );
}
