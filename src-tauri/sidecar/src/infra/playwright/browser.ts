import type { Browser } from 'playwright';
import os from 'node:os';
import path from 'node:path';

let sharedBrowser: Browser | null = null;

/** Dev: cache browsers under %LOCALAPPDATA%/f95-app so Chromium logs don't touch src-tauri. */
function ensurePlaywrightBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(base, 'f95-app', 'ms-playwright');
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
