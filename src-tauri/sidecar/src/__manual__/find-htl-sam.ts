import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');
const BASE = 'https://f95zone.to';

async function main() {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const params = new URLSearchParams({
    cmd: 'list',
    cat: 'games',
    page: '1',
    search: 'Hard to Love',
    sort: 'date',
    rows: '20',
  });
  const res = await client.get(`${BASE}/sam/latest_alpha/latest_data.php?${params}`);
  console.log('sam status', res.status);
  console.log(res.body.slice(0, 1500));
  try {
    const data = JSON.parse(res.body);
    const rows = data?.data ?? data?.rows ?? data;
    console.log(JSON.stringify(rows, null, 2).slice(0, 2000));
    const list = Array.isArray(rows) ? rows : rows?.data ?? [];
    for (const row of list.slice?.(0, 10) ?? []) {
      console.log(row.thread_id ?? row.id, row.title ?? row.name);
    }
    const id =
      list?.[0]?.thread_id ?? list?.[0]?.id ?? list?.[0]?.threadId;
    if (id) {
      const r = await client.get(`${BASE}/threads/${id}/`);
      await fs.writeFile('thread-htl.html', r.body, 'utf8');
      console.log('saved thread', id, 'len', r.body.length);
      console.log('has Before Remake', /Before Remake/i.test(r.body));
      console.log('has Act 2', /Act\s*2/i.test(r.body));
    }
  } catch (e) {
    console.error('parse fail', e);
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
