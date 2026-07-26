import { describe, expect, it } from 'vitest';
import {
  extractPostIdFromUrl,
  extractThreadIdFromUrl,
  parseF95ContentTarget,
} from './f95ThreadUrls';

describe('extractThreadIdFromUrl', () => {
  it('parses /threads/{id}/', () => {
    expect(extractThreadIdFromUrl('https://f95zone.to/threads/foo.12345/')).toBe('12345');
    expect(extractThreadIdFromUrl('/threads/999/page-2')).toBe('999');
  });

  it('returns null when missing', () => {
    expect(extractThreadIdFromUrl(null)).toBeNull();
    expect(extractThreadIdFromUrl('https://f95zone.to/posts/1/')).toBeNull();
  });
});

describe('extractPostIdFromUrl', () => {
  it('parses /posts/{id}', () => {
    expect(extractPostIdFromUrl('https://f95zone.to/posts/55555/')).toBe('55555');
  });

  it('parses #post-{id} and /post-{id}', () => {
    expect(extractPostIdFromUrl('https://f95zone.to/threads/1/#post-777')).toBe('777');
    expect(extractPostIdFromUrl('https://f95zone.to/threads/1/post-888')).toBe('888');
  });
});

describe('parseF95ContentTarget', () => {
  it('classifies thread with optional post', () => {
    expect(parseF95ContentTarget('https://f95zone.to/threads/12/#post-34')).toEqual({
      kind: 'thread',
      threadId: '12',
      postId: '34',
    });
  });

  it('classifies bare /posts/{id}', () => {
    expect(parseF95ContentTarget('https://f95zone.to/posts/99/')).toEqual({
      kind: 'post',
      postId: '99',
    });
  });

  it('classifies conversations as external', () => {
    expect(parseF95ContentTarget('https://f95zone.to/conversations/1/')).toEqual({
      kind: 'external',
      url: 'https://f95zone.to/conversations/1/',
    });
  });

  it('returns none for null', () => {
    expect(parseF95ContentTarget(null)).toEqual({ kind: 'none' });
  });
});
