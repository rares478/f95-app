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
    ]);
    expect(jobInserts[1]![1]).toEqual([
      '11111111-1111-1111-1111-000000000003',
      '11111111-1111-1111-1111-000000000001',
      'Extras',
      'extra',
      'https://example.com/b',
      'mega',
      1,
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
    });
    expect(result.jobs[1]).toMatchObject({
      assignStatus: 'pending',
      sectionKind: 'extra',
      sortOrder: 1,
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
    });

    const findCall = query.mock.calls.find((c) =>
      String(c[0]).includes('FROM install_jobs'),
    );
    expect(findCall![1]).toEqual([42]);

    query.mockResolvedValueOnce([]);
    expect(await installPlans.findJobByDownloadId(99)).toBeNull();
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
});
