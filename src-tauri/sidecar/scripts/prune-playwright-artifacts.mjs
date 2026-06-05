// Remove ephemeral Playwright/Chromium files that must not ship in the installer.
// Also drops chromium_headless_shell (bundle uses full Chromium via channel: 'chromium').

import { execSync } from 'node:child_process';
import { existsSync, globSync, rmSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function stopBundledChromiumProcesses() {
  if (process.platform !== 'win32') return;
  try {
    execSync('taskkill /F /IM chrome-headless-shell.exe /T', { stdio: 'ignore' });
  } catch {
    // none running
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const browsersPath = resolve(__dirname, '..', 'dist', 'ms-playwright');

function log(...args) {
  console.log('[sidecar-prune]', ...args);
}

function warn(...args) {
  console.warn('[sidecar-prune]', ...args);
}

if (!existsSync(browsersPath)) {
  log('ms-playwright missing — skipping');
  process.exit(0);
}

stopBundledChromiumProcesses();

for (const dir of globSync('chromium_headless_shell-*', { cwd: browsersPath })) {
  const full = resolve(browsersPath, dir);
  try {
    rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    log('removed', dir);
  } catch (err) {
    warn(`could not remove ${dir}:`, err.message);
  }
}

let removedLogs = 0;
for (const rel of globSync('**/*.log', { cwd: browsersPath, posix: true })) {
  const full = resolve(browsersPath, rel);
  try {
    unlinkSync(full);
    removedLogs += 1;
    log('removed', rel);
  } catch (err) {
    warn(`could not remove ${rel}:`, err.message);
  }
}

log(`done (${removedLogs} log file(s) removed)`);
