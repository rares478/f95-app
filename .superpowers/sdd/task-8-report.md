# Task 8 Report: Wire SaveEditor UI + locales

## Status
**Done** (manual Natsuki check pending)

## Commits
- `d49cbd6` `feat(save-editor): use rpgm IPC from shared Save Editor UI`
- `91f857b` `fix(save-editor): cancel in-flight loads when engine re-resolves`
- `0e2326d` `fix(save-editor): return cleanup when installPath is missing`
- `b087cb3` `fix(save-editor): ignore stale loadSlots after engine re-resolve`

## What shipped
- `SaveEditor` resolves `resolveSaveEditorEngine` once on mount / when `installPath` (plus `installStatus` / `storeTags`) changes
- List / read / write / backups list / restore dispatch to `renpy*` or `rpgm*` IPC from `engine`
- Softened empty/error copy in en/de/pt/ru (no Ren'Py-specific empty/parse strings)
- Engine re-resolve bumps tree generation, clears UI state, and cancels stale resolve results

## Tests / checks
```
npm run test:unit -- src/lib/saveEditorGate.test.ts src/lib/storeEngine.test.ts
```
18 passed.

```
npx tsc --noEmit -p tsconfig.json
```
exit 0.

## Manual check (pending)
Open Natsuki install → editor visible → slots → edit `party._gold` → reload game — not run in this session (no game install available to the agent).

## Concerns
- No dedicated SaveEditor unit/component tests for the IPC branch; coverage is gate tests + typecheck.
- `storeTags` array identity can re-trigger resolve if the parent recreates the array each render.

## Review fix: stale `loadSlots` after engine re-resolve
**Finding:** `loadSlots` applied `setSlots` / cleared loading without checking `treeLoadGenRef`, so an in-flight list from a prior engine could overwrite after re-resolve.

**Fix:** Capture `treeLoadGenRef.current` at the start of the async list path; ignore success/error/finally state updates when the generation no longer matches (same pattern as `loadTree`). Missing-`installPath` resolve-effect cleanup from `0e2326d` left intact.

**Evidence:**
```
npx vitest run src/lib/saveEditorGate.test.ts src/lib/storeEngine.test.ts
```
18 passed (2 files).

