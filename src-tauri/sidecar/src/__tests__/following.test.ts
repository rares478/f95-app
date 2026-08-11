import { describe, expect, it } from 'vitest';
import { parseFollowing } from '../domain/social/client';

const CONTENT_ROW = `
<div class="p-body-main">
  <div class="contentRow">
    <div class="contentRow-figure">
      <a href="/members/cool-dev.12345/" class="avatar avatar--s">
        <img
          src="/styles/default/xenforo/avatars/blank.png"
          data-src="/data/avatars/s/0/12345.jpg"
          class="avatar-u12345-s"
          alt="cool-dev"
        />
      </a>
    </div>
    <div class="contentRow-main">
      <a href="/members/cool-dev.12345/">Cool Dev</a>
      <div class="userTitle">Ren'Py Creator</div>
    </div>
  </div>
</div>`;

describe('parseFollowing', () => {
  it('prefers data-src over lazy-load placeholder src', () => {
    const users = parseFollowing(CONTENT_ROW);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      userId: '12345',
      username: 'Cool Dev',
      avatarUrl: 'https://f95zone.to/data/avatars/s/0/12345.jpg',
      customTitle: "Ren'Py Creator",
    });
  });

  it('returns null avatar when only placeholder src exists', () => {
    const html = `
<div class="p-body-main">
  <div class="contentRow">
    <div class="contentRow-figure">
      <a href="/members/nopic.99/" class="avatar avatar--s">
        <img src="/styles/default/xenforo/avatars/blank.png" class="avatar-u99-s" />
      </a>
    </div>
    <div class="contentRow-main">
      <a href="/members/nopic.99/">No Pic</a>
    </div>
  </div>
</div>`;
    const users = parseFollowing(html);
    expect(users[0]?.avatarUrl).toBeNull();
  });

  it('parses empty following state', () => {
    const html = `
<div class="p-body-main">
  <div class="blockMessage">You are not currently following any members.</div>
</div>`;
    expect(parseFollowing(html)).toEqual([]);
  });
});
