import { execute, query } from './db';
import type { SectionKind } from './installSections';

export type PlanStatus = 'active' | 'completed' | string;
export type AssignStatus = 'pending' | 'assigned' | 'skipped' | 'failed' | string;

export interface InstallPlan {
  id: string;
  threadId: string;
  intent: string;
  status: PlanStatus;
  createdAt: string;
}

export interface InstallJob {
  id: string;
  planId: string;
  sectionLabel: string;
  sectionKind: SectionKind;
  sourceUrl: string;
  host: string;
  downloadId: number | null;
  extractPath: string | null;
  exeId: string | null;
  assignStatus: AssignStatus;
  sortOrder: number;
  errorMessage: string | null;
  /** Shared id for multi-archive split parts; null for single-file jobs. */
  bundleId: string | null;
}

interface PlanDbRow {
  id: string;
  thread_id: string;
  intent: string;
  status: string;
  created_at: string;
}

interface JobDbRow {
  id: string;
  plan_id: string;
  section_label: string;
  section_kind: string;
  source_url: string;
  host: string;
  download_id: number | null;
  extract_path: string | null;
  exe_id: string | null;
  assign_status: string;
  sort_order: number;
  error_message: string | null;
  bundle_id: string | null;
}

const TERMINAL_ASSIGN = new Set(['assigned', 'skipped', 'failed']);

function rowToPlan(r: PlanDbRow): InstallPlan {
  return {
    id: r.id,
    threadId: r.thread_id,
    intent: r.intent,
    status: r.status,
    createdAt: r.created_at,
  };
}

function rowToJob(r: JobDbRow): InstallJob {
  return {
    id: r.id,
    planId: r.plan_id,
    sectionLabel: r.section_label,
    sectionKind: r.section_kind as SectionKind,
    sourceUrl: r.source_url,
    host: r.host,
    downloadId: r.download_id,
    extractPath: r.extract_path,
    exeId: r.exe_id,
    assignStatus: r.assign_status,
    sortOrder: r.sort_order,
    errorMessage: r.error_message,
    bundleId: r.bundle_id ?? null,
  };
}

export interface CreatePlanJobInput {
  sectionLabel: string;
  sectionKind: SectionKind;
  sourceUrl: string;
  host: string;
  sortOrder: number;
  bundleId?: string | null;
}

export interface CreatePlanArgs {
  threadId: string;
  intent: string;
  jobs: CreatePlanJobInput[];
}

export async function createPlan(
  args: CreatePlanArgs,
): Promise<{ plan: InstallPlan; jobs: InstallJob[] }> {
  const planId = crypto.randomUUID();
  await execute(
    `INSERT INTO install_plans (id, thread_id, intent, status, created_at)
     VALUES (?, ?, ?, 'active', datetime('now'))`,
    [planId, args.threadId, args.intent],
  );

  const jobs: InstallJob[] = [];
  for (const j of args.jobs) {
    const id = crypto.randomUUID();
    const bundleId = j.bundleId ?? null;
    await execute(
      `INSERT INTO install_jobs (
         id, plan_id, section_label, section_kind, source_url, host,
         download_id, extract_path, exe_id, assign_status, sort_order, error_message,
         bundle_id
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', ?, NULL, ?)`,
      [
        id,
        planId,
        j.sectionLabel,
        j.sectionKind,
        j.sourceUrl,
        j.host,
        j.sortOrder,
        bundleId,
      ],
    );
    jobs.push({
      id,
      planId,
      sectionLabel: j.sectionLabel,
      sectionKind: j.sectionKind,
      sourceUrl: j.sourceUrl,
      host: j.host,
      downloadId: null,
      extractPath: null,
      exeId: null,
      assignStatus: 'pending',
      sortOrder: j.sortOrder,
      errorMessage: null,
      bundleId,
    });
  }

  const planRows = await query<PlanDbRow>(
    `SELECT * FROM install_plans WHERE id = ?`,
    [planId],
  );
  const planRow = planRows[0];
  if (!planRow) {
    throw new Error('Failed to create install plan');
  }

  return { plan: rowToPlan(planRow), jobs };
}

export async function listActivePlans(): Promise<InstallPlan[]> {
  const rows = await query<PlanDbRow>(
    `SELECT * FROM install_plans WHERE status = 'active' ORDER BY created_at DESC`,
  );
  return rows.map(rowToPlan);
}

export async function listJobsForPlan(planId: string): Promise<InstallJob[]> {
  const rows = await query<JobDbRow>(
    `SELECT * FROM install_jobs
      WHERE plan_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [planId],
  );
  return rows.map(rowToJob);
}

export async function listJobsForBundle(bundleId: string): Promise<InstallJob[]> {
  const rows = await query<JobDbRow>(
    `SELECT * FROM install_jobs
      WHERE bundle_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [bundleId],
  );
  return rows.map(rowToJob);
}

/** True when every sibling has extracted and none failed assign. */
export function bundleExtractReady(jobs: InstallJob[]): boolean {
  if (jobs.length === 0) return false;
  return jobs.every(
    (j) => j.extractPath != null && j.assignStatus !== 'failed',
  );
}

export async function listJobsByThread(threadId: string): Promise<InstallJob[]> {
  const rows = await query<JobDbRow>(
    `SELECT j.*
       FROM install_jobs j
       JOIN install_plans p ON p.id = j.plan_id
      WHERE p.thread_id = ?
      ORDER BY j.sort_order ASC, j.id ASC`,
    [threadId],
  );
  return rows.map(rowToJob);
}

export async function findJobByDownloadId(
  downloadId: number,
): Promise<InstallJob | null> {
  const rows = await query<JobDbRow>(
    `SELECT * FROM install_jobs WHERE download_id = ? LIMIT 1`,
    [downloadId],
  );
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function findJob(jobId: string): Promise<InstallJob | null> {
  const rows = await query<JobDbRow>(
    `SELECT * FROM install_jobs WHERE id = ? LIMIT 1`,
    [jobId],
  );
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function getPlan(planId: string): Promise<InstallPlan | null> {
  const rows = await query<PlanDbRow>(
    `SELECT * FROM install_plans WHERE id = ? LIMIT 1`,
    [planId],
  );
  return rows[0] ? rowToPlan(rows[0]) : null;
}

export async function attachDownload(
  jobId: string,
  downloadId: number,
): Promise<void> {
  await execute(`UPDATE install_jobs SET download_id = ? WHERE id = ?`, [
    downloadId,
    jobId,
  ]);
}

export async function markJobExtracted(
  jobId: string,
  extractPath: string,
): Promise<void> {
  await execute(`UPDATE install_jobs SET extract_path = ? WHERE id = ?`, [
    extractPath,
    jobId,
  ]);
}

export async function markJobAssign(
  jobId: string,
  status: AssignStatus,
  opts?: { exeId?: string; errorMessage?: string | null },
): Promise<void> {
  // Pass `errorMessage: null` to clear a prior failure; omit the key to leave
  // error_message unchanged (COALESCE alone cannot clear).
  if (opts != null && 'errorMessage' in opts) {
    await execute(
      `UPDATE install_jobs
          SET assign_status = ?,
              exe_id = COALESCE(?, exe_id),
              error_message = ?
        WHERE id = ?`,
      [status, opts.exeId ?? null, opts.errorMessage ?? null, jobId],
    );
    return;
  }
  await execute(
    `UPDATE install_jobs
        SET assign_status = ?,
            exe_id = COALESCE(?, exe_id)
      WHERE id = ?`,
    [status, opts?.exeId ?? null, jobId],
  );
}

export async function markPlanStatus(
  planId: string,
  status: PlanStatus,
): Promise<void> {
  await execute(`UPDATE install_plans SET status = ? WHERE id = ?`, [
    status,
    planId,
  ]);
}

export async function recomputePlanStatus(planId: string): Promise<void> {
  const rows = await query<{ assign_status: string }>(
    `SELECT assign_status FROM install_jobs WHERE plan_id = ?`,
    [planId],
  );
  const allTerminal =
    rows.length > 0 && rows.every((r) => TERMINAL_ASSIGN.has(r.assign_status));
  await markPlanStatus(planId, allTerminal ? 'completed' : 'active');
}
