import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  loadDownloadSettings,
  saveDownloadSettings,
  type DownloadSettings,
} from '../lib/downloadSettings';

interface DownloadSettingsValue {
  settings: DownloadSettings;
  loading: boolean;
  update: (patch: Partial<DownloadSettings>) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<DownloadSettingsValue | null>(null);

export function DownloadSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DownloadSettings>(DEFAULT_DOWNLOAD_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await loadDownloadSettings());
    } catch (err) {
      console.warn('[downloadSettings] load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = useCallback(async (patch: Partial<DownloadSettings>) => {
    const next = await saveDownloadSettings(patch);
    setSettings(next);
  }, []);

  return (
    <Ctx.Provider value={{ settings, loading, update, reload }}>{children}</Ctx.Provider>
  );
}

export function useDownloadSettings(): DownloadSettingsValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useDownloadSettings must be used within DownloadSettingsProvider');
  }
  return ctx;
}
