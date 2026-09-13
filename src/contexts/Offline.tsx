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
  /**
   * Alerts (and similar F95 session traffic) report reachability here so we
   * do not need a periodic F95 HEAD while the main app is running.
   */
  reportF95Reachability: (ok: boolean) => void;
  lastCheckedAt: number | null;
  probing: boolean;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

/** Internet-only background probe — F95 up/down comes from alerts. */
const INTERNET_PROBE_INTERVAL_MS = 5 * 60_000;
const DEBOUNCE_MS = 400;
/** Consecutive alerts failures before flipping to F95-offline. */
const F95_FAIL_STREAK_BEFORE_DOWN = 2;

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

function statusEqual(a: ipc.NetworkStatus | null, b: ipc.NetworkStatus): boolean {
  return !!a && a.internet === b.internet && a.f95Reachable === b.f95Reachable;
}

function isReachable(status: ipc.NetworkStatus): boolean {
  return status.internet && status.f95Reachable;
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
  const networkStatusRef = useRef<ipc.NetworkStatus | null>(null);
  networkStatusRef.current = networkStatus;
  const f95FailStreakRef = useRef(0);

  const applyProbeResult = useCallback((status: ipc.NetworkStatus, interactive: boolean) => {
    const same = statusEqual(networkStatusRef.current, status);
    if (!same) setNetworkStatus(status);
    // Background polls should not re-render the whole app on every tick.
    if (interactive || !same) setLastCheckedAt(Date.now());
  }, []);

  const reportF95Reachability = useCallback((ok: boolean) => {
    if (ok) {
      f95FailStreakRef.current = 0;
      const prev = networkStatusRef.current;
      if (prev?.f95Reachable === true) return;
      applyProbeResult(
        {
          internet: prev?.internet ?? true,
          f95Reachable: true,
        },
        false,
      );
      return;
    }
    f95FailStreakRef.current += 1;
    if (f95FailStreakRef.current < F95_FAIL_STREAK_BEFORE_DOWN) return;
    const prev = networkStatusRef.current;
    if (prev?.f95Reachable === false) return;
    applyProbeResult(
      {
        internet: prev?.internet ?? true,
        f95Reachable: false,
      },
      false,
    );
  }, [applyProbeResult]);

  const refreshConnectivity = useCallback(async (opts?: {
    interactive?: boolean;
    /** When omitted: true for interactive, false for background. */
    probeF95?: boolean;
  }) => {
    const interactive = opts?.interactive ?? true;
    const probeF95 = opts?.probeF95 ?? interactive;
    if (interactive) setProbing(true);
    try {
      let status = await ipc.checkNetwork({ probeF95 });
      if (!probeF95) {
        status = {
          internet: status.internet,
          f95Reachable: networkStatusRef.current?.f95Reachable ?? true,
        };
      } else if (status.f95Reachable) {
        f95FailStreakRef.current = 0;
      }
      // Confirm a failed probe once — probes flap and used to remount pages.
      if (!isReachable(status)) {
        await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
        status = await ipc.checkNetwork({ probeF95 });
        if (!probeF95) {
          status = {
            internet: status.internet,
            f95Reachable: networkStatusRef.current?.f95Reachable ?? true,
          };
        } else if (status.f95Reachable) {
          f95FailStreakRef.current = 0;
        }
      }
      applyProbeResult(status, interactive);
    } catch {
      applyProbeResult(
        {
          internet: false,
          f95Reachable: probeF95
            ? false
            : (networkStatusRef.current?.f95Reachable ?? false),
        },
        interactive,
      );
    } finally {
      if (interactive) setProbing(false);
    }
  }, [applyProbeResult]);

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
    void refreshConnectivity({ interactive: false, probeF95: false });
    const id = window.setInterval(
      () => void refreshConnectivity({ interactive: false, probeF95: false }),
      INTERNET_PROBE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [refreshConnectivity]);

  useEffect(() => {
    const onOnline = () => {
      setBrowserOffline(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Full probe on OS online — includes F95 HEAD for a clean recovery.
      debounceRef.current = setTimeout(
        () => void refreshConnectivity({ interactive: false, probeF95: true }),
        DEBOUNCE_MS,
      );
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
      refreshConnectivity: () => refreshConnectivity({ interactive: true, probeF95: true }),
      reportF95Reachability,
      lastCheckedAt,
      probing,
    }),
    [
      isOffline,
      offlineReason,
      manualOffline,
      setManualOffline,
      refreshConnectivity,
      reportF95Reachability,
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

/** Host probe budget for login bootstrap — must stay below sidecar RPC timeouts. */
const QUICK_PROBE_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** For login window (no OfflineProvider): quick offline probe (internet + F95). */
export async function probeOfflineQuick(): Promise<boolean> {
  const manual = await settings.getBool(settings.KEY_OFFLINE_MODE_MANUAL, false);
  if (manual) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  try {
    // Frontend deadline in case the host command never settles (seen as a
    // permanent "Loading session…" hang with only "login window ready" logged).
    const status = await withTimeout(
      ipc.checkNetwork({ probeF95: true }),
      QUICK_PROBE_TIMEOUT_MS,
      'checkNetwork',
    );
    return !status.internet || !status.f95Reachable;
  } catch {
    return true;
  }
}
