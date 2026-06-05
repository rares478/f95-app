// Quick offline check that the resolvers in src-tauri/src/downloader.rs are
// targeting endpoints that actually return what they expect. We do the same
// HTTP calls from Node and inspect the response shape; if Pixeldrain renames
// `hash_sha256` or MediaFire changes its HTML layout, this will catch it.

const PIXELDRAIN_ID = process.env.PIXELDRAIN_ID ?? '7rrBsDz2';
const MEDIAFIRE_URL = process.env.MEDIAFIRE_URL ?? '';

async function checkPixeldrain(): Promise<void> {
  const url = `https://pixeldrain.com/api/file/${PIXELDRAIN_ID}/info`;
  console.log(`[pixeldrain] GET ${url}`);
  const res = await fetch(url);
  console.log('[pixeldrain] status:', res.status);
  if (!res.ok) {
    console.log('[pixeldrain] body:', await res.text());
    return;
  }
  const info = await res.json() as Record<string, unknown>;
  console.log('[pixeldrain] name:', info.name);
  console.log('[pixeldrain] size:', info.size);
  console.log('[pixeldrain] hash_sha256:', info.hash_sha256);
  console.log('[pixeldrain] mime_type:', info.mime_type);
}

async function checkMediafire(): Promise<void> {
  if (!MEDIAFIRE_URL) {
    console.log('[mediafire] (skipping — set MEDIAFIRE_URL to a real share URL to test)');
    return;
  }
  console.log(`[mediafire] GET ${MEDIAFIRE_URL}`);
  const res = await fetch(MEDIAFIRE_URL, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  console.log('[mediafire] status:', res.status);
  const html = await res.text();
  // Search for the same markers the Rust resolver looks for.
  const buttonIdx = html.indexOf('id="downloadButton"');
  console.log('[mediafire] has downloadButton:', buttonIdx >= 0);
  if (buttonIdx >= 0) {
    const window = html.slice(Math.max(0, buttonIdx - 200), buttonIdx + 400);
    const hrefMatch = window.match(/href="(https?:\/\/[^"]+)"/);
    console.log('[mediafire] button href:', hrefMatch?.[1] ?? '(not found)');
  }
  const scrambled = html.match(/data-scrambled-url="([^"]+)"/);
  if (scrambled) {
    console.log('[mediafire] data-scrambled-url present (len):', scrambled[1].length);
  }
}

async function checkGofileToken(): Promise<void> {
  console.log('[gofile] POST https://api.gofile.io/accounts');
  const res = await fetch('https://api.gofile.io/accounts', {
    method: 'POST',
    headers: { 'content-length': '0' },
  });
  console.log('[gofile] status:', res.status);
  if (!res.ok) {
    console.log('[gofile] body:', await res.text());
    return;
  }
  const body = await res.json() as { status: string; data?: { token?: string } };
  console.log('[gofile] response status:', body.status);
  console.log('[gofile] token present:', typeof body.data?.token === 'string');
  if (body.data?.token) {
    console.log('[gofile] token length:', body.data.token.length);
  }
}

async function main(): Promise<void> {
  await checkPixeldrain();
  console.log();
  await checkMediafire();
  console.log();
  await checkGofileToken();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
