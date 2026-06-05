// Pack the sidecar for redistribution WITHOUT touching the Node binary.
//
// Earlier versions used Node SEA (Single Executable Application) via
// `postject` — that produces a single .exe but rewrites node.exe's contents
// and signature, which trips Windows Defender's ML heuristics (`Trojan:
// Win32/Bearfoos.B!ml` and friends) on end-user machines. The fix is to
// stop modifying the runtime: ship the *original* signed node.exe alongside
// the JS bundle. Same end-user footprint, no false positives, no signing
// required for the sidecar.
//
// Flow:
//   1. Ensure `dist/bundle.cjs` exists (run `build:bundle` if not).
//   2. Copy the current `node.exe` (process.execPath) → `dist/node.exe`.
//   3. Done. Tauri ships both files as bundle resources; bridge.rs spawns
//      `<resources>/sidecar/node.exe <resources>/sidecar/bundle.cjs`.

import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function prunePlaywrightArtifacts(root) {
  execSync('node scripts/prune-playwright-artifacts.mjs', {
    cwd: root,
    stdio: 'inherit',
  });
}

/** Stop Playwright headless-shell processes (Playwright-specific binary name). */
function stopBundledChromiumProcesses() {
  if (process.platform !== 'win32') return;
  try {
    execSync('taskkill /F /IM chrome-headless-shell.exe /T', { stdio: 'ignore' });
    log('stopped chrome-headless-shell.exe (if running)');
  } catch {
    // none running
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

function log(...args) {
  console.log('[sidecar-runtime]', ...args);
}

// ── 1. Bundle the sidecar ───────────────────────────────────────────────────
const bundlePath = resolve(distDir, 'bundle.cjs');
if (!existsSync(bundlePath)) {
  log('bundle.cjs missing — running build:bundle first');
  execSync('npm run build:bundle', { cwd: root, stdio: 'inherit' });
}

// ── 2. Copy node.exe ────────────────────────────────────────────────────────
const nodeExe = process.execPath;
const targetExe = resolve(distDir, 'node.exe');
log(`copying ${nodeExe} → ${targetExe}`);
copyFileSync(nodeExe, targetExe);
const nodeSize = (statSync(targetExe).size / 1024 / 1024).toFixed(1);
log(`node.exe: ${nodeSize} MB (UNMODIFIED — Node Foundation signature intact)`);

// ── 3. Ship playwright runtime (esbuild marks it external) ─────────────────
const pwModulesDir = resolve(distDir, 'node_modules');
mkdirSync(pwModulesDir, { recursive: true });
for (const pkg of ['playwright', 'playwright-core']) {
  const src = resolve(root, 'node_modules', pkg);
  if (!existsSync(src)) {
    throw new Error(`${pkg} not found — run npm install in src-tauri/sidecar first`);
  }
  const dest = resolve(pwModulesDir, pkg);
  log(`copying ${pkg} → dist/node_modules/${pkg}`);
  cpSync(src, dest, { recursive: true });
}

// ── 4. Ship chromium browser binary (full Chromium only; no headless shell) ─
const browsersPath = resolve(distDir, 'ms-playwright');
if (existsSync(browsersPath)) {
  stopBundledChromiumProcesses();
  log('removing previous dist/ms-playwright');
  rmSync(browsersPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}
mkdirSync(browsersPath, { recursive: true });
log('installing chromium (--no-shell) → dist/ms-playwright');
execSync('npx playwright install chromium --no-shell', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
});
prunePlaywrightArtifacts(root);

// ── 5. Clean up legacy SEA artefacts so they don't ship by accident ────────
for (const stale of ['f95-bridge.exe', 'sea-config.json', 'sea-prep.blob']) {
  const p = resolve(distDir, stale);
  if (existsSync(p)) {
    unlinkSync(p);
    log(`removed stale ${stale}`);
  }
}

log('done. Tauri will bundle bundle.cjs + node.exe + playwright as resources.');
