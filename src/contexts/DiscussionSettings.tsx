import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_DISCUSSION_SETTINGS,
  loadDiscussionSettings,
  saveDiscussionSettings,
  type DiscussionSettings,
} from '../lib/discussionSettings';

interface DiscussionSettingsValue {
  settings: DiscussionSettings;
  loading: boolean;
  update: (patch: Partial<DiscussionSettings>) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<DiscussionSettingsValue | null>(null);

export function DiscussionSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DiscussionSettings>(DEFAULT_DISCUSSION_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await loadDiscussionSettings());
    } catch (err) {
      console.warn('[discussionSettings] load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(async (patch: Partial<DiscussionSettings>) => {
    const next = await saveDiscussionSettings(patch);
    setSettings(next);
  }, []);

  return <Ctx.Provider value={{ settings, loading, update, reload }}>{children}</Ctx.Provider>;
}

export function useDiscussionSettings(): DiscussionSettingsValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useDiscussionSettings must be used within DiscussionSettingsProvider');
  }
  return ctx;
}
