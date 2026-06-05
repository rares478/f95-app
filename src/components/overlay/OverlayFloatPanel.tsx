import { useCallback, useRef, type ReactNode } from 'react';
import { OverlayCloseIcon } from './overlayIcons';
import type { OverlayPanelLayout } from './overlayPanelLayouts';

interface Props {
  title: string;
  layout: OverlayPanelLayout;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onLayoutChange: (layout: OverlayPanelLayout) => void;
  children: ReactNode;
}

export function OverlayFloatPanel({
  title,
  layout,
  zIndex,
  onFocus,
  onClose,
  onLayoutChange,
  children,
}: Props) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.game-overlay-float-close')) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: layout.x,
        origY: layout.y,
      };
      onFocus();
    },
    [layout.x, layout.y, onFocus],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      onLayoutChange({
        ...layout,
        x: drag.origX + (e.clientX - drag.startX),
        y: drag.origY + (e.clientY - drag.startY),
      });
    },
    [layout, onLayoutChange],
  );

  const onDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origW: layout.w,
        origH: layout.h,
      };
      onFocus();
    },
    [layout.h, layout.w, onFocus],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== e.pointerId) return;
      onLayoutChange({
        ...layout,
        w: resize.origW + (e.clientX - resize.startX),
        h: resize.origH + (e.clientY - resize.startY),
      });
    },
    [layout, onLayoutChange],
  );

  const onResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <section
      className="game-overlay-float"
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        zIndex,
      }}
      onPointerDown={onFocus}
    >
      <header
        className="game-overlay-float-header"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className="game-overlay-float-title">{title}</span>
        <button
          type="button"
          className="game-overlay-float-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
        >
          <OverlayCloseIcon size={12} />
        </button>
      </header>
      <div className="game-overlay-float-body">{children}</div>
      <div
        className="game-overlay-float-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        aria-hidden
      />
    </section>
  );
}
