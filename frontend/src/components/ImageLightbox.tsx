import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";

export type LightboxImage = {
  src: string;
  alt: string;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

type ImageLightboxProps = {
  image: LightboxImage | null;
  onClose: () => void;
};

export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!image) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [image?.src]);

  useEffect(() => {
    if (!image) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [image, onClose]);

  const clampScale = useCallback((value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)), []);

  const zoomBy = useCallback(
    (delta: number) => {
      setScale((current) => clampScale(Number((current + delta).toFixed(2))));
    },
    [clampScale],
  );

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP);
    },
    [zoomBy],
  );

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || "图片预览"}
      onClick={onClose}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 truncate text-sm text-white/80">{image.alt || "图片预览"}</p>
        <div className="flex shrink-0 items-center gap-1">
          <LightboxButton label="缩小" onClick={() => zoomBy(-SCALE_STEP)}>
            −
          </LightboxButton>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-white/70">
            {Math.round(scale * 100)}%
          </span>
          <LightboxButton label="放大" onClick={() => zoomBy(SCALE_STEP)}>
            +
          </LightboxButton>
          <LightboxButton label="重置" onClick={resetView}>
            1:1
          </LightboxButton>
          <LightboxButton label="关闭" onClick={onClose}>
            ✕
          </LightboxButton>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onClick={(event) => event.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            ox: offset.x,
            oy: offset.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const dx = event.clientX - dragRef.current.x;
          const dy = event.clientY - dragRef.current.y;
          setOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <img
          src={image.src}
          alt={image.alt}
          draggable={false}
          className="absolute left-1/2 top-1/2 max-h-none max-w-none select-none"
          style={{
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
            transformOrigin: "center center",
          }}
        />
      </div>

      <p className="shrink-0 px-4 py-2 text-center text-xs text-white/50">
        滚轮缩放 · 拖拽平移 · Esc 关闭 · 点击背景关闭
      </p>
    </div>
  );
}

function LightboxButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-sm text-white hover:bg-white/20"
    >
      {children}
    </button>
  );
}

type ClickableConversationImageProps = {
  src: string;
  alt: string;
  className?: string;
  onOpen: (image: LightboxImage) => void;
};

/** 对话区缩略图：点击打开灯箱。 */
export function ClickableConversationImage({ src, alt, className = "", onOpen }: ClickableConversationImageProps) {
  return (
    <button
      type="button"
      aria-label={`查看大图：${alt}`}
      onClick={() => onOpen({ src, alt })}
      className="group block max-w-full cursor-zoom-in rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
    >
      <img
        src={src}
        alt={alt}
        className={`${className} transition group-hover:brightness-110 group-hover:ring-2 group-hover:ring-white/40`.trim()}
      />
    </button>
  );
}
