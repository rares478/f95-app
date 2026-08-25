import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadPostAttachmentToDir } from '../domain/f95/attachmentDownload';

describe('downloadPostAttachmentToDir', () => {
  it('rejects non-allowlisted urls before fetching', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-att-'));
    const fakeHttp = {
      get: async () => {
        throw new Error('http must not be called for disallowed urls');
      },
    };

    await expect(
      downloadPostAttachmentToDir({
        http: fakeHttp,
        url: 'https://evil.example/x.zip',
        fileName: 'x.zip',
        destDir: tmp,
      }),
    ).rejects.toThrow(/allow|url/i);
  });

  it('writes binary bytes from fetchBinary without utf-8 mangling', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-att-bin-'));
    // ZIP local-file header magic + non-UTF8 bytes
    const zipBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80]);

    const result = await downloadPostAttachmentToDir({
      http: {},
      url: 'https://attachments.f95zone.to/2024/01/file.bin',
      fileName: 'save.zip',
      destDir: tmp,
      fetchBinary: async () => zipBytes,
    });

    const written = fs.readFileSync(result.path);
    expect(Buffer.compare(written, Buffer.from(zipBytes))).toBe(0);
    expect(path.basename(result.path)).toBe('save.zip');
  });
});
