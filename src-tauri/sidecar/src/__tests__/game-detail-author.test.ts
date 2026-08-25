import { describe, expect, it } from 'vitest';
import { parseThreadHtmlForTests } from '../domain/game/client';

describe('GameDetail.authorUserId (thread OP)', () => {
  it('sets authorUserId from OP member link', () => {
    const html = `
<html><body>
  <h1 class="p-title-value">Sample Game</h1>
  <article class="message" data-author="OpAuthor">
    <div class="message-userDetails">
      <h4 class="message-name"><a href="/members/op.55/" data-user-id="55">OpAuthor</a></h4>
    </div>
    <div class="message-body">
      <div class="bbWrapper"><p>OP body</p></div>
    </div>
  </article>
</body></html>`;
    const detail = parseThreadHtmlForTests(
      html,
      'https://f95zone.to/threads/sample.123/',
    );
    expect(detail.authorUserId).toBe('55');
  });
});
