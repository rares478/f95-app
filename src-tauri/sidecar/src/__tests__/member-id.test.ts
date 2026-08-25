import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  extractMemberUserIdFromHref,
  parseMessageAuthorUserId,
} from '../shared/memberId';

describe('extractMemberUserIdFromHref', () => {
  it('parses slug.id and numeric member paths', () => {
    expect(extractMemberUserIdFromHref('/members/alice.55/')).toBe('55');
    expect(extractMemberUserIdFromHref('https://f95zone.to/members/11449/')).toBe('11449');
    expect(extractMemberUserIdFromHref('/threads/1/')).toBeNull();
  });
});

describe('parseMessageAuthorUserId', () => {
  it('prefers message-name / avatar member link or data-user-id', () => {
    const html = `<article class="message">
      <div class="message-userDetails">
        <h4 class="message-name"><a href="/members/bob.77/" data-user-id="77">Bob</a></h4>
      </div>
      <div class="message-avatar"><a href="/members/bob.77/" class="avatar"><img src="/a.jpg"></a></div>
    </article>`;
    const $ = load(html);
    expect(parseMessageAuthorUserId($, $('article.message').first())).toBe('77');
  });

  it('returns null when no member link or data-user-id', () => {
    const html = `<article class="message"><h4 class="message-name"><a>Anon</a></h4></article>`;
    const $ = load(html);
    expect(parseMessageAuthorUserId($, $('article.message').first())).toBeNull();
  });
});
