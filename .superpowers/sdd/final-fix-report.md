# Final branch review — Important findings fixed

**Branch:** `feature/rpgm-save-editor`  
**Date:** 2026-08-15

## Fixes

### 1. Missing saves dir → empty list
- **Change:** `list_slots` in `src-tauri/src/save_editor/rpgm/discover.rs` returns `Ok(vec![])` when the path is missing or not a directory (before `read_dir`).
- **Tests:** `list_slots_missing_dir_returns_empty`, `list_for_install_missing_save_dir_returns_empty` (MV marker without `www/save`).

### 2. RPGM slot kind badges
- **Change:** `SaveSlotList.tsx` `kindKey` maps `file` / `global` / `config`.
- **Locales:** `saveEditor.kind.file|global|config` added in `en` / `de` / `pt` / `ru`.

### 3. Probe hang
- **Change:** `saveEditorGate.ts` `resolveFromProbes` uses `Promise.allSettled` so one rejected probe does not fail both.
- **Change:** `SaveEditor.tsx` engine resolve effect always reaches `setEngineReady(true)` via `.finally()`; rejections surface via `setSlotsError`.
- **Tests:** gate Vitest cases for one probe reject and both probes reject (tag fallback).

## Verification

```text
cargo test --lib save_editor::rpgm::
→ 18 passed

npx vitest run src/lib/saveEditorGate.test.ts src/lib/storeEngine.test.ts
→ 20 passed (11 gate + 9 storeEngine)
```

## Commits

See git log for the focused fix commit(s) on this branch after this report.
