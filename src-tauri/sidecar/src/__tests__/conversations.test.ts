import { describe, expect, it } from 'vitest';
import {
  extractConversationIdFromPath,
  extractConversationPathFromUrl,
  parseConversationDetailHtml,
  parseConversationsListHtml,
} from '../domain/f95/conversations';
import { parseConversationReplyResponse, buildConversationBbcodePreviewForm } from '../domain/f95/conversationReply';

describe('extractConversationPathFromUrl', () => {
  it('parses slug.id paths', () => {
    expect(
      extractConversationPathFromUrl('https://f95zone.to/conversations/hello-world.12345/'),
    ).toBe('hello-world.12345');
  });

  it('returns null for non-conversation URLs', () => {
    expect(extractConversationPathFromUrl('https://f95zone.to/threads/1/')).toBeNull();
  });
});

describe('extractConversationIdFromPath', () => {
  it('reads numeric suffix', () => {
    expect(extractConversationIdFromPath('hello-world.12345')).toBe('12345');
  });
});

describe('parseConversationsListHtml', () => {
  it('parses structItem conversation rows', () => {
    const html = `
      <div class="structItem structItem--conversation structItem--unread">
        <div class="structItem-cell structItem-cell--icon">
          <img class="avatar" src="/avatars/a.jpg">
        </div>
        <div class="structItem-cell structItem-cell--main">
          <div class="structItem-title">
            <a href="/conversations/project-update.999/">Project update</a>
          </div>
          <div class="structItem-minor">
            <ul class="structItem-parts">
              <li><a href="/members/alice.55/">Alice</a></li>
              <li>Bob</li>
            </ul>
          </div>
        </div>
        <div class="structItem-cell structItem-cell--latest">
          <a href="/conversations/project-update.999/">Thanks for the reply</a>
          <time datetime="2026-01-02">Jan 2</time>
        </div>
      </div>`;
    const items = parseConversationsListHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      conversationId: '999',
      conversationPath: 'project-update.999',
      title: 'Project update',
      starterUsername: 'Alice',
      starterUserId: '55',
      recipients: ['Alice', 'Bob'],
      lastMessagePreview: 'Thanks for the reply',
      lastMessageDate: '2026-01-02',
      isUnread: true,
      avatarUrl: 'https://f95zone.to/avatars/a.jpg',
    });
  });
});

describe('parseConversationDetailHtml', () => {
  it('parses title and messages', () => {
    const html = `
      <h1 class="p-title-value">Support thread</h1>
      <article class="message message--conversationMessage" id="js-message-42" data-content="message-42">
        <header class="message-attribution">
          <div class="message-name"><a href="/members/alice.55/">Alice</a></div>
          <time datetime="2026-01-01">Jan 1</time>
        </header>
        <div class="message-body">
          <div class="bbWrapper">Hello there</div>
        </div>
      </article>`;
    const detail = parseConversationDetailHtml(html, {
      conversationPath: 'support-thread.7',
      page: 1,
    });
    expect(detail.title).toBe('Support thread');
    expect(detail.conversationId).toBe('7');
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({
      messageId: '42',
      author: 'Alice',
      authorUserId: '55',
      postedAt: '2026-01-01',
      html: 'Hello there',
    });
  });

  it('parses message-body content without bbWrapper', () => {
    const html = `
      <div class="block--messages">
        <article class="message message--conversationMessage js-message" data-author="Bob">
          <div class="message-content">
            <article class="message-body">Plain text reply</article>
          </div>
        </article>
      </div>`;
    const detail = parseConversationDetailHtml(html, {
      conversationPath: 'appeal.1',
      page: 1,
    });
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.author).toBe('Bob');
    expect(detail.messages[0]?.html).toContain('Plain text reply');
  });
});

describe('parseConversationReplyResponse', () => {
  it('returns message id from redirect JSON', () => {
    const result = parseConversationReplyResponse({
      conversationPath: 'foo.1',
      body: JSON.stringify({
        status: 'ok',
        redirect: '/conversations/foo.1/#message-88',
      }),
    });
    expect(result).toEqual({ conversationPath: 'foo.1', messageId: '88' });
  });

  it('throws on error JSON', () => {
    expect(() =>
      parseConversationReplyResponse({
        conversationPath: 'foo.1',
        body: JSON.stringify({ status: 'error', errors: ['Please enter a message.'] }),
      }),
    ).toThrow(/Please enter a message/);
  });
});

describe('buildConversationBbcodePreviewForm', () => {
  it('posts message to conversations/{path}/reply-preview', () => {
    const form = buildConversationBbcodePreviewForm({
      conversationPath: 'ban-appeal.42',
      bbCode: '[B]hi[/B]',
      xfToken: 'token',
      requestUri: '/conversations/ban-appeal.42/',
    });
    expect(form.url).toContain('/conversations/ban-appeal.42/reply-preview');
    expect(form.body).toContain('message=%5BB%5Dhi%5B%2FB%5D');
    expect(form.headers.referer).toContain('/conversations/ban-appeal.42/');
  });
});
