import { describe, expect, it } from 'vitest';
import { parseThreadHtmlForTests } from '../domain/game/client';

describe('GameDetail.attachments (thread OP)', () => {
  it('parses OP attachment chrome into detail.attachments', () => {
    const html = `
<html><body>
  <h1 class="p-title-value">Sample Game</h1>
  <article class="message" data-author="OpAuthor">
    <div class="message-name">OpAuthor</div>
    <div class="message-body">
      <div class="bbWrapper"><p>OP body</p>
        <a href="/attachments/inline-pic.1/">should-not-count.jpg</a>
      </div>
    </div>
    <section class="message-attachments">
      <ul class="attachmentList">
        <li class="attachment">
          <div class="attachment-name">
            <a href="/attachments/mysave-zip.99/">mysave.zip</a>
          </div>
          <div class="attachment-details">1.5 MB</div>
        </li>
      </ul>
    </section>
  </article>
</body></html>`;
    const detail = parseThreadHtmlForTests(
      html,
      'https://f95zone.to/threads/sample.123/',
    );
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0]).toMatchObject({
      id: '99',
      fileName: 'mysave.zip',
      isImage: false,
      url: expect.stringContaining('/attachments/mysave-zip.99/'),
    });
  });
});
