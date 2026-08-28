import { describe, expect, it } from 'vitest';
import { composerIdFor, openOnF95UrlFor } from './replyComposer';

describe('replyComposer helpers', () => {
  it('builds thread preview ids and urls', () => {
    const target = { kind: 'thread' as const, threadId: '93340' };
    expect(composerIdFor(target)).toBe('reply-thread-93340');
    expect(openOnF95UrlFor(target)).toBe('https://f95zone.to/threads/93340/');
  });

  it('builds conversation preview ids and urls', () => {
    const target = { kind: 'conversation' as const, conversationPath: 'ban-appeal.12' };
    expect(composerIdFor(target)).toBe('reply-conversation-ban-appeal.12');
    expect(openOnF95UrlFor(target)).toBe(
      'https://f95zone.to/conversations/ban-appeal.12/',
    );
  });

  it('prefers explicit open-on-f95 override', () => {
    expect(
      openOnF95UrlFor(
        { kind: 'conversation', conversationPath: 'x.1' },
        'https://example.test/custom',
      ),
    ).toBe('https://example.test/custom');
  });
});
