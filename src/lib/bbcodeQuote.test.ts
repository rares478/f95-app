import { describe, expect, it } from 'vitest';
import {
  appendQuoteToDraft,
  buildQuoteBbcode,
  htmlToPlainText,
} from './bbcodeQuote';

describe('htmlToPlainText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToPlainText('<p>Hi <b>there</b></p><br>you')).toBe('Hi there\n\nyou');
  });
});

describe('buildQuoteBbcode', () => {
  it('builds XF-style quote and escapes quotes in author', () => {
    expect(
      buildQuoteBbcode({ author: 'Ann "X"', postId: '99', text: 'hello' }),
    ).toBe('[QUOTE="Ann \\"X\\", post: 99"]\nhello\n[/QUOTE]');
  });

  it('returns null for empty text', () => {
    expect(buildQuoteBbcode({ author: 'A', postId: '1', text: '  \n' })).toBeNull();
  });
});

describe('appendQuoteToDraft', () => {
  it('separates with blank line when draft non-empty', () => {
    expect(appendQuoteToDraft('hi', '[QUOTE="A, post: 1"]\nx\n[/QUOTE]')).toBe(
      'hi\n\n[QUOTE="A, post: 1"]\nx\n[/QUOTE]',
    );
  });
});
