import type { Download, Page, Response } from 'playwright';

import { RPC_ERROR, RpcError } from '../../rpc';
import { USER_AGENT } from '../../shared/constants';
import { getPlaywrightBrowser } from '../../infra/playwright/browser';

const UA = USER_AGENT;

function log(msg: string): void {
  process.stderr.write(`[gdrive] ${msg}\n`);
}



/** Extract a Drive file/folder id from common share URL shapes. */

export function extractGdriveId(raw: string): string | null {

  const trimmed = raw.trim();

  for (const prefix of ['/file/d/', '/document/d/', '/spreadsheets/d/', '/presentation/d/']) {

    const idx = trimmed.indexOf(prefix);

    if (idx >= 0) {

      const rest = trimmed.slice(idx + prefix.length);

      const id = rest.split('/')[0]?.split('?')[0]?.trim();

      if (id && isPlausibleId(id)) return id;

    }

  }

  const folderIdx = trimmed.indexOf('/folders/');

  if (folderIdx >= 0) {

    const rest = trimmed.slice(folderIdx + '/folders/'.length);

    const id = rest.split('/')[0]?.split('?')[0]?.trim();

    if (id && isPlausibleId(id)) return id;

  }

  try {

    const u = new URL(trimmed);

    const id = u.searchParams.get('id')?.trim();

    if (id && isPlausibleId(id)) return id;

  } catch {

    /* ignore */

  }

  return null;

}



function isPlausibleId(id: string): boolean {

  return id.length >= 10 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);

}



function looksLikeConfirmToken(name: string): boolean {

  return name.length >= 32 && !name.includes('.') && /^[a-zA-Z0-9_-]+$/.test(name);

}



function sanitizeDriveTitle(title: string): string | null {

  const t = title

    .trim()

    .replace(/\s*-\s*Google Drive\s*$/i, '')

    .replace(/\s*-\s*Google Docs\s*$/i, '')

    .trim();

  if (

    !t ||

    t.toLowerCase() === 'google drive' ||

    /not found|não encontrad|nao encontrad|página não encontrada/i.test(t)

  ) {

    return null;

  }

  return t;

}



/** True only for CDN stream URLs — not uc interstitial / confirm pages. */

function isDirectDownloadUrl(url: string): boolean {

  if (!url.startsWith('http')) return false;

  if (url.includes('accounts.google.com')) return false;

  if (url.includes('/file/d/') && url.includes('/view')) return false;

  if (url.includes('drive.google.com/uc')) return false;

  if (url.includes('export=download') && !url.includes('drive.usercontent.google.com')) {

    return false;

  }

  return (

    url.includes('drive.usercontent.google.com') ||

    url.includes('googleusercontent.com')

  );

}



function filenameFromDisposition(raw: string | undefined): string | null {

  if (!raw) return null;

  const star = raw.match(/filename\*=(?:UTF-8'')?([^;]+)/i);

  if (star?.[1]) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));

  const plain = raw.match(/filename="?([^";]+)"?/i);

  const name = plain?.[1]?.trim() || null;

  if (name && looksLikeConfirmToken(name)) return null;

  return name;

}



function pickFileName(

  candidates: Array<string | undefined | null>,

  id: string,

  titleName: string | null,

): string {

  for (const c of candidates) {

    const n = c?.trim();

    if (n && !looksLikeConfirmToken(n)) return n;

  }

  if (titleName) return titleName;

  return `gdrive-${id}.bin`;

}



function attachDownloadCapture(

  page: Page,

  onHit: (url: string, fileName: string) => void,

): void {

  page.on('download', (dl: Download) => {

    const u = dl.url();

    if (!isDirectDownloadUrl(u)) return;

    const name = dl.suggestedFilename();

    onHit(u, looksLikeConfirmToken(name) ? '' : name);

  });

}



function attachResponseCapture(

  page: Page,

  onHit: (url: string, fileName: string) => void,

): void {

  page.on('response', (resp: Response) => {

    const u = resp.url();

    if (!isDirectDownloadUrl(u)) return;

    const cd = resp.headers()['content-disposition'];

    if (!cd?.includes('attachment') && !cd?.includes('filename')) return;

    const ct = resp.headers()['content-type'] ?? '';

    if (ct.includes('text/html')) return;

    const name = filenameFromDisposition(cd) ?? '';

    onHit(u, name);

  });

}



async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {

  for (const sel of selectors) {

    const loc = page.locator(sel).first();

    if (await loc.count()) {

      try {

        await loc.click({ timeout: 5000, force: true });

        return true;

      } catch {

        /* try next */

      }

    }

  }

  return false;

}



async function clickDownloadButtons(page: Page): Promise<void> {

  await clickFirst(page, [

    '#uc-download-link',

    'a#uc-download-link',

    'a[href*="export=download"][href*="confirm="]',

    'input#uc-download-link',

    'form#download-form input[type="submit"]',

    'input[name="confirm"]',

    'a:has-text("Download anyway")',

    'a:has-text("Fazer download mesmo assim")',

    'a:has-text("Baixar mesmo assim")',

    'button:has-text("Download anyway")',

    'button:has-text("Fazer download mesmo assim")',

  ]);

  try {

    await page

      .getByRole('button', { name: /download|baixar|fazer download/i })

      .first()

      .click({ timeout: 4000 });

  } catch {

    /* optional */

  }

}



async function waitForDirectHit(

  page: Page,

  timeoutMs: number,

): Promise<{ url: string; fileName: string } | null> {

  const respHit = page

    .waitForResponse(

      (r) => {

        if (!isDirectDownloadUrl(r.url())) return false;

        const ct = r.headers()['content-type'] ?? '';

        return !ct.includes('text/html');

      },

      { timeout: timeoutMs },

    )

    .then((r) => {

      const cd = r.headers()['content-disposition'];

      const name = filenameFromDisposition(cd) ?? '';

      return { url: r.url(), fileName: name };

    })

    .catch(() => null);



  const dlHit = page

    .waitForEvent('download', { timeout: timeoutMs })

    .then(async (dl) => {

      const u = dl.url();

      if (!isDirectDownloadUrl(u)) {

        await dl.cancel().catch(() => undefined);

        return null;

      }

      const name = dl.suggestedFilename();

      await dl.cancel().catch(() => undefined);

      return { url: u, fileName: looksLikeConfirmToken(name) ? '' : name };

    })

    .catch(() => null);



  return Promise.race([respHit, dlHit]).then((hit) => hit ?? null);

}



async function resolveConfirmHref(page: Page, id: string): Promise<string | null> {

  const ucLink = page.locator('#uc-download-link, a[href*="confirm="]').first();

  if (await ucLink.count()) {

    let href = await ucLink.getAttribute('href');

    if (href) {

      if (!href.startsWith('http')) href = new URL(href, 'https://drive.google.com').href;

      return href;

    }

  }

  const form = page.locator('form#download-form').first();

  if (await form.count()) {

    let action = await form.getAttribute('action');

    if (action) {

      if (!action.startsWith('http')) action = new URL(action, 'https://drive.google.com').href;

      return action;

    }

  }

  const html = await page.content();

  const token =

    html.match(/export=download&confirm=([a-zA-Z0-9_-]{2,128})/i)?.[1] ??

    html.match(/confirm=([a-zA-Z0-9_-]{2,128})/i)?.[1];

  if (token && token !== 't') {

    return `https://drive.google.com/uc?export=download&confirm=${token}&id=${id}`;

  }

  const embedded = html.match(

    /https:\/\/drive\.usercontent\.google\.com\/download[^"'\\]+/i,

  )?.[0];

  return embedded ?? null;

}



function needsLogin(text: string): boolean {

  return (

    /sign in to your google account/i.test(text) ||

    /you need permission/i.test(text) ||

    /sorry, you can't view or download/i.test(text) ||

    /quota exceeded/i.test(text) ||

    /too many users have viewed/i.test(text) ||

    /não foi possível abrir o arquivo/i.test(text) ||

    /nao foi possivel abrir o arquivo/i.test(text)

  );

}



/**

 * Google Drive blocks plain HTTP clients on `drive.usercontent.google.com`.

 * A real Chromium session seeds cookies, handles the virus-scan interstitial,

 * and captures the CDN URL from download / network events.

 */

export async function resolveGdrive(url: string): Promise<{

  directUrl: string;

  fileName: string;

  fileSize: number | null;

}> {

  const id = extractGdriveId(url);

  if (!id) {

    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'invalid Google Drive URL');

  }



  log(`resolve id=${id}`);



  const pw = await getPlaywrightBrowser();

  const context = await pw.newContext({

    userAgent: UA,

    acceptDownloads: true,

    locale: 'pt-BR',

  });

  await context.addInitScript(`

    Object.defineProperty(navigator, 'webdriver', { get: () => false });

  `);

  const page = await context.newPage();



  let directUrl: string | undefined;

  let fileName: string | undefined;



  const capture = (u: string, name: string) => {

    if (isDirectDownloadUrl(u)) {

      directUrl = u;

      if (name && !looksLikeConfirmToken(name)) fileName = name;

    }

  };

  attachDownloadCapture(page, capture);

  attachResponseCapture(page, capture);

  context.on('page', (popup) => {

    attachDownloadCapture(popup, capture);

    attachResponseCapture(popup, capture);

  });



  const viewUrl = url.includes('/file/d/')

    ? url.split('?')[0]

    : url.includes('/folders/')

      ? url.split('?')[0]

      : `https://drive.google.com/file/d/${id}/view`;



  try {

    log(`goto view ${viewUrl}`);

    await page.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const viewText = await page.locator('body').innerText().catch(() => '');

    if (needsLogin(viewText)) {

      throw new RpcError(

        RPC_ERROR.INTERNAL,

        'Google Drive: arquivo privado — o link precisa estar público ("Qualquer pessoa com o link")',

      );

    }



    const titleName = sanitizeDriveTitle(await page.title());

    log(`view title=${titleName ?? '(none)'}`);



    // Strategy A: uc export (handles most public file shares).

    const ucUrl = `https://drive.google.com/uc?export=download&id=${id}`;

    log('strategy A: uc export');

    const hitPromise = waitForDirectHit(page, 35_000);

    await page.goto(ucUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    await clickDownloadButtons(page);



    let hit = await hitPromise;

    if (hit) {

      directUrl = hit.url;

      fileName = hit.fileName || fileName;

    }



    // Strategy A2: follow confirm link / token from interstitial HTML.

    if (!directUrl) {

      const confirmHref = await resolveConfirmHref(page, id);

      if (confirmHref?.startsWith('http')) {

        log(`strategy A2: ${confirmHref.slice(0, 80)}…`);

        const hit2 = waitForDirectHit(page, 35_000);

        await page.goto(confirmHref, { waitUntil: 'domcontentloaded', timeout: 45_000 });

        await clickDownloadButtons(page);

        hit = await hit2;

        if (hit) {

          directUrl = hit.url;

          fileName = hit.fileName || fileName;

        }

      }

    }



    // Strategy B: usercontent endpoint with confirm=t (browser cookies present).

    if (!directUrl) {

      log('strategy B: usercontent confirm=t');

      const userUrl =

        `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

      const hit3 = waitForDirectHit(page, 30_000);

      await page.goto(userUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);

      hit = await hit3;

      if (hit) {

        directUrl = hit.url;

        fileName = hit.fileName || fileName;

      }

    }



    // Strategy C: toolbar download on the preview page.

    if (!directUrl) {

      log('strategy C: toolbar download');

      await page.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      const hit4 = waitForDirectHit(page, 30_000);

      await clickFirst(page, [

        '[aria-label="Download"]',

        '[aria-label="Fazer download"]',

        '[aria-label="Baixar"]',

        '[data-tooltip="Download"]',

        '[data-tooltip="Fazer download"]',

        '[data-tooltip="Baixar"]',

        'div[data-id="download"]',

        '#topbar-download',

      ]);

      hit = await hit4;

      if (hit) {

        directUrl = hit.url;

        fileName = hit.fileName || fileName;

      }

    }



    for (let i = 0; i < 8 && !directUrl; i++) {

      await page.waitForTimeout(500);

    }



    if (!directUrl || !isDirectDownloadUrl(directUrl)) {

      const body = await page.locator('body').innerText().catch(() => '');

      if (needsLogin(body)) {

        throw new RpcError(

          RPC_ERROR.INTERNAL,

          'Google Drive: arquivo privado — o link precisa estar público ("Qualquer pessoa com o link")',

        );

      }

      log(`failed — no CDN URL (title=${titleName ?? '?'})`);

      throw new RpcError(

        RPC_ERROR.INTERNAL,

        'Google Drive: link direto não obtido — confira se o arquivo está público ou abra no navegador',

      );

    }



    const finalName = pickFileName([fileName, titleName], id, titleName);

    log(`ok → ${finalName}`);



    return { directUrl, fileName: finalName, fileSize: null };

  } catch (err) {

    if (err instanceof RpcError) throw err;

    const msg = err instanceof Error ? err.message : String(err);

    log(`error: ${msg}`);

    throw new RpcError(RPC_ERROR.INTERNAL, `Google Drive: ${msg}`);

  } finally {

    await context.close().catch(() => undefined);

  }

}

