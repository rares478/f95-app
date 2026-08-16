import { useState, type FormEvent } from 'react';
import { useT } from '../../../lib/i18n';

interface Props {
  onUnlock: (password: string) => void;
  unlocking?: boolean;
  error?: string | null;
  disabled?: boolean;
}

export function UnityUnlockPanel({
  onUnlock,
  unlocking = false,
  error = null,
  disabled = false,
}: Props) {
  const { t } = useT();
  const [password, setPassword] = useState('');
  const busy = unlocking || disabled;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (!trimmed || busy) return;
    onUnlock(trimmed);
  };

  return (
    <div className="save-editor-col">
      <div className="save-editor-col-head">{t('saveEditor.unity.locked')}</div>
      <div className="save-editor-col-body">
        <form className="save-editor-unlock" onSubmit={submit}>
          <label className="save-editor-unlock-label" htmlFor="unity-save-password">
            {t('saveEditor.unity.password')}
          </label>
          <input
            id="unity-save-password"
            className="save-editor-search"
            type="password"
            autoComplete="off"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="save-editor-unlock-error">{error}</p>}
          <button
            type="submit"
            className="save-editor-apply"
            disabled={busy || !password.trim()}
          >
            {t('saveEditor.unity.unlock')}
          </button>
        </form>
      </div>
    </div>
  );
}
