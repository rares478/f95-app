import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_STORE_SETTINGS,
  loadStoreSettings,
  saveStoreSettings,
  type StoreSettings,
} from '../lib/storeSettings';

interface StoreSettingsValue {
  settings: StoreSettings;
  loading: boolean;
  update: (patch: Partial<StoreSettings>) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<StoreSettingsValue | null>(null);

export function StoreSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await loadStoreSettings());
    } catch (err) {
      console.warn('[storeSettings] load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(async (patch: Partial<StoreSettings>) => {
    const next = await saveStoreSettings(patch);
    setSettings(next);
  }, []);

  return <Ctx.Provider value={{ settings, loading, update, reload }}>{children}</Ctx.Provider>;
}

export function useStoreSettings(): StoreSettingsValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useStoreSettings must be used within StoreSettingsProvider');
  }
  return ctx;
}
