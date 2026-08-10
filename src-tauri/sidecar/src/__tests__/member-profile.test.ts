import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { parseMemberBadges, parseMemberHeader, parseProfilePosts } from '../domain/f95/client';

const PROFILE_POSTS_BLOCK = `
<div class="block block--messages" data-type="profile_post">
  <article class="message message--simple" data-content="profile-post-145302">
    <div class="message-inner">
      <div class="message-cell message-cell--user">
        <div class="message-avatar"><img data-src="/data/avatars/s/0/137.jpg" src="/blank.png" /></div>
      </div>
      <div class="message-cell message-cell--main">
        <div class="message-main">
          <div class="message-content">
            <header class="message-attribution message-attribution--plain">
              <ul class="listInline listInline--bullet">
                <li class="message-attribution-user">
                  <h4 class="attribution"><a class="username">Lerd0</a></h4>
                </li>
                <li><time data-date-string="Jun 26, 2026">Jun 26, 2026</time></li>
              </ul>
            </header>
            <article class="message-body">(•࿉•) ⋋(•⌔•)⋌</article>
          </div>
        </div>
      </div>
    </div>
  </article>
  <article class="message message--simple" data-content="profile-post-127364">
    <div class="message-inner">
      <div class="message-cell message-cell--main">
        <div class="message-content">
          <header class="message-attribution message-attribution--plain">
            <ul>
              <li class="message-attribution-user">
                <h4 class="attribution"><a class="username">Daxter250</a></h4>
              </li>
              <li><time data-date-string="Oct 12, 2025">Oct 12, 2025</time></li>
            </ul>
          </header>
          <article class="message-body">
            <a href="https://www.youtube.com/watch?v=a1vjdEfxjX8">https://www.youtube.com/watch?v=a1vjdEfxjX8</a>
          </article>
        </div>
      </div>
    </div>
  </article>
  <article class="message message--simple" data-content="profile-post-999">
    <div class="message-cell message-cell--main">
      <div class="message-content">
        <header class="message-attribution message-attribution--plain">
          <ul>
            <li class="message-attribution-user">
              <h4 class="attribution"><a class="username">Poster</a></h4>
            </li>
            <li><time data-date-string="Jan 1, 2024">Jan 1, 2024</time></li>
          </ul>
        </header>
        <div class="bbWrapper">
          <img src="data:image/gif;base64,R0lGODlh" data-src="/attachments/photo.jpg" alt="pic" />
        </div>
      </div>
    </div>
  </article>
  <article class="message message--simple" data-content="profile-post-giphy">
    <div class="message-cell message-cell--main">
      <div class="message-content">
        <header class="message-attribution message-attribution--plain">
          <ul>
            <li class="message-attribution-user">
              <h4 class="attribution"><a class="username">Giffer</a></h4>
            </li>
            <li><time data-date-string="Mar 1, 2024">Mar 1, 2024</time></li>
          </ul>
        </header>
        <div class="bbWrapper">
          <div class="bbMediaWrapper">
            <div class="bbMediaWrapper-inner">
              <iframe src="https://giphy.com/embed/z7ZSSH2OhKSQM" width="500" height="375" frameborder="0" allowfullscreen=""></iframe>
            </div>
          </div>
        </div>
      </div>
    </div>
  </article>
</div>`;

const MEMBER_HEADER = `
<div class="memberHeader">
  <div class="memberHeader-blurb">
    <div class="userBanner Moderator"><strong>Moderator</strong></div>
    <div class="userBanner Donor"><strong>Donor</strong></div>
  </div>
</div>`;

describe('parseProfilePosts', () => {
  it('parses message-body posts without bbWrapper', () => {
    const posts = parseProfilePosts(PROFILE_POSTS_BLOCK);
    expect(posts).toHaveLength(4);
    expect(posts[0]).toMatchObject({
      authorName: 'Lerd0',
      messageText: '(•࿉•) ⋋(•⌔•)⋌',
      date: 'Jun 26, 2026',
    });
    expect(posts[0]?.messageHtml).not.toMatch(/Lerd0/);
    expect(posts[1]?.messageText).toContain('youtube.com');
  });

  it('normalizes lazy-loaded images in bbWrapper posts', () => {
    const posts = parseProfilePosts(PROFILE_POSTS_BLOCK);
    expect(posts[2]?.messageHtml).toContain('https://f95zone.to/attachments/photo.jpg');
  });

  it('converts giphy embeds to img tags', () => {
    const posts = parseProfilePosts(PROFILE_POSTS_BLOCK);
    expect(posts[3]?.messageHtml).toContain(
      'https://media.giphy.com/media/z7ZSSH2OhKSQM/giphy.gif',
    );
    expect(posts[3]?.messageHtml).not.toContain('<iframe');
  });
});

const MEMBER_STATS = `
<div class="memberHeader-stats">
  <dl class="pairs pairs--rows"><dt>Messages</dt><dd>100</dd></dl>
  <dl class="pairs pairs--rows"><dt>Reaction score</dt><dd>500</dd></dl>
  <dl class="pairs pairs--rows"><dt>Donated</dt><dd>$40.00</dd></dl>
</div>`;

describe('parseMemberHeader', () => {
  it('parses Donated stat label as donations', () => {
    const info = parseMemberHeader(MEMBER_STATS);
    expect(info.donations).toBe('$40.00');
    expect(info.extraStats).not.toHaveProperty('Donated');
  });
});

describe('parseMemberBadges', () => {
  it('parses role badges from member header', () => {
    const $ = cheerio.load(MEMBER_HEADER);
    expect(parseMemberBadges($).map((b) => b.label)).toEqual(['Moderator', 'Donor']);
  });
});
