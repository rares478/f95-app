import { describe, expect, it } from 'vitest';
import {
  canChangeDownloadProvider,
  hostNeedsApiKeyHint,
  inFlightLibraryStatus,
  recoverStatusAfterDownloadFailure,
} from './downloadLibrarySync';
import type { DownloadRow } from '../types/download';

function row(
  partial: Partial<DownloadRow> & Pick<DownloadRow, 'threadId' | 'state'>,
): DownloadRow {
  return {
    id: partial.id ?? 1,
    threadId: partial.threadId,
    state: partial.state,
    host: partial.host ?? 'datanodes',
    sourceUrl: partial.sourceUrl ?? 'https://example.com/x',
    resolvedUrl: partial.resolvedUrl ?? null,
    destPath: partial.destPath ?? null,
    bytesDone: partial.bytesDone ?? 0,
    bytesTotal: partial.bytesTotal ?? null,
    gameVersion: partial.gameVersion ?? null,
    errorMessage: partial.errorMessage ?? null,
    startedAt: partial.startedAt ?? '2026-01-01T00:00:00Z',
    finishedAt: partial.finishedAt ?? null,
  };
}

describe('recoverStatusAfterDownloadFailure', () => {
  it('returns not_installed when no files', () => {
    expect(
      recoverStatusAfterDownloadFailure({
        installPath: null,
        exePath: null,
        availableVersion: null,
      }),
    ).toBe('not_installed');
  });

  it('returns installed when files exist', () => {
    expect(
      recoverStatusAfterDownloadFailure({
        installPath: 'D:/games/x',
        exePath: null,
        availableVersion: null,
      }),
    ).toBe('installed');
  });

  it('returns update_available when files exist and availableVersion set', () => {
    expect(
      recoverStatusAfterDownloadFailure({
        installPath: 'D:/games/x',
        exePath: 'D:/games/x/g.exe',
        availableVersion: '2.0',
      }),
    ).toBe('update_available');
  });
});

describe('inFlightLibraryStatus', () => {
  it('returns needs_attention when any row is needs_browser', () => {
    expect(
      inFlightLibraryStatus(
        [
          row({ threadId: '1', state: 'downloading' }),
          row({ id: 2, threadId: '1', state: 'needs_browser' }),
        ],
        '1',
      ),
    ).toBe('needs_attention');
  });

  it('prefers extracting over needs_attention', () => {
    expect(
      inFlightLibraryStatus(
        [
          row({ threadId: '1', state: 'needs_browser' }),
          row({ id: 2, threadId: '1', state: 'extracting' }),
        ],
        '1',
      ),
    ).toBe('extracting');
  });

  it('returns downloading for active transfer states', () => {
    expect(
      inFlightLibraryStatus([row({ threadId: '1', state: 'resolving' })], '1'),
    ).toBe('downloading');
  });

  it('returns null when no in-flight rows for thread', () => {
    expect(
      inFlightLibraryStatus([row({ threadId: '2', state: 'needs_browser' })], '1'),
    ).toBeNull();
  });
});

describe('hostNeedsApiKeyHint / canChangeDownloadProvider', () => {
  it('flags datanodes for API key hint', () => {
    expect(hostNeedsApiKeyHint('DataNodes')).toBe(true);
    expect(hostNeedsApiKeyHint('mixdrop')).toBe(false);
  });

  it('allows change provider for needs_browser and failed-before-start', () => {
    expect(canChangeDownloadProvider(row({ threadId: '1', state: 'needs_browser' }))).toBe(true);
    expect(
      canChangeDownloadProvider(row({ threadId: '1', state: 'failed', bytesDone: 0 })),
    ).toBe(true);
    expect(
      canChangeDownloadProvider(row({ threadId: '1', state: 'failed', bytesDone: 100 })),
    ).toBe(false);
    expect(canChangeDownloadProvider(row({ threadId: '1', state: 'downloading' }))).toBe(false);
  });
});
