/**
 * CRT 扫描线 + 轻微暗角 overlay，叠在 Phaser 画布上，强化吞食天地2 情怀。
 * 使用 pointer-events: none 保证点击穿透。
 */
export function ScanlineOverlay() {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-10"
      aria-hidden
      style={{
        background: `
          repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 2px,
            rgba(0,0,0,0.14) 3px
          ),
          radial-gradient(
            ellipse 80% 80% at 50% 50%,
            transparent 60%,
            rgba(0,0,0,0.25) 100%
          )
        `,
        backgroundSize: "100% 4px, 100% 100%",
      }}
    />
  );
}
