import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ExtractAssignModal,
  type PendingAssign,
} from '../components/library/ExtractAssignModal';
import {
  INSTALL_NEEDS_ASSIGN_EVENT,
  type InstallNeedsAssignDetail,
} from '../lib/installJobExtract';
import { useDownloads } from './downloadsContext';

export type { PendingAssign };

interface InstallAssignContextValue {
  pending: PendingAssign | null;
  openAssign: (detail: InstallNeedsAssignDetail) => void;
  closeAssign: () => void;
}

const InstallAssignContext = createContext<InstallAssignContextValue | null>(
  null,
);

function detailToPending(detail: InstallNeedsAssignDetail): PendingAssign {
  return {
    jobId: detail.jobId,
    planId: detail.planId,
    threadId: detail.threadId,
    exePath: detail.exePath ?? null,
  };
}

export function InstallAssignProvider({ children }: { children: ReactNode }) {
  const { reload } = useDownloads();
  const [pending, setPending] = useState<PendingAssign | null>(null);

  const openAssign = useCallback((detail: InstallNeedsAssignDetail) => {
    setPending(detailToPending(detail));
  }, []);

  const closeAssign = useCallback(() => {
    setPending(null);
  }, []);

  useEffect(() => {
    function onNeedsAssign(ev: Event) {
      const ce = ev as CustomEvent<InstallNeedsAssignDetail>;
      if (!ce.detail?.jobId) return;
      setPending(detailToPending(ce.detail));
    }
    window.addEventListener(INSTALL_NEEDS_ASSIGN_EVENT, onNeedsAssign);
    return () => {
      window.removeEventListener(INSTALL_NEEDS_ASSIGN_EVENT, onNeedsAssign);
    };
  }, []);

  const value = useMemo(
    () => ({ pending, openAssign, closeAssign }),
    [pending, openAssign, closeAssign],
  );

  return (
    <InstallAssignContext.Provider value={value}>
      {children}
      <ExtractAssignModal
        pending={pending}
        onClose={closeAssign}
        onDone={async () => {
          closeAssign();
          try {
            await reload();
          } catch {
            /* ignore */
          }
        }}
      />
    </InstallAssignContext.Provider>
  );
}

export function useInstallAssign(): InstallAssignContextValue {
  const ctx = useContext(InstallAssignContext);
  if (!ctx) {
    throw new Error('useInstallAssign must be used within InstallAssignProvider');
  }
  return ctx;
}
