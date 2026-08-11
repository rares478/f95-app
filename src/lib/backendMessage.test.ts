import { describe, expect, it } from 'vitest';
import { parseBackendMessage, translateBackendMessage } from './backendMessage';

const dict: Record<string, string> = {
  'error.gdrive.directLink': 'GDrive failed',
  'error.host.signedIn': 'Signed in as {email}.',
};

function t(key: string, vars?: Record<string, string | number>): string {
  let raw = dict[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, n) =>
    n in vars ? String(vars[n]) : `{${n}}`,
  );
}

const exists = (k: string) => k in dict;

describe('parseBackendMessage', () => {
  it('parses plain key', () => {
    expect(parseBackendMessage('error.gdrive.directLink')).toEqual({
      key: 'error.gdrive.directLink',
    });
  });

  it('parses key with JSON vars', () => {
    expect(parseBackendMessage('error.host.signedIn|{"email":"a@b.com"}')).toEqual({
      key: 'error.host.signedIn',
      vars: { email: 'a@b.com' },
    });
  });

  it('returns null for legacy prose', () => {
    expect(parseBackendMessage('Google Drive: direct link not obtained')).toBeNull();
  });

  it('returns null when JSON after | is invalid', () => {
    expect(parseBackendMessage('error.host.signedIn|{nope')).toBeNull();
  });
});

describe('translateBackendMessage', () => {
  it('translates known keys', () => {
    expect(translateBackendMessage('error.gdrive.directLink', t, exists)).toBe('GDrive failed');
  });

  it('substitutes vars', () => {
    expect(
      translateBackendMessage('error.host.signedIn|{"email":"a@b.com"}', t, exists),
    ).toBe('Signed in as a@b.com.');
  });

  it('passes through legacy text', () => {
    expect(translateBackendMessage('old English error', t, exists)).toBe('old English error');
  });
});
