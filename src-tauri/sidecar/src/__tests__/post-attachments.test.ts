import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { parseMessageAttachments } from '../domain/game/postAttachments';

describe('parseMessageAttachments', () => {
  it('parses non-image file rows from message-attachments chrome', () => {
    const html = `<article class="message">
      <div class="message-body"><div class="bbWrapper"><p>hi</p>
        <a href="/attachments/inline-pic.1/">should-not-count.jpg</a>
      </div></div>
      <section class="message-attachments">
        <ul class="attachmentList">
          <li class="attachment">
            <div class="attachment-name">
              <a href="/attachments/mysave-zip.99/">mysave.zip</a>
            </div>
            <div class="attachment-details">1.5 MB</div>
          </li>
          <li class="attachment attachment--image">
            <a href="/attachments/shot-png.100/" class="file">shot.png</a>
          </li>
        </ul>
      </section>
    </article>`;
    const $ = load(html);
    const list = parseMessageAttachments($, $('article.message').first());
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: '99',
      fileName: 'mysave.zip',
      isImage: false,
      url: expect.stringContaining('/attachments/mysave-zip.99/'),
    });
    expect(list[0]!.fileSize).toBeGreaterThan(1_000_000);
    expect(list[1]!.isImage).toBe(true);
  });

  it('returns empty when only body links exist', () => {
    const html = `<article class="message">
      <div class="message-body"><div class="bbWrapper">
        <a href="/attachments/x.1/">x.zip</a>
      </div></div>
    </article>`;
    const $ = load(html);
    expect(parseMessageAttachments($, $('article.message').first())).toEqual([]);
  });
});
