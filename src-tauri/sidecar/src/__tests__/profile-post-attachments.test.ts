import { describe, expect, it } from 'vitest';
import { parseProfilePosts } from '../domain/f95/client';

describe('ProfilePostItem.attachments', () => {
  it('parses message-attachments chrome on profile posts', () => {
    const html = `
<div class="block block--messages" data-type="profile_post">
  <article class="message message--simple" data-content="profile-post-42">
    <div class="message-cell message-cell--main">
      <div class="message-content">
        <header class="message-attribution message-attribution--plain">
          <ul>
            <li class="message-attribution-user">
              <h4 class="attribution"><a class="username">Attacher</a></h4>
            </li>
            <li><time data-date-string="Aug 1, 2026">Aug 1, 2026</time></li>
          </ul>
        </header>
        <div class="bbWrapper">
          <p>See attached save</p>
          <a href="/attachments/inline-pic.1/">should-not-count.jpg</a>
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
      </div>
    </div>
  </article>
</div>`;

    const posts = parseProfilePosts(html);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.attachments).toHaveLength(1);
    expect(posts[0]?.attachments[0]).toMatchObject({
      id: '99',
      fileName: 'mysave.zip',
      isImage: false,
      url: expect.stringContaining('/attachments/mysave-zip.99/'),
    });
  });

  it('defaults attachments to empty array when chrome is absent', () => {
    const html = `
<div class="block block--messages" data-type="profile_post">
  <article class="message message--simple" data-content="profile-post-7">
    <div class="message-cell message-cell--main">
      <div class="message-content">
        <header class="message-attribution message-attribution--plain">
          <ul>
            <li class="message-attribution-user">
              <h4 class="attribution"><a class="username">Plain</a></h4>
            </li>
            <li><time data-date-string="Jan 1, 2024">Jan 1, 2024</time></li>
          </ul>
        </header>
        <article class="message-body">hello</article>
      </div>
    </div>
  </article>
</div>`;

    const posts = parseProfilePosts(html);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.attachments).toEqual([]);
  });
});
