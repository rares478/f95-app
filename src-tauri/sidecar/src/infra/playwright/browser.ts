import type { Browser } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let sharedBrowser: Browser | null = null;

/** Prefer an existing Chromium cache; avoid empty dirs that break launches. */
function ensurePlaywrightBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    if (playwrightBrowsersReady(process.env.PLAYWRIGHT_BROWSERS_PATH)) return;
    // Env pointed at an empty/stale folder — fall through to a real cache.
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(base, 'f95-app', 'ms-playwright'),
    path.join(base, 'ms-playwright'),
  ];
  for (const dir of candidates) {
    if (playwrightBrowsersReady(dir)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
      return;
    }
  }
  // Default install target for `npx playwright install` in this app.
  process.env.PLAYWRIGHT_BROWSERS_PATH = candidates[0];
}

function playwrightBrowsersReady(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((name) => name.startsWith('chromium-'));
  } catch {
    return false;
  }
}

export async function getPlaywrightBrowser(): Promise<Browser> {
  ensurePlaywrightBrowsersPath();
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    const { chromium } = await import('playwright');
    sharedBrowser = await chromium.launch({
      channel: 'chromium',
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--log-level=3',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return sharedBrowser;
}

export async function closePlaywrightBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

/** Headed Chromium for captcha / interactive host flows (separate from shared headless). */
export async function launchInteractiveBrowser(): Promise<Browser> {
  ensurePlaywrightBrowsersPath();
  const { chromium } = await import('playwright');
  return chromium.launch({
    channel: 'chromium',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--log-level=3',
      '--disable-dev-shm-usage',
      '--disable-popup-blocking',
    ],
  });
}
