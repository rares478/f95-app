import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../rpc';
import {
  buildBbcodePreviewForm,
  extractPreviewBodyHtml,
  parseBbcodePreviewResponse,
} from '../domain/game/bbcodePreview';

const fix = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

describe('parseBbcodePreviewResponse', () => {
  it('extracts html content', () => {
    expect(parseBbcodePreviewResponse(fix('bbcode-preview-ok.json'))).toBe('<b>hi</b>');
  });

  it('throws on error JSON', () => {
    expect(() =>
      parseBbcodePreviewResponse(
        JSON.stringify({ status: 'error', errors: ['Nope'] }),
      ),
    ).toThrow(RpcError);
  });

  it('strips XF preview chrome to bbWrapper', () => {
    const body = JSON.stringify({
      status: 'ok',
      html: {
        content:
          '<div class="bbCodePreview"><div class="bbWrapper"><b>hi</b></div></div>',
      },
    });
    expect(parseBbcodePreviewResponse(body)).toBe('<b>hi</b>');
  });
});

describe('extractPreviewBodyHtml', () => {
  it('returns raw html when no wrapper', () => {
    expect(extractPreviewBodyHtml('<i>x</i>')).toBe('<i>x</i>');
  });
});

describe('buildBbcodePreviewForm', () => {
  it('posts message to threads/{id}/reply-preview', () => {
    const f = buildBbcodePreviewForm({
      threadId: '100',
      bbCode: '[B]x[/B]',
      xfToken: 'tok',
    });
    expect(f.url).toContain('/threads/100/reply-preview');
    expect(f.url).toContain('quick_reply=1');
    expect(f.body).toContain('message=');
    expect(f.body).toContain('_xfToken=tok');
    expect(f.body).not.toContain('bb_code=');
  });
});
