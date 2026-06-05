// Reproduce the 401 the user is hitting from the in-app resolver.
// Walks through every step the Rust resolver does to find which one breaks.

const CONTENT_ID = process.env.CONTENT_ID ?? 'r9nRWl';

interface AcctResp {
  status: string;
  data?: { token?: string; id?: string };
  [k: string]: unknown;
}
interface ContentsResp {
  status: string;
  data?: unknown;
  [k: string]: unknown;
}

async function step1_account(): Promise<string | null> {
  console.log('=== STEP 1: POST /accounts ===');
  const res = await fetch('https://api.gofile.io/accounts', {
    method: 'POST',
    headers: {
      'content-length': '0',
      origin: 'https://gofile.io',
      referer: 'https://gofile.io/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  console.log('  status:', res.status);
  const body = (await res.json()) as AcctResp;
  console.log('  body:', JSON.stringify(body, null, 2));
  return body.data?.token ?? null;
}

async function step2_wt_from_js(): Promise<string | null> {
  console.log('\n=== STEP 2: scrape wt from gofile.io JS ===');
  for (const path of ['/dist/js/global.js', '/dist/js/alljs.js']) {
    const url = `https://gofile.io${path}`;
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      console.log('  GET', url, '→', res.status);
      if (!res.ok) continue;
      const txt = await res.text();
      // Look for the wt assignment.
      const m =
        txt.match(/appdata\.wt\s*=\s*["']([^"']+)["']/) ??
        txt.match(/wt\s*:\s*["']([a-z0-9]{8,16})["']/i) ??
        txt.match(/["']wt["']\s*:\s*["']([a-z0-9]{8,16})["']/i);
      console.log('  match:', m?.[1] ?? '(none)');
      if (m) return m[1];
    } catch (e) {
      console.log('  ERR:', e);
    }
  }
  return null;
}

async function step3_contents(
  token: string,
  wt: string,
  contentId: string,
): Promise<void> {
  console.log(`\n=== STEP 3: GET /contents/${contentId}?wt=${wt} ===`);
  const url = `https://api.gofile.io/contents/${contentId}?wt=${wt}&cache=true`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'https://gofile.io',
      referer: 'https://gofile.io/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  console.log('  status:', res.status);
  const txt = await res.text();
  try {
    const j = JSON.parse(txt) as ContentsResp;
    console.log('  body:', JSON.stringify(j, null, 2).slice(0, 1200));
  } catch {
    console.log('  raw:', txt.slice(0, 800));
  }
}

async function step4_contents_no_wt(token: string, contentId: string): Promise<void> {
  console.log(`\n=== STEP 4: GET /contents/${contentId} WITHOUT wt ===`);
  const url = `https://api.gofile.io/contents/${contentId}?cache=true`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'https://gofile.io',
      referer: 'https://gofile.io/',
    },
  });
  console.log('  status:', res.status);
  const txt = await res.text();
  console.log('  body:', txt.slice(0, 600));
}

async function main(): Promise<void> {
  const token = await step1_account();
  if (!token) {
    console.error('no token, aborting');
    process.exit(1);
  }
  const wt = await step2_wt_from_js();
  await step3_contents(token, wt ?? '4fd6sg89d7s6', CONTENT_ID);
  if (wt && wt !== '4fd6sg89d7s6') {
    console.log('\n=== STEP 3b: retry with the stale wt for comparison ===');
    await step3_contents(token, '4fd6sg89d7s6', CONTENT_ID);
  }
  await step4_contents_no_wt(token, CONTENT_ID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
