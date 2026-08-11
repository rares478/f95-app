import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RPC_ERROR, RpcError } from '../rpc';
import { buildThreadReplyForm, parseThreadReplyResponse } from '../domain/game/reply';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseThreadReplyResponse', () => {
  it('extracts postId and page from redirect', () => {
    const result = parseThreadReplyResponse({
      threadId: '100',
      body: fix('thread-reply-ok.json'),
    });
    expect(result).toEqual({
      threadId: '100',
      postId: '555',
      page: 3,
    });
  });

  it('throws RpcError with XF message on error JSON', () => {
    expect(() =>
      parseThreadReplyResponse({
        threadId: '100',
        body: fix('thread-reply-error.json'),
      }),
    ).toThrow(RpcError);
    try {
      parseThreadReplyResponse({
        threadId: '100',
        body: fix('thread-reply-error.json'),
      });
    } catch (e) {
      expect((e as RpcError).message).toMatch(/closed/i);
    }
  });

  it('extracts message from field-keyed errors object (live XF shape)', () => {
    expect(() =>
      parseThreadReplyResponse({
        threadId: '100',
        body: fix('thread-reply-error-fields.json'),
      }),
    ).toThrow(RpcError);
    try {
      parseThreadReplyResponse({
        threadId: '100',
        body: fix('thread-reply-error-fields.json'),
      });
    } catch (e) {
      expect((e as RpcError).message).toMatch(/valid message/i);
    }
  });

  it('returns null postId when success has no post link', () => {
    const result = parseThreadReplyResponse({
      threadId: '100',
      body: JSON.stringify({ status: 'ok' }),
      finalUrl: 'https://f95zone.to/threads/100/',
    });
    expect(result.postId).toBeNull();
    expect(result.threadId).toBe('100');
  });

  it('throws CLOUDFLARE_CHALLENGE on captcha status', () => {
    expect(() =>
      parseThreadReplyResponse({
        threadId: '100',
        body: JSON.stringify({ status: 'captcha', message: 'need captcha' }),
      }),
    ).toThrow(RpcError);
    try {
      parseThreadReplyResponse({
        threadId: '100',
        body: JSON.stringify({ status: 'captcha', message: 'need captcha' }),
      });
    } catch (e) {
      const err = e as RpcError;
      expect(err.code).toBe(RPC_ERROR.CLOUDFLARE_CHALLENGE);
      expect(err.message).toMatch(/captcha/i);
    }
  });
});

describe('buildThreadReplyForm', () => {
  it('targets add-reply with message and csrf', () => {
    const form = buildThreadReplyForm({
      threadId: '100',
      message: 'hello',
      xfToken: 'tok',
      requestUri: '/threads/100/',
    });
    expect(form.url).toContain('/threads/100/add-reply');
    expect(form.body).toContain('message=hello');
    expect(form.body).toContain('_xfToken=tok');
    expect(form.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(form.headers['x-requested-with']).toBe('XMLHttpRequest');
  });
});
