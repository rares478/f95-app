import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SaveEditor } from '../components/library/saveEditor/SaveEditor';
import { LoadingState } from '../components/ui/LoadingState';
import * as library from '../lib/library';
import { useT } from '../lib/i18n';
import type { LibraryGame } from '../types/library';

export function LibrarySaveEditorPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!threadId) return;
    library
      .get(threadId)
      .then((g) => {
        if (!g) setMissing(true);
        else setGame(g);
      })
      .catch(() => setMissing(true));
  }, [threadId]);

  if (missing) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        <p>{t('libdetail.missing')}</p>
        <button type="button" onClick={() => navigate('/library')}>
          {t('saveEditor.back')}
        </button>
      </div>
    );
  }

  if (!game) {
    return (
      <div style={{ padding: 24 }}>
        <LoadingState label={t('common.loading')} variant="page" />
      </div>
    );
  }

  return (
    <div className="save-editor-page">
      <SaveEditor game={game} onClose={() => navigate(-1)} />
    </div>
  );
}
