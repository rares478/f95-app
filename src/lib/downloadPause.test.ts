import { describe, expect, it } from 'vitest';
import { canPauseDownload } from './downloadPause';
import type { DownloadRow } from '../types/download';

function row(partial: Partial<DownloadRow> & Pick<DownloadRow, 'state' | 'host'>): DownloadRow {
  return {
    id: 1,
    threadId: '99',
    host: partial.host,
    state: partial.state,
    sourceUrl: 'https://example.com/x',
    resolvedUrl: null,
    destPath: null,
    libraryPath: null,
    bytesDone: 0,
    bytesTotal: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    gameVersion: null,
  };
}

describe('canPauseDownload', () => {
  it('allows downloading non-mega', () => {
    expect(canPauseDownload(row({ state: 'downloading', host: 'gofile' }))).toBe(true);
  });

  it('allows resolving non-mega', () => {
    expect(canPauseDownload(row({ state: 'resolving', host: 'datanodes' }))).toBe(true);
  });

  it('blocks mega', () => {
    expect(canPauseDownload(row({ state: 'downloading', host: 'mega' }))).toBe(false);
  });

  it('blocks extracting', () => {
    expect(canPauseDownload(row({ state: 'extracting', host: 'gofile' }))).toBe(false);
  });

  it('blocks paused', () => {
    expect(
      canPauseDownload(row({ state: 'paused', host: 'gofile' })),
    ).toBe(false);
  });
});
