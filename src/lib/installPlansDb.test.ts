import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, query } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock('./db', () => ({
  execute: (...args: unknown[]) => execute(...args),
  query: (...args: unknown[]) => query(...args),
}));

import * as installPlans from './installPlans';

describe('installPlans DB façade', () => {
  beforeEach(() => {
    execute.mockReset();
    query.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    let n = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () =>
        `11111111-1111-1111-1111-${String(++n).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  it('createPlan inserts plan and jobs with active/pending defaults', async () => {
    query.mockResolvedValueOnce([
      {
        id: '11111111-1111-1111-1111-000000000001',
        thread_id: 't1',
        intent: 'install',
        status: 'active',
        created_at: '2026-07-26T00:00:00.000Z',
      },
    ]);

    const result = await installPlans.createPlan({
      threadId: 't1',
      intent: 'install',
      jobs: [
        {
          sectionLabel: 'Windows',
          sectionKind: 'current_os',
          sourceUrl: 'https://example.com/a',
          host: 'pixeldrain',
          sortOrder: 0,
        },
        {
          sectionLabel: 'Extras',
          sectionKind: 'extra',
          sourceUrl: 'https://example.com/b',
          host: 'mega',
          sortOrder: 1,
        },
      ],
    });

    const planInsert = execute.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO install_plans'),
    );
    expect(planInsert).toBeTruthy();
    expect(planInsert![1]).toEqual([
      '11111111-1111-1111-1111-000000000001',
      't1',
      'install',
    ]);

    const jobInserts = execute.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO install_jobs'),
    );
    expect(jobInserts).toHaveLength(2);
    expect(jobInserts[0]![1]).toEqual([
      '11111111-1111-1111-1111-000000000002',
      '11111111-1111-1111-1111-000000000001',
      'Windows',
      'current_os',
      'https://example.com/a',
      'pixeldrain',
      0,
      null,
    ]);
    expect(jobInserts[1]![1]).toEqual([
      '11111111-1111-1111-1111-000000000003',
      '11111111-1111-1111-1111-000000000001',
      'Extras',
      'extra',
      'https://example.com/b',
      'mega',
      1,
      null,
    ]);

    expect(result.plan).toEqual({
      id: '11111111-1111-1111-1111-000000000001',
      threadId: 't1',
      intent: 'install',
      status: 'active',
      createdAt: '2026-07-26T00:00:00.000Z',
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      assignStatus: 'pending',
      downloadId: null,
      sectionKind: 'current_os',
      bundleId: null,
    });
    expect(result.jobs[1]).toMatchObject({
      assignStatus: 'pending',
      sectionKind: 'extra',
      sortOrder: 1,
      bundleId: null,
    });
  });

  it('findJobByDownloadId returns mapped job or null', async () => {
    query.mockResolvedValueOnce([
      {
        id: 'j1',
        plan_id: 'p1',
        section_label: 'Windows',
        section_kind: 'current_os',
        source_url: 'https://example.com/a',
        host: 'pixeldrain',
        download_id: 42,
        extract_path: null,
        exe_id: null,
        assign_status: 'pending',
        sort_order: 0,
        error_message: null,
      },
    ]);

    const found = await installPlans.findJobByDownloadId(42);
    expect(found).toEqual({
      id: 'j1',
      planId: 'p1',
      sectionLabel: 'Windows',
      sectionKind: 'current_os',
      sourceUrl: 'https://example.com/a',
      host: 'pixeldrain',
      downloadId: 42,
      extractPath: null,
      exeId: null,
      assignStatus: 'pending',
      sortOrder: 0,
      errorMessage: null,
      bundleId: null,
    });

    const findCall = query.mock.calls.find((c) =>
      String(c[0]).includes('FROM install_jobs'),
    );
    expect(findCall![1]).toEqual([42]);

    query.mockResolvedValueOnce([]);
    expect(await installPlans.findJobByDownloadId(99)).toBeNull();
  });

  it('findJob and getPlan return mapped rows or null', async () => {
    query.mockResolvedValueOnce([
      {
        id: 'j1',
        plan_id: 'p1',
        section_label: 'Windows',
        section_kind: 'current_os',
        source_url: 'https://example.com/a',
        host: 'pixeldrain',
        download_id: 42,
        extract_path: 'D:/games/Win',
        exe_id: null,
        assign_status: 'pending',
        sort_order: 0,
        error_message: null,
      },
    ]);
    const job = await installPlans.findJob('j1');
    expect(job?.id).toBe('j1');
    expect(job?.extractPath).toBe('D:/games/Win');

    query.mockResolvedValueOnce([]);
    expect(await installPlans.findJob('missing')).toBeNull();

    query.mockResolvedValueOnce([
      {
        id: 'p1',
        thread_id: 't1',
        intent: 'install',
        status: 'active',
        created_at: '2026-07-26T00:00:00.000Z',
      },
    ]);
    const plan = await installPlans.getPlan('p1');
    expect(plan).toEqual({
      id: 'p1',
      threadId: 't1',
      intent: 'install',
      status: 'active',
      createdAt: '2026-07-26T00:00:00.000Z',
    });

    query.mockResolvedValueOnce([]);
    expect(await installPlans.getPlan('missing')).toBeNull();
  });

  it('markJobAssign clears error_message when null is passed', async () => {
    await installPlans.markJobAssign('j1', 'pending', { errorMessage: null });

    const update = execute.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE install_jobs'),
    );
    expect(update).toBeTruthy();
    expect(String(update![0])).toContain('error_message = ?');
    expect(String(update![0])).not.toContain('COALESCE(?, error_message)');
    expect(update![1]).toEqual(['pending', null, null, 'j1']);
  });

  it('markJobAssign leaves error_message unchanged when omitted', async () => {
    await installPlans.markJobAssign('j1', 'assigned', { exeId: 'e1' });

    const update = execute.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE install_jobs'),
    );
    expect(update).toBeTruthy();
    expect(String(update![0])).not.toContain('error_message');
    expect(update![1]).toEqual(['assigned', 'e1', 'j1']);
  });

  it('recomputePlanStatus marks completed when all jobs are terminal', async () => {
    query.mockResolvedValueOnce([
      { assign_status: 'assigned' },
      { assign_status: 'skipped' },
      { assign_status: 'failed' },
    ]);

    await installPlans.recomputePlanStatus('p1');

    const statusUpdate = execute.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE install_plans') &&
        String(c[0]).includes('status'),
    );
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate![1]).toEqual(['completed', 'p1']);
  });

  it('recomputePlanStatus keeps active when any job is non-terminal', async () => {
    query.mockResolvedValueOnce([
      { assign_status: 'assigned' },
      { assign_status: 'pending' },
    ]);

    await installPlans.recomputePlanStatus('p1');

    const statusUpdate = execute.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE install_plans') &&
        String(c[0]).includes('status'),
    );
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate![1]).toEqual(['active', 'p1']);
  });

  it('createPlan persists bundle_id on split jobs and null for singles', async () => {
    query.mockResolvedValueOnce([
      {
        id: '11111111-1111-1111-1111-000000000001',
        thread_id: 't1',
        intent: 'install',
        status: 'active',
        created_at: '2026-07-26T00:00:00.000Z',
      },
    ]);

    const bundleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const result = await installPlans.createPlan({
      threadId: 't1',
      intent: 'install',
      jobs: [
        {
          sectionLabel: 'Season 1 · Win/Linux · Splits',
          sectionKind: 'current_os',
          sourceUrl: 'https://example.com/p1',
          host: 'mega',
          sortOrder: 1,
          bundleId,
        },
        {
          sectionLabel: 'Season 1 · Win/Linux · Splits',
          sectionKind: 'current_os',
          sourceUrl: 'https://example.com/p2',
          host: 'mega',
          sortOrder: 2,
          bundleId,
        },
        {
          sectionLabel: 'Season 1 · Win/Linux · Full',
          sectionKind: 'current_os',
          sourceUrl: 'https://example.com/full',
          host: 'pixeldrain',
          sortOrder: 0,
          bundleId: null,
        },
      ],
    });

    const jobInserts = execute.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO install_jobs'),
    );
    expect(jobInserts).toHaveLength(3);
    for (const call of jobInserts) {
      expect(String(call[0])).toContain('bundle_id');
    }
    expect(jobInserts[0]![1]).toEqual([
      '11111111-1111-1111-1111-000000000002',
      '11111111-1111-1111-1111-000000000001',
      'Season 1 · Win/Linux · Splits',
      'current_os',
      'https://example.com/p1',
      'mega',
      1,
      bundleId,
    ]);
    expect(jobInserts[1]![1]).toEqual([
      '11111111-1111-1111-1111-000000000003',
      '11111111-1111-1111-1111-000000000001',
      'Season 1 · Win/Linux · Splits',
      'current_os',
      'https://example.com/p2',
      'mega',
      2,
      bundleId,
    ]);
    expect(jobInserts[2]![1]).toEqual([
      '11111111-1111-1111-1111-000000000004',
      '11111111-1111-1111-1111-000000000001',
      'Season 1 · Win/Linux · Full',
      'current_os',
      'https://example.com/full',
      'pixeldrain',
      0,
      null,
    ]);

    expect(result.jobs.map((j) => j.bundleId)).toEqual([
      bundleId,
      bundleId,
      null,
    ]);
  });

  it('listJobsForBundle returns mapped sibling jobs ordered by sort_order', async () => {
    const bundleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    query.mockResolvedValueOnce([
      {
        id: 'j2',
        plan_id: 'p1',
        section_label: 'Splits',
        section_kind: 'current_os',
        source_url: 'https://example.com/p2',
        host: 'mega',
        download_id: null,
        extract_path: null,
        exe_id: null,
        assign_status: 'pending',
        sort_order: 2,
        error_message: null,
        bundle_id: bundleId,
      },
      {
        id: 'j1',
        plan_id: 'p1',
        section_label: 'Splits',
        section_kind: 'current_os',
        source_url: 'https://example.com/p1',
        host: 'mega',
        download_id: 10,
        extract_path: 'D:/games/Splits',
        exe_id: null,
        assign_status: 'pending',
        sort_order: 1,
        error_message: null,
        bundle_id: bundleId,
      },
    ]);

    const jobs = await installPlans.listJobsForBundle(bundleId);

    const listCall = query.mock.calls.find((c) =>
      String(c[0]).includes('bundle_id'),
    );
    expect(listCall).toBeTruthy();
    expect(listCall![1]).toEqual([bundleId]);
    expect(String(listCall![0])).toMatch(/ORDER BY sort_order ASC/i);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: 'j2',
      bundleId,
      sortOrder: 2,
    });
    expect(jobs[1]).toMatchObject({
      id: 'j1',
      bundleId,
      extractPath: 'D:/games/Splits',
      downloadId: 10,
    });
  });

  it('markJobAndBundleSiblingsAssign marks every sibling with the same status/exeId', async () => {
    const bundleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const jobA = {
      id: 'j1',
      planId: 'p1',
      sectionLabel: 'Splits',
      sectionKind: 'current_os' as const,
      sourceUrl: 'https://example.com/p1',
      host: 'mega',
      downloadId: 10,
      extractPath: 'D:/games/Splits',
      exeId: null,
      assignStatus: 'pending' as const,
      sortOrder: 1,
      errorMessage: null,
      bundleId,
    };
    query.mockResolvedValueOnce([
      {
        id: 'j1',
        plan_id: 'p1',
        section_label: 'Splits',
        section_kind: 'current_os',
        source_url: 'https://example.com/p1',
        host: 'mega',
        download_id: 10,
        extract_path: 'D:/games/Splits',
        exe_id: null,
        assign_status: 'pending',
        sort_order: 1,
        error_message: null,
        bundle_id: bundleId,
      },
      {
        id: 'j2',
        plan_id: 'p1',
        section_label: 'Splits',
        section_kind: 'current_os',
        source_url: 'https://example.com/p2',
        host: 'mega',
        download_id: 11,
        extract_path: 'D:/games/Splits',
        exe_id: null,
        assign_status: 'pending',
        sort_order: 2,
        error_message: null,
        bundle_id: bundleId,
      },
    ]);

    await installPlans.markJobAndBundleSiblingsAssign(jobA, 'assigned', {
      exeId: 'exe-1',
    });

    const assignUpdates = execute.mock.calls.filter((c) =>
      String(c[0]).includes('assign_status'),
    );
    expect(assignUpdates).toHaveLength(2);
    expect(assignUpdates.map((c) => c[1])).toEqual([
      ['assigned', 'exe-1', 'j1'],
      ['assigned', 'exe-1', 'j2'],
    ]);
  });

  it('markJobAndBundleSiblingsAssign marks only the job when bundleId is null', async () => {
    const job = {
      id: 'j1',
      planId: 'p1',
      sectionLabel: 'Windows',
      sectionKind: 'current_os' as const,
      sourceUrl: 'https://example.com/a',
      host: 'mega',
      downloadId: 10,
      extractPath: 'D:/games/Win',
      exeId: null,
      assignStatus: 'pending' as const,
      sortOrder: 0,
      errorMessage: null,
      bundleId: null,
    };

    await installPlans.markJobAndBundleSiblingsAssign(job, 'skipped');

    expect(query).not.toHaveBeenCalled();
    const assignUpdates = execute.mock.calls.filter((c) =>
      String(c[0]).includes('assign_status'),
    );
    expect(assignUpdates).toHaveLength(1);
    expect(assignUpdates[0]![1]).toEqual(['skipped', null, 'j1']);
  });

  it('bundleExtractReady requires all extractPath set and none failed', () => {
    const base = {
      planId: 'p1',
      sectionLabel: 'Splits',
      sectionKind: 'current_os' as const,
      sourceUrl: 'https://example.com',
      host: 'mega',
      downloadId: null,
      exeId: null,
      sortOrder: 0,
      errorMessage: null,
      bundleId: 'b1',
    };

    expect(
      installPlans.bundleExtractReady([
        { ...base, id: 'j1', extractPath: 'D:/a', assignStatus: 'pending' },
        { ...base, id: 'j2', extractPath: 'D:/a', assignStatus: 'pending' },
      ]),
    ).toBe(true);

    expect(
      installPlans.bundleExtractReady([
        { ...base, id: 'j1', extractPath: 'D:/a', assignStatus: 'pending' },
        { ...base, id: 'j2', extractPath: null, assignStatus: 'pending' },
      ]),
    ).toBe(false);

    expect(
      installPlans.bundleExtractReady([
        { ...base, id: 'j1', extractPath: 'D:/a', assignStatus: 'pending' },
        { ...base, id: 'j2', extractPath: 'D:/a', assignStatus: 'failed' },
      ]),
    ).toBe(false);

    expect(installPlans.bundleExtractReady([])).toBe(false);
  });
});
