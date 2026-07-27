import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as libraries from '../lib/libraries';
import { useT } from '../lib/i18n';
import { LoadingState } from './ui/LoadingState';
import type { InstallLibraryWithDisk } from '../types/install-library';

interface Props {
  open: boolean;
  /** Title shown at the top of the modal. */
  title: string;
  /** Body description below the title. */
  description?: React.ReactNode;
  /** Primary action label ("Baixar aqui", "Mover para cá", etc). */
  primaryLabel: string;
  /** Pass a library id to exclude (e.g. the library that already hosts the
   *  install, when this modal is asking where to MOVE the install). */
  excludeLibraryId?: number;
  onConfirm: (lib: InstallLibraryWithDisk) => void;
  onCancel: () => void;
}

/**
 * Steam-style install location picker. Shows every registered library with
 * its free space; the user picks one and confirms. Default library is
 * pre-selected. Empty state (no libraries / all excluded) is rendered with
 * a helper note pointing at Settings.
 */
export function InstallLocationModal({
  open,
  title,
  description,
  primaryLabel,
  excludeLibraryId,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useT();
  const [libs, setLibs] = useState<InstallLibraryWithDisk[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    libraries
      .listWithDisk()
      .then((rows) => {
        if (cancelled) return;
        const usable = rows.filter((l) => l.id !== excludeLibraryId);
        setLibs(usable);
        // Pre-select the default if it's in the list, else the first.
        const def = usable.find((l) => l.isDefault) ?? usable[0];
        setSelectedId(def?.id ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('[install-modal] failed to load libraries', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, excludeLibraryId]);

  if (!open) return null;

  const selected = libs.find((l) => l.id === selectedId);

  return createPortal(
    <div style={overlayStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={titleStyle}>{title}</h2>
        {description && <div style={descStyle}>{description}</div>}

        {loading && (
          <LoadingState label={t('settings.libraries.loading')} variant="compact" />
        )}

        {!loading && libs.length === 0 && (
          <div style={emptyStyle}>{t('modal.install.empty')}</div>
        )}

        {!loading && libs.length > 0 && (
          <div style={listStyle}>
            {libs.map((lib) => {
              const selected = lib.id === selectedId;
              return (
                <button
                  key={lib.id}
                  onClick={() => setSelectedId(lib.id)}
                  style={{
                    ...rowStyle,
                    borderColor: selected ? 'var(--accent)' : 'var(--border)',
                    background: selected ? '#2a1a1c' : 'var(--bg-elevated)',
                  }}
                  disabled={!lib.disk.available}
                  title={!lib.disk.available ? t('settings.libraries.unavailable') : ''}
                >
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={rowLabelStyle}>{lib.label}</span>
                      {lib.isDefault && <span style={defaultPillStyle}>{t('settings.libraries.default')}</span>}
                      {!lib.disk.available && (
                        <span style={offlinePillStyle}>{t('settings.libraries.offline')}</span>
                      )}
                    </div>
                    <div style={rowPathStyle} title={lib.path}>
                      {lib.path}
                    </div>
                  </div>
                  <div style={rowFreeStyle}>
                    {lib.disk.available
                      ? libraries.formatFreeSpace(lib.disk.freeBytes)
                      : '—'}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div style={footerStyle}>
          <button style={cancelBtnStyle} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            style={primaryBtnStyle}
            disabled={!selected || loading}
            onClick={() => selected && onConfirm(selected)}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '20px 22px',
  width: 'min(540px, calc(100vw - 40px))',
  maxHeight: 'calc(100vh - 80px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-primary)',
};
const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-tertiary)',
  margin: 0,
};
const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  overflow: 'auto',
  maxHeight: 360,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  border: '2px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-primary)',
  textAlign: 'left',
};
const rowLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
};
const rowPathStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  fontFamily: 'monospace',
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const rowFreeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
};
const defaultPillStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: 'var(--text-primary)',
  background: 'var(--status-success)',
  padding: '1px 6px',
  borderRadius: 2,
};
const offlinePillStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: 'var(--text-primary)',
  background: 'var(--accent-strong)',
  padding: '1px 6px',
  borderRadius: 2,
};
const emptyStyle: React.CSSProperties = {
  padding: '20px 12px',
  textAlign: 'center',
  color: 'var(--text-secondary)',
  fontSize: 13,
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 6,
};
const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '6px 14px',
  borderRadius: 3,
  fontSize: 13,
  cursor: 'pointer',
};
const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--text-primary)',
  border: 'none',
  padding: '6px 16px',
  borderRadius: 3,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};
