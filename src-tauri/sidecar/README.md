# Sidecar build (dev vs prod)

## Dev (`tauri dev`)

1. `npm --prefix src-tauri/sidecar run build` — compila TypeScript → `dist/index.js`
2. Tauri spawns `node dist/index.js` (ver `sidecar/path.rs`)

Após alterar código do sidecar, rode `npm run build` no diretório `sidecar/` antes de testar no app.

Em `tauri dev`, o Playwright escreve logs em `ms-playwright/` — isso está listado em `src-tauri/.taurignore` para não reiniciar o app a cada download.

## Prod (release bundle)

O `beforeBuildCommand` em `tauri.conf.json` encadeia:

1. `npm run build` (frontend)
2. `npm --prefix src-tauri/sidecar run build` (tsc)
3. `build:bundle` (esbuild → `dist/bundle.cjs`)
4. `build:sea` (copia `node.exe`, Playwright, Chromium)

Tauri empacota `bundle.cjs` + `node.exe` + browsers.

## Testes

```bash
npm --prefix src-tauri/sidecar test
```

## Entry point

- **Runtime:** `src/main/index.ts` (via `src/index.ts`)
- **Handlers:** `src/rpc/handlers/*` registrados em `src/rpc/registry.ts`
