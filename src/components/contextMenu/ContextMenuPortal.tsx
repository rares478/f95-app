import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ContextMenuItem } from './types';

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_PADDING = 8;
const ITEM_ESTIMATE = 32;

export function ContextMenuPortal({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) {
      setPos({ left: x, top: y });
      return;
    }
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(MENU_PADDING, window.innerWidth - rect.width - MENU_PADDING);
    const maxTop = Math.max(MENU_PADDING, window.innerHeight - rect.height - MENU_PADDING);
    setPos({
      left: Math.min(x, maxLeft),
      top: Math.min(y, maxTop),
    });
  }, [x, y, items]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const visibleItems = items.filter((it) => !it.hidden);

  return (
    <>
      <div
        className="context-menu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {visibleItems.map((item) =>
          item.separator ? (
            <div key={item.id} className="context-menu-separator" role="separator" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`context-menu-item${item.danger ? ' context-menu-item-danger' : ''}${
                item.disabled ? ' context-menu-item-disabled' : ''
              }`}
              disabled={item.disabled}
              title={item.title}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                onClose();
                void item.onClick();
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}

/** Rough pre-clamp height hint before layout measure. */
export function estimateMenuHeight(itemCount: number): number {
  return itemCount * ITEM_ESTIMATE + 12;
}
