import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearDevLogs,
  devLogStats,
  isDevDebugEnabled,
  knownDevLogTags,
  subscribeDevLogs,
  type DevLogEntry,
  type DevLogLevel,
} from '../lib/devDebug';
import {
  loadDevDebugSettings,
  saveDevDebugSettings,
  subscribeDevDebugSettings,
  getDevDebugSettings,
  clampFloatGeom,
  clampFloatPosition,
  DEFAULT_FLOAT_GEOM,
  isFloatGeomOversized,
  type DevDebugLayout,
  type DevDebugSettings,
  type DevDebugFloatGeom,
} from '../lib/devDebugSettings';
import { useT } from '../lib/i18n';

function formatTs(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n)) return ts;
  const d = new Date(n);
  const base = d.toLocaleTimeString();
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${base}.${ms}`;
}

const LEVEL_CLASS: Record<DevLogLevel, string> = {
  debug: 'dev-debug-level--debug',
  info: 'dev-debug-level--info',
  warn: 'dev-debug-level--warn',
  error: 'dev-debug-level--error',
};

const FLOAT_TOOLBAR_H = 38;

type DragState = { startX: number; startY: number; originX: number; originY: number };
type ResizeState = { startX: number; startY: number; originW: number; originH: number };

export function DevDebugConsole() {
  const { t } = useT();
  const [cfg, setCfg] = useState<DevDebugSettings | null>(null);
  const [rows, setRows] = useState<DevLogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const bodyRef = useRef<HTMLPreElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const floatGeomRef = useRef<DevDebugFloatGeom>(clampFloatGeom(DEFAULT_FLOAT_GEOM));
  const collapsedRef = useRef(false);
  const [floatGeom, setFloatGeomRaw] = useState(() =>
    clampFloatGeom(getDevDebugSettings().floatGeom),
  );

  collapsedRef.current = cfg?.collapsed ?? false;

  const visibleFloatHeight = (collapsed: boolean, h: number) =>
    collapsed ? FLOAT_TOOLBAR_H : h;

  const setFloatGeom = useCallback(
    (value: DevDebugFloatGeom | ((prev: DevDebugFloatGeom) => DevDebugFloatGeom)) => {
      setFloatGeomRaw((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        const collapsed = collapsedRef.current;
        const clamped = clampFloatGeom(next, visibleFloatHeight(collapsed, next.h));
        floatGeomRef.current = clamped;
        return clamped;
      });
    },
    [],
  );

  useEffect(() => {
    void loadDevDebugSettings().then(setCfg);
    return subscribeDevDebugSettings(setCfg);
  }, []);

  useEffect(() => {
    if (!cfg?.panelEnabled) return;
    return subscribeDevLogs(setRows);
  }, [cfg?.panelEnabled]);

  useEffect(() => {
    if (cfg?.layout !== 'float') return;
    const collapsed = cfg.collapsed;
    const geom = clampFloatGeom(
      isFloatGeomOversized(cfg.floatGeom) ? DEFAULT_FLOAT_GEOM : cfg.floatGeom,
      visibleFloatHeight(collapsed, cfg.floatGeom?.h ?? DEFAULT_FLOAT_GEOM.h),
    );
    setFloatGeom(geom);
    if (isFloatGeomOversized(cfg.floatGeom)) {
      void saveDevDebugSettings({ floatGeom: geom });
    }
  }, [cfg?.layout, cfg?.collapsed, setFloatGeom]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || cfg?.collapsed) return;
    el.scrollTop = el.scrollHeight;
  }, [rows, cfg?.collapsed]);

  const persistFloatGeom = useCallback((geom: DevDebugFloatGeom) => {
    void saveDevDebugSettings({ floatGeom: clampFloatGeom(geom) });
  }, []);

  const onLayout = async (layout: DevDebugLayout) => {
    if (layout === 'float') {
      const geom = clampFloatGeom(
        isFloatGeomOversized(getDevDebugSettings().floatGeom)
          ? DEFAULT_FLOAT_GEOM
          : getDevDebugSettings().floatGeom,
      );
      setFloatGeom(geom);
      await saveDevDebugSettings({ layout, collapsed: false, floatGeom: geom });
      return;
    }
    await saveDevDebugSettings({ layout, collapsed: false });
  };

  const onToggleCollapsed = async () => {
    if (!cfg) return;
    const nextCollapsed = !cfg.collapsed;
    if (cfg.layout === 'float') {
      const base = floatGeomRef.current;
      const pos = clampFloatPosition(base, {
        w: base.w,
        h: visibleFloatHeight(nextCollapsed, base.h),
      });
      const geom = { ...base, ...pos };
      setFloatGeom(geom);
      await saveDevDebugSettings({ collapsed: nextCollapsed, floatGeom: geom });
      return;
    }
    await saveDevDebugSettings({ collapsed: nextCollapsed });
  };

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const onDragPointerDown = (e: React.PointerEvent) => {
    if (cfg?.layout !== 'float') return;
    if ((e.target as HTMLElement).closest('button, input, .dev-debug-layout-btns, .dev-debug-resize-handle')) {
      return;
    }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: floatGeomRef.current.x,
      originY: floatGeomRef.current.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setFloatGeom({
      ...floatGeomRef.current,
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
  };

  const onDragPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    persistFloatGeom(floatGeomRef.current);
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originW: floatGeomRef.current.w,
      originH: floatGeomRef.current.h,
    };
    setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const resize = resizeRef.current;
    if (!resize) return;
    const dx = e.clientX - resize.startX;
    const dy = e.clientY - resize.startY;
    setFloatGeom({
      ...floatGeomRef.current,
      w: resize.originW + dx,
      h: resize.originH + dy,
    });
  };

  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    persistFloatGeom(floatGeomRef.current);
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeTags.size > 0 && !activeTags.has(r.tag)) return false;
      if (!q) return true;
      return (
        r.tag.toLowerCase().includes(q) ||
        r.message.toLowerCase().includes(q) ||
        r.level.includes(q)
      );
    });
  }, [rows, filter, activeTags]);

  const stats = useMemo(() => devLogStats(rows), [rows]);

  if (!cfg || !isDevDebugEnabled()) return null;

  const floatStyle =
    cfg.layout === 'float'
      ? {
          left: floatGeom.x,
          top: floatGeom.y,
          width: floatGeom.w,
          height: cfg.collapsed ? FLOAT_TOOLBAR_H : floatGeom.h,
        }
      : undefined;

  return (
    <div
      ref={panelRef}
      className={[
        'dev-debug',
        `dev-debug--${cfg.layout}`,
        cfg.collapsed ? 'dev-debug--collapsed' : '',
        dragging ? 'dev-debug--dragging' : '',
        resizing ? 'dev-debug--resizing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={floatStyle}
    >
      <div
        className="dev-debug-toolbar"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
      >
        <button type="button" className="dev-debug-toggle" onClick={() => void onToggleCollapsed()}>
          {cfg.collapsed ? t('dev.panel.expand') : t('dev.panel.collapse')}
        </button>
        <span className="dev-debug-title">{t('dev.panel.title')}</span>
        <div className="dev-debug-layout-btns">
          <button
            type="button"
            className={cfg.layout === 'dock-bottom' ? 'is-active' : ''}
            title={t('dev.panel.dockBottom')}
            onClick={() => void onLayout('dock-bottom')}
          >
            ⊟
          </button>
          <button
            type="button"
            className={cfg.layout === 'dock-right' ? 'is-active' : ''}
            title={t('dev.panel.dockRight')}
            onClick={() => void onLayout('dock-right')}
          >
            ⊞
          </button>
          <button
            type="button"
            className={cfg.layout === 'float' ? 'is-active' : ''}
            title={t('dev.panel.float')}
            onClick={() => void onLayout('float')}
          >
            ⧉
          </button>
        </div>
        <input
          className="dev-debug-filter"
          placeholder={t('dev.panel.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="dev-debug-clear" onClick={() => clearDevLogs()}>
          {t('common.clear')}
        </button>
      </div>

      {!cfg.collapsed && (
        <>
          <div className="dev-debug-meta">
            <span>{t('dev.panel.stats', { count: stats.total, shown: visible.length })}</span>
            {stats.byLevel.error > 0 && (
              <span className="dev-debug-stat dev-debug-stat--error">
                {t('dev.panel.errors', { count: stats.byLevel.error })}
              </span>
            )}
            {stats.byLevel.warn > 0 && (
              <span className="dev-debug-stat dev-debug-stat--warn">
                {t('dev.panel.warnings', { count: stats.byLevel.warn })}
              </span>
            )}
            <div className="dev-debug-tags">
              {knownDevLogTags().map((tag) => {
                const count = stats.byTag[tag] ?? 0;
                if (count === 0 && !activeTags.has(tag)) return null;
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`dev-debug-tag-chip${activeTags.has(tag) ? ' is-active' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                    {count > 0 ? ` (${count})` : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <pre ref={bodyRef} className="dev-debug-body">
            {visible.length === 0 ? (
              <span className="dev-debug-empty">{t('dev.panel.empty')}</span>
            ) : (
              visible.map((r) => (
                <div
                  key={r.id}
                  className={`dev-debug-line ${LEVEL_CLASS[r.level]}`}
                  title={r.message}
                >
                  <span className="dev-debug-ts">{formatTs(r.ts)}</span>{' '}
                  <span className="dev-debug-tag">[{r.tag}]</span>{' '}
                  <span className="dev-debug-level">{r.level.toUpperCase()}</span>{' '}
                  <span className="dev-debug-msg">{r.message}</span>
                </div>
              ))
            )}
          </pre>
          {cfg.layout === 'float' && (
            <div
              className="dev-debug-resize-handle"
              aria-hidden
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerUp}
            />
          )}
        </>
      )}
    </div>
  );
}
