import { useEffect, useState } from 'react';
import {
  getExperimentalSettings,
  loadExperimentalSettings,
  subscribeExperimentalSettings,
  type ExperimentalSettings,
} from '../lib/experimentalSettings';

export function useExperimentalSettings(): ExperimentalSettings {
  const [value, setValue] = useState<ExperimentalSettings>(() => getExperimentalSettings());

  useEffect(() => {
    let cancelled = false;
    void loadExperimentalSettings().then((s) => {
      if (!cancelled) setValue(s);
    });
    const unsub = subscribeExperimentalSettings((s) => {
      if (!cancelled) setValue(s);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return value;
}
