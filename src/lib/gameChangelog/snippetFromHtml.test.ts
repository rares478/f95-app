import { describe, expect, it } from 'vitest';
import { snippetFromHtml } from './snippetFromHtml';

describe('snippetFromHtml', () => {
  it('returns empty string for empty / tag-only html', () => {
    expect(snippetFromHtml('')).toBe('');
    expect(snippetFromHtml('<br><div></div>')).toBe('');
  });

  it('strips tags and collapses whitespace', () => {
    expect(snippetFromHtml('<b>Bug</b>  fix<br>- item')).toBe('Bug fix - item');
  });

  it('truncates at word boundary with ellipsis', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const out = snippetFromHtml(`<p>${words}</p>`, 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.includes('<')).toBe(false);
  });

  it('does not ellipsize when under maxLen', () => {
    expect(snippetFromHtml('Short note')).toBe('Short note');
  });

  it('drops spoiler summary and escaped feature tags', () => {
    const html =
      '<details class="x-spoiler"><summary>Spoiler</summary>' +
      '<div>&lt;Features&gt;<br>- New scene</div></details>';
    expect(snippetFromHtml(html)).toBe('- New scene');
    expect(snippetFromHtml('Features&gt;<br>- New booty call')).toBe(
      '- New booty call',
    );
  });
});
