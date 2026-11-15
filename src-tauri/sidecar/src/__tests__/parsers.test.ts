import { describe, expect, it } from 'vitest';
import { classifyHost } from '../domain/game/hosts';
import {
  decodeF95DlCode,
  inferRefererFromMasked,
  parseF95DlGoResponse,
  parseF95DlPage,
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
    expect(classifyHost('https://akirabox.com/abc/file')).toEqual({
      host: 'akirabox',
      category: 'direct',
    });
    expect(classifyHost('https://vikingfile.com/f/abc')).toEqual({
      host: 'vikingfile',
      category: 'direct',
    });
    expect(classifyHost('https://vik1ngfile.site/f/abc123')).toEqual({
      host: 'vikingfile',
      category: 'direct',
    });
    expect(classifyHost('https://bzzhr.to/os0b8uzvpd47')).toEqual({
      host: 'buzzheavier',
      category: 'direct',
    });
  });

  it('classifies F95 masked URLs by embedded host', () => {
    expect(
      classifyHost('https://f95zone.to/masked/pixeldrain/12345/67890/key'),
    ).toEqual({ host: 'pixeldrain', category: 'direct' });
  });

  it('classifies F95 /dl/ URLs from link text and favicon style', () => {
    const dl =
      'https://f95zone.to/dl/477444/?u=1&k=abc&r=1&t=xyz';
    expect(
      classifyHost(dl, {
        text: 'PIXELDRAIN',
        style:
          'background-image: url("https://external-content.duckduckgo.com/ip3/pixeldrain.com.ico");',
      }),
    ).toEqual({ host: 'pixeldrain', category: 'direct' });
    expect(classifyHost(dl, { text: 'BZZHR' })).toEqual({
      host: 'buzzheavier',
      category: 'direct',
    });
    expect(classifyHost(dl, { text: 'DATANODES' })).toEqual({
      host: 'datanodes',
      category: 'direct',
    });
    expect(classifyHost(dl)).toEqual({ host: 'f95-dl', category: 'direct' });
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

  it('decodes F95 /dl/ data-code values', () => {
    // encode: reverse("secret") → "terces", then base64, then prefix "c"
    const encoded = `c${Buffer.from('terces', 'utf8').toString('base64')}`;
    expect(decodeF95DlCode(encoded)).toBe('secret');
    expect(decodeF95DlCode('')).toBe('');
  });

  it('parses /dl/ interstitial form fields and go redirect HTML', () => {
    const encoded = `c${Buffer.from('terces', 'utf8').toString('base64')}`;
    const pageHtml = `
      <html data-csrf="csrf-token">
        <div class="f95dl-page" data-xf-init="f95dl-page" data-code="${encoded}">
          <form class="f95dl-box" action="/dl/11334991/" method="post">
            <input type="hidden" name="_xfToken" value="" />
            <input type="hidden" name="had_check" value="" />
            <input type="hidden" name="code" class="js-f95dlCode" value="" />
            <button type="submit" class="js-f95dlContinue">Continue</button>
          </form>
        </div>
      </html>`;
    const parsed = parseF95DlPage(
      pageHtml,
      'https://f95zone.to/dl/11334991/?u=1&k=a&r=1&t=b',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.actionUrl).toBe('https://f95zone.to/dl/11334991/');
    expect(parsed!.fields.code).toBe('secret');
    expect(parsed!.fields.had_check).toBe('1');
    expect(parsed!.fields._xfToken).toBe('csrf-token');
    expect(parsed!.hasCaptcha).toBe(false);

    const goHtml = `
      <div data-xf-init="f95dl-go"
           data-url="https://pixeldrain.com/u/abc123"></div>`;
    expect(parseF95DlGoResponse(goHtml)).toBe('https://pixeldrain.com/u/abc123');
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
    expect(normalizeBuzzheavierUrl('https://bzzhr.to/os0b8uzvpd47')).toBe(
      'https://buzzheavier.com/os0b8uzvpd47',
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

describe('vikingfile', () => {
  it('parses hash from vikingfile and mirror URLs', async () => {
    const { parseVikingfileUrl } = await import('../domain/resolvers/vikingfile');
    expect(parseVikingfileUrl('https://vikingfile.com/f/A0N4oHXRDy').hash).toBe('A0N4oHXRDy');
    expect(parseVikingfileUrl('https://vik1ngfile.site/f/A0N4oHXRDy').hash).toBe('A0N4oHXRDy');
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
