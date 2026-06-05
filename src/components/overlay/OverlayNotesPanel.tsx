import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import * as library from '../../lib/library';

interface Props {
  threadId: string;
  enabled: boolean;
}

const AUTOSAVE_MS = 700;

export function OverlayNotesPanel({ threadId, enabled }: Props) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersisted = useRef('');
  const activeThread = useRef(threadId);

  const persist = useCallback(
    async (value: string, forThread: string) => {
      if (forThread !== activeThread.current) return;
      if (value === lastPersisted.current) return;
      setSaving(true);
      try {
        await library.setNotes(forThread, value);
        if (forThread !== activeThread.current) return;
        lastPersisted.current = value;
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
      } finally {
        if (forThread === activeThread.current) setSaving(false);
      }
    },
    [],
  );

  useEffect(() => {
    activeThread.current = threadId;
    let cancelled = false;
    setLoading(true);
    setSaved(false);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    void library.get(threadId).then((g) => {
      if (cancelled || activeThread.current !== threadId) return;
      const notes = g?.notes ?? '';
      setDraft(notes);
      lastPersisted.current = notes;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const scheduleSave = useCallback(
    (value: string) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      const forThread = activeThread.current;
      autosaveTimer.current = setTimeout(() => {
        void persist(value, forThread);
      }, AUTOSAVE_MS);
    },
    [persist],
  );

  if (!enabled) {
    return (
      <div className="game-overlay-panel-fill game-overlay-panel--disabled">
        {t('overlay.notes.disabled')}
      </div>
    );
  }

  return (
    <div className="game-overlay-notes-wrap">
      <div className="game-overlay-notes-toolbar">
        <span className="game-overlay-notes-status-line">
          {loading && <span className="game-overlay-notes-saving">{t('overlay.notes.loading')}</span>}
          {saving && !loading && (
            <span className="game-overlay-notes-saving">{t('overlay.notes.saving')}</span>
          )}
          {saved && !saving && !loading && (
            <span className="game-overlay-notes-status">{t('overlay.notes.saved')}</span>
          )}
        </span>
      </div>
      <textarea
        className="game-overlay-notes"
        value={draft}
        disabled={loading}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          setSaved(false);
          scheduleSave(next);
        }}
        onBlur={() => void persist(draft, activeThread.current)}
        placeholder={t('overlay.notes.placeholder')}
      />
    </div>
  );
}
