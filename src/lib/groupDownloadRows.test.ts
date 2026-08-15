import { describe, expect, it } from 'vitest';
import type { DownloadRow } from '../types/download';
import type { InstallJob, InstallPlan } from './installPlans';
import {
  countAssignProgress,
  groupDownloadRowsByThread,
  selectPlanJobs,
} from './groupDownloadRows';

function row(partial: Partial<DownloadRow> & Pick<DownloadRow, 'id' | 'threadId'>): DownloadRow {
  return {
    host: 'pixeldrain',
    sourceUrl: 'https://example.com',
    resolvedUrl: null,
    destPath: null,
    libraryPath: null,
    state: 'completed',
    bytesTotal: null,
    bytesDone: 0,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    gameVersion: null,
    ...partial,
  };
}

function job(
  partial: Partial<InstallJob> & Pick<InstallJob, 'id' | 'planId' | 'assignStatus'>,
): InstallJob {
  return {
    sectionLabel: 'Windows',
    sectionKind: 'current_os',
    sourceUrl: 'https://example.com',
    host: 'pixeldrain',
    downloadId: null,
    extractPath: null,
    exeId: null,
    sortOrder: 0,
    errorMessage: null,
    bundleId: null,
    ...partial,
  };
}

describe('groupDownloadRowsByThread', () => {
  it('groups by threadId preserving first-seen order', () => {
    const groups = groupDownloadRowsByThread([
      row({ id: 1, threadId: 'a' }),
      row({ id: 2, threadId: 'b' }),
      row({ id: 3, threadId: 'a' }),
    ]);
    expect(groups.map((g) => g.threadId)).toEqual(['a', 'b']);
    expect(groups[0].rows.map((r) => r.id)).toEqual([1, 3]);
    expect(groups[1].rows.map((r) => r.id)).toEqual([2]);
  });
});

describe('countAssignProgress', () => {
  it('counts assign statuses', () => {
    expect(
      countAssignProgress([
        job({ id: '1', planId: 'p', assignStatus: 'assigned' }),
        job({ id: '2', planId: 'p', assignStatus: 'pending' }),
        job({ id: '3', planId: 'p', assignStatus: 'skipped' }),
        job({ id: '4', planId: 'p', assignStatus: 'failed' }),
      ]),
    ).toEqual({
      assigned: 1,
      pending: 1,
      skipped: 1,
      failed: 1,
      total: 4,
      done: 2,
    });
  });
});

describe('selectPlanJobs', () => {
  const plans = new Map<string, InstallPlan>([
    [
      'active',
      {
        id: 'active',
        threadId: 't',
        intent: 'install',
        status: 'active',
        createdAt: '2026-01-01',
      },
    ],
    [
      'old',
      {
        id: 'old',
        threadId: 't',
        intent: 'install',
        status: 'completed',
        createdAt: '2025-01-01',
      },
    ],
  ]);

  it('prefers active plan', () => {
    const selected = selectPlanJobs(
      [
        job({ id: '1', planId: 'old', assignStatus: 'assigned', downloadId: 10 }),
        job({ id: '2', planId: 'active', assignStatus: 'pending', downloadId: 11 }),
      ],
      plans,
      new Set([10]),
    );
    expect(selected.map((j) => j.id)).toEqual(['2']);
  });

  it('falls back to plan linked to downloads', () => {
    const selected = selectPlanJobs(
      [
        job({ id: '1', planId: 'old', assignStatus: 'assigned', downloadId: 10 }),
        job({ id: '2', planId: 'old', assignStatus: 'pending', downloadId: 11 }),
      ],
      plans,
      new Set([11]),
    );
    expect(selected.map((j) => j.id)).toEqual(['1', '2']);
  });
});
