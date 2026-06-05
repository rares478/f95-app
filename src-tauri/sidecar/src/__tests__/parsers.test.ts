import { describe, expect, it } from 'vitest';
import { classifyHost } from '../domain/game/hosts';
import {
  inferRefererFromMasked,
  parseUnmaskResponse,
} from '../domain/f95/unmask';
import { isCloudflareInterstitial, assertNotCloudflareChallenge, isBotChallengePage } from '../shared/cloudflare';
import { RpcError } from '../rpc';
import { normalizeBuzzheavierUrl } from '../domain/resolvers/buzzheavier';
import { parseDatanodesUrl } from '../domain/resolvers/datanodes';
import { parseMixdropUrl } from '../domain/resolvers/mixdrop';
import { parseGofileUrl } from '../domain/resolvers/gofile';
import { parseWorkuploadUrl } from '../domain/resolvers/workupload';
import { cleanDownloadFileName } from '../shared/filename';

describe('cleanDownloadFileName', () => {
  it('strips trailing human size from WorkUpload-style names', () => {
    expect(cleanDownloadFileName('SkarpWorld_Collection.7z (520.47 MB)')).toBe(
      'SkarpWorld_Collection.7z',
    );
    expect(cleanDownloadFileName('game.zip (1.2 GB)')).toBe('game.zip');
    expect(cleanDownloadFileName('plain.7z')).toBe('plain.7z');
  });
});

describe('classifyHost', () => {
  it('classifies direct file hosts', () => {
    expect(classifyHost('https://pixeldrain.com/u/abc123')).toEqual({
      host: 'pixeldrain',
      category: 'direct',
    });
  });

  it('classifies F95 masked URLs by embedded host', () => {
    expect(
      classifyHost('https://f95zone.to/masked/pixeldrain/12345/67890/key'),
    ).toEqual({ host: 'pixeldrain', category: 'direct' });
  });

  it('classifies social hosts', () => {
    expect(classifyHost('https://www.patreon.com/creator')).toEqual({
      host: 'patreon',
      category: 'social',
    });
  });

  it('returns null for invalid URLs', () => {
    expect(classifyHost('not-a-url')).toBeNull();
  });
});

describe('unmask', () => {
  it('parses ok response', () => {
    expect(parseUnmaskResponse('{"status":"ok","msg":"https://example.com/file.zip"}')).toEqual({
      status: 'ok',
      msg: 'https://example.com/file.zip',
    });
  });

  it('returns null for non-JSON', () => {
    expect(parseUnmaskResponse('<html>login</html>')).toBeNull();
  });

  it('infers referer from masked URL', () => {
    expect(
      inferRefererFromMasked('https://f95zone.to/masked/mega/12345/67890/key'),
    ).toBe('https://f95zone.to/threads/12345/');
  });

  it('returns null when thread id missing', () => {
    expect(inferRefererFromMasked('https://pixeldrain.com/u/abc')).toBeNull();
  });
});

describe('cloudflare', () => {
  it('detects interstitial HTML', () => {
    const html =
      '<title>Just a moment...</title> challenges.cloudflare.com challenge';
    expect(isCloudflareInterstitial(html)).toBe(true);
  });

  it('throws on CF challenge header', () => {
    expect(() =>
      assertNotCloudflareChallenge('', { 'cf-mitigated': 'challenge' }),
    ).toThrow(RpcError);
  });

  it('detects WorkUpload bot check page', () => {
    const html =
      '<title>workupload - Are you a human?</title> Checking that you are not a robot';
    expect(isBotChallengePage(html)).toBe(true);
  });
});

describe('buzzheavier', () => {
  it('normalizes mirror URLs', () => {
    expect(normalizeBuzzheavierUrl('https://bzzhr.co/abc12345')).toBe(
      'https://buzzheavier.com/abc12345',
    );
  });
});

describe('datanodes', () => {
  it('parses file code from URL', () => {
    const parsed = parseDatanodesUrl('https://datanodes.to/abc1234567/MyFile.zip');
    expect(parsed.code).toBe('abc1234567');
    expect(parsed.fileName).toBe('MyFile.zip');
  });
});

describe('mixdrop', () => {
  it('parses /f/ and /e/ URLs', () => {
    const f = parseMixdropUrl('https://mixdrop.co/f/abc123');
    expect(f.fileref).toBe('abc123');
    expect(f.pageUrl).toBe('https://mixdrop.ag/f/abc123');
    const e = parseMixdropUrl('https://mixdrop.sx/e/xyz789');
    expect(e.fileref).toBe('xyz789');
    expect(e.pageUrl).toBe('https://mixdrop.ag/f/xyz789');
  });
});

describe('gofile', () => {
  it('parses content id from /d/ URL', () => {
    const parsed = parseGofileUrl('https://gofile.io/d/r9nRWl');
    expect(parsed.contentId).toBe('r9nRWl');
    expect(parsed.pageUrl).toBe('https://gofile.io/d/r9nRWl');
  });

  it('parses content id from /download/ URL', () => {
    const parsed = parseGofileUrl('https://www.gofile.io/download/abc123');
    expect(parsed.contentId).toBe('abc123');
  });
});

describe('workupload', () => {
  it('parses file id from URL', () => {
    const parsed = parseWorkuploadUrl('https://workupload.com/file/abc123/MyGame.zip');
    expect(parsed.fileId).toBe('abc123');
    expect(parsed.fileName).toBe('MyGame.zip');
    expect(parsed.pageUrl).toBe('https://workupload.com/file/abc123/MyGame.zip');
  });

  it('parses id-only URL', () => {
    const parsed = parseWorkuploadUrl('https://www.workupload.com/file/xyz789');
    expect(parsed.fileId).toBe('xyz789');
    expect(parsed.fileName).toBeNull();
  });
});
