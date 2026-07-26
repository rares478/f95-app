import type { DownloadRow } from '../types/download';
import type { InstallJob, InstallPlan } from './installPlans';

export interface DownloadThreadGroup {
  threadId: string;
  rows: DownloadRow[];
}

export interface AssignProgressCounts {
  assigned: number;
  pending: number;
  skipped: number;
  failed: number;
  total: number;
  /** assigned + skipped (terminal success-ish for progress bars). */
  done: number;
}

/** Group download rows by threadId, preserving first-seen order. */
export function groupDownloadRowsByThread(rows: DownloadRow[]): DownloadThreadGroup[] {
  const order: string[] = [];
  const map = new Map<string, DownloadRow[]>();
  for (const row of rows) {
    if (!map.has(row.threadId)) {
      order.push(row.threadId);
      map.set(row.threadId, []);
    }
    map.get(row.threadId)!.push(row);
  }
  return order.map((threadId) => ({ threadId, rows: map.get(threadId)! }));
}

export function countAssignProgress(jobs: InstallJob[]): AssignProgressCounts {
  let assigned = 0;
  let pending = 0;
  let skipped = 0;
  let failed = 0;
  for (const j of jobs) {
    switch (j.assignStatus) {
      case 'assigned':
        assigned += 1;
        break;
      case 'pending':
        pending += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      default:
        break;
    }
  }
  const total = jobs.length;
  return {
    assigned,
    pending,
    skipped,
    failed,
    total,
    done: assigned + skipped,
  };
}

/**
 * Prefer an active plan's jobs; else the plan linked to any download in the
 * group; else the first plan's jobs.
 */
export function selectPlanJobs(
  jobs: InstallJob[],
  plansById: Map<string, InstallPlan>,
  linkedDownloadIds: Set<number>,
): InstallJob[] {
  if (jobs.length === 0) return [];

  const byPlan = new Map<string, InstallJob[]>();
  for (const j of jobs) {
    const list = byPlan.get(j.planId);
    if (list) list.push(j);
    else byPlan.set(j.planId, [j]);
  }

  for (const [planId, planJobs] of byPlan) {
    if (plansById.get(planId)?.status === 'active') return planJobs;
  }

  for (const j of jobs) {
    if (j.downloadId != null && linkedDownloadIds.has(j.downloadId)) {
      return byPlan.get(j.planId) ?? [];
    }
  }

  return byPlan.values().next().value ?? [];
}
