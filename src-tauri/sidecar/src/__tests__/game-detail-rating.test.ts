import { describe, expect, it } from 'vitest';
import { parseThreadHtmlForTests } from '../domain/game/client';

describe('GameDetail.rating (thread page)', () => {
  it('reads BR rating from select[data-initial-rating]', () => {
    const html = `
<html><body>
  <h1 class="p-title-value">Sample Game</h1>
  <select name="rating" data-initial-rating="4.7"></select>
  <article class="message" data-author="OpAuthor">
    <div class="message-body">
      <div class="bbWrapper"><p>OP body</p></div>
    </div>
  </article>
</body></html>`;
    const detail = parseThreadHtmlForTests(
      html,
      'https://f95zone.to/threads/sample.123/',
    );
    expect(detail.rating).toBe(4.7);
  });

  it('falls back to ratingStars title when select is absent', () => {
    const html = `
<html><body>
  <div class="p-title">
    <h1 class="p-title-value">Sample Game</h1>
    <span class="ratingStars bratr-rating" title="3.70 star(s)"></span>
  </div>
  <article class="message" data-author="OpAuthor">
    <div class="message-body">
      <div class="bbWrapper"><p>OP body</p></div>
    </div>
  </article>
</body></html>`;
    const detail = parseThreadHtmlForTests(
      html,
      'https://f95zone.to/threads/sample.456/',
    );
    expect(detail.rating).toBe(3.7);
  });
});
