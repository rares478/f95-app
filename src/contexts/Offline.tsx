import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as ipc from '../lib/ipc';
import * as settings from '../lib/settings';

export type OfflineReason = 'manual' | 'network' | 'f95' | null;

export interface OfflineContextValue {
  isOffline: boolean;
  offlineReason: OfflineReason;
  manualOffline: boolean;
  setManualOffline: (value: boolean) => Promise<void>;
  refreshConnectivity: () => Promise<void>;
  lastCheckedAt: number | null;
  probing: boolean;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

const PROBE_INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 400;

function reasonFromStatus(
  manual: boolean,
  status: ipc.NetworkStatus | null,
): OfflineReason {
  if (manual) return 'manual';
  if (!status) return 'network';
  if (!status.internet) return 'network';
  if (!status.f95Reachable) return 'f95';
  return null;
}

function isOfflineFrom(
  manual: boolean,
  status: ipc.NetworkStatus | null,
): boolean {
  if (manual) return true;
  if (!status) return false;
  return !status.internet || !status.f95Reachable;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [manualOffline, setManualOfflineState] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<ipc.NetworkStatus | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshConnectivity = useCallback(async () => {
    setProbing(true);
    try {
      const status = await ipc.checkNetwork();
      setNetworkStatus(status);
      setLastCheckedAt(Date.now());
    } catch {
      setNetworkStatus({ internet: false, f95Reachable: false });
      setLastCheckedAt(Date.now());
    } finally {
      setProbing(false);
    }
  }, []);

  const setManualOffline = useCallback(async (value: boolean) => {
    await settings.setBool(settings.KEY_OFFLINE_MODE_MANUAL, value);
    setManualOfflineState(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const manual = await settings.getBool(settings.KEY_OFFLINE_MODE_MANUAL, false);
      if (!cancelled) setManualOfflineState(manual);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshConnectivity();
    const id = window.setInterval(() => void refreshConnectivity(), PROBE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshConnectivity]);

  useEffect(() => {
    const onOnline = () => {
      setBrowserOffline(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void refreshConnectivity(), DEBOUNCE_MS);
    };
    const onOffline = () => setBrowserOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refreshConnectivity]);

  const effectiveStatus = useMemo((): ipc.NetworkStatus | null => {
    if (browserOffline) {
      return { internet: false, f95Reachable: false };
    }
    return networkStatus;
  }, [browserOffline, networkStatus]);

  const offlineReason = reasonFromStatus(manualOffline, effectiveStatus);
  const isOffline = isOfflineFrom(manualOffline, effectiveStatus);

  const value = useMemo<OfflineContextValue>(
    () => ({
      isOffline,
      offlineReason,
      manualOffline,
      setManualOffline,
      refreshConnectivity,
      lastCheckedAt,
      probing,
    }),
    [
      isOffline,
      offlineReason,
      manualOffline,
      setManualOffline,
      refreshConnectivity,
      lastCheckedAt,
      probing,
    ],
  );

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error('useOffline must be used within OfflineProvider');
  }
  return ctx;
}

/** For login window (no OfflineProvider): quick offline probe. */
export async function probeOfflineQuick(): Promise<boolean> {
  const manual = await settings.getBool(settings.KEY_OFFLINE_MODE_MANUAL, false);
  if (manual) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  try {
    const status = await ipc.checkNetwork();
    return !status.internet || !status.f95Reachable;
  } catch {
    return true;
  }
}
