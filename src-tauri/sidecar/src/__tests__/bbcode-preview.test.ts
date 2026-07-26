import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../rpc';
import {
  buildBbcodePreviewForm,
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
});

describe('buildBbcodePreviewForm', () => {
  it('posts bb_code to misc/bb-code', () => {
    const f = buildBbcodePreviewForm({ bbCode: '[B]x[/B]', xfToken: 'tok' });
    expect(f.url).toContain('/misc/bb-code');
    expect(f.body).toContain('bb_code=');
    expect(f.body).toContain('_xfToken=tok');
  });
});
