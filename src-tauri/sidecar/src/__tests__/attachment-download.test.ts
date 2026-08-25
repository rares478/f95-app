import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  downloadPostAttachmentToDir,
  fetchAttachmentBinary,
} from '../domain/f95/attachmentDownload';

function emptyTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'f95-att-'));
}

describe('downloadPostAttachmentToDir', () => {
  it('rejects non-allowlisted urls before fetching', async () => {
    const tmp = emptyTmp();

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://evil.example/x.zip',
        fileName: 'x.zip',
        destDir: tmp,
        fetchBinary: async () => {
          throw new Error('fetch must not be called for disallowed urls');
        },
      }),
    ).rejects.toThrow(/allow|url/i);
  });

  it('writes binary bytes from fetchBinary without utf-8 mangling', async () => {
    const tmp = emptyTmp();
    // ZIP local-file header magic + non-UTF8 bytes
    const zipBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80]);

    const result = await downloadPostAttachmentToDir({
      url: 'https://attachments.f95zone.to/2024/01/file.bin',
      fileName: 'save.zip',
      destDir: tmp,
      fetchBinary: async () => zipBytes,
    });

    const written = fs.readFileSync(result.path);
    expect(Buffer.compare(written, Buffer.from(zipBytes))).toBe(0);
    expect(path.basename(result.path)).toBe('save.zip');
  });

  it('rejects redirect off allowlist to evil host and writes no file', async () => {
    const tmp = emptyTmp();
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/x' },
      });

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://attachments.f95zone.to/2024/01/file.bin',
        fileName: 'x.zip',
        destDir: tmp,
        fetchBinary: (u) => fetchAttachmentBinary(u, { fetchImpl }),
      }),
    ).rejects.toThrow(/allow|url/i);

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('rejects redirect to non-attachment f95zone path and writes no file', async () => {
    const tmp = emptyTmp();
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://f95zone.to/threads/1/' },
      });

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://f95zone.to/attachments/99/',
        fileName: 'x.zip',
        destDir: tmp,
        fetchBinary: (u) => fetchAttachmentBinary(u, { fetchImpl }),
      }),
    ).rejects.toThrow(/allow|url/i);

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('rejects text/html responses before write', async () => {
    const tmp = emptyTmp();
    const html = '<!DOCTYPE html><html><body>Please log in</body></html>';
    const fetchImpl: typeof fetch = async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://attachments.f95zone.to/2024/01/file.bin',
        fileName: 'save.zip',
        destDir: tmp,
        fetchBinary: (u) => fetchAttachmentBinary(u, { fetchImpl }),
      }),
    ).rejects.toThrow(/html/i);

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('rejects HTML-looking login body even without text/html content-type', async () => {
    const tmp = emptyTmp();
    const html = '<html><head><title>Log in</title></head><body>login form</body></html>';
    const fetchImpl: typeof fetch = async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://attachments.f95zone.to/2024/01/file.bin',
        fileName: 'save.zip',
        destDir: tmp,
        fetchBinary: (u) => fetchAttachmentBinary(u, { fetchImpl }),
      }),
    ).rejects.toThrow(/html/i);

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('aborts when Content-Length exceeds max size', async () => {
    const tmp = emptyTmp();
    const maxBytes = 64;
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-length': String(maxBytes + 1),
        },
      });

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://attachments.f95zone.to/2024/01/file.bin',
        fileName: 'big.zip',
        destDir: tmp,
        fetchBinary: (u) => fetchAttachmentBinary(u, { fetchImpl, maxBytes }),
      }),
    ).rejects.toThrow(/size|large|limit|bytes/i);

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('refuses body longer than max size when Content-Length is absent', async () => {
    const tmp = emptyTmp();
    const maxBytes = 8;
    const body = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const fetchImpl: typeof fetch = async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });

    await expect(
      downloadPostAttachmentToDir({
        url: 'https://attachments.f95zone.to/2024/01/file.bin',
        fileName: 'big.zip',
        destDir: tmp,
        fetchBinary: (u) => fetchAttachmentBinary(u, { fetchImpl, maxBytes }),
      }),
    ).rejects.toThrow(/size|large|limit|bytes/i);

    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});
