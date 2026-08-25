import { describe, expect, it } from 'vitest';
import { isAllowedAttachmentUrl } from '../domain/f95/attachmentUrl';
import {
  sanitizeDownloadFileName,
  uniquifyFilePath,
} from '../shared/downloadFileName';

describe('sanitizeDownloadFileName', () => {
  it('collapses path separators into a single safe segment', () => {
    expect(sanitizeDownloadFileName('../a\\b.zip')).toBe('a_b.zip');
  });
});

describe('uniquifyFilePath', () => {
  it('appends (1) before extension when the base name exists', () => {
    expect(uniquifyFilePath('/d', 'a.zip', (p) => p.endsWith('a.zip'))).toMatch(
      /a \(1\)\.zip$/,
    );
  });
});

describe('isAllowedAttachmentUrl', () => {
  it('allows f95zone.to /attachments/ and attachments CDN over https', () => {
    expect(isAllowedAttachmentUrl('https://f95zone.to/attachments/99/')).toBe(true);
    expect(
      isAllowedAttachmentUrl('https://attachments.f95zone.to/2024/01/file.bin'),
    ).toBe(true);
  });

  it('rejects non-attachment hosts and paths', () => {
    expect(isAllowedAttachmentUrl('https://evil.example/a.zip')).toBe(false);
    expect(isAllowedAttachmentUrl('https://f95zone.to/threads/1/')).toBe(false);
  });
});
