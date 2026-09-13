# F95zone requests (rate & volume)

Scope: HTTP to F95zone and SAM (catalog/RSS). There is no global requests-per-hour (RPH) cap; traffic is paced with fixed delays, cache TTLs, and sequential discovery refreshes. Numbers are from current constants — re-check the linked files if behavior drifts.

## Ops summary — what “normal” looks like


| Scenario                         | Approx. F95 / SAM HTTP    | Notes                                                                     |
| -------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Idle, logged in, online          | ~28/h                     | Alerts ~24 F95 GETs/h + RSS ~4 SAM GETs/h. No periodic F95 HEAD.          |
| Idle + store pools cached        | Same as idle              | Discovery TTLs suppress repeat SAM pool fetches (1 h recent / 24 h slow). |
| Library / News bulk update check | ~75 req/min while running | UI uses 800 ms between `gameDetail` calls; not an hourly budget.          |
| Store home cold refresh          | ~37 SAM GETs one-shot     | Sequential pool refresh (“SAM manners”); then Because You may add more.   |


Takeaway: steady-state F95/SAM load is alerts + RSS only (~28/h). F95 reachability is inferred from alerts success/failure (2-strike hysteresis). A F95 HEAD runs only on login bootstrap, OfflineGate/Settings retry, or OS `online`. Bulk update checks and a cold store open are the main intentional bursts.

---

## Background timers


| Feature          | Interval  | Requests per tick                                         | ≈ per hour        | Source                                                           |
| ---------------- | --------- | --------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| F95 alerts popup | 5 min     | 2 GETs (CSRF token + alerts AJAX)                         | ~24 F95           | `src/contexts/Notifications.tsx`, sidecar `domain/f95/alerts.ts` |
| Library RSS poll | 15 min    | 1 SAM RSS GET (+ 0–N `gameDetail` for new matching items) | ~4 SAM + variable | `Notifications.tsx`, `src/lib/rssUpdates.ts`                     |
| Internet probe   | 5 min     | Non-F95 only (`generate_204`)                             | 0 F95             | `Offline.tsx`, `network.rs` (`probeF95: false`)                  |
| F95 HEAD         | On demand | 1 HEAD to `f95zone.to`                                    | ~0 idle           | Login / Retry / browser `online`                                 |


Alerts keep polling when offline reason is `f95` so they can clear that state. They pause for `network` / manual offline. Mount also fires an immediate alerts + RSS refresh when allowed.

---

## Per-action costs


| Operation               | Typical HTTP                  | Notes                                                 |
| ----------------------- | ----------------------------- | ----------------------------------------------------- |
| `samList` (browse)      | 1 GET                         | SAM `latest_data.php`                                 |
| `samList` (search)      | 1–3+ GETs                     | Search-variant loop before merge                      |
| `gameDetail`            | 1 GET                         | F95 thread page                                       |
| Alerts popup            | 2 GETs                        | Token + popup; also drives F95 reachability           |
| RSS feed                | 1 GET                         | SAM RSS                                               |
| Forum search page 1     | 2 (token GET + search POST)   | Extra GET per later page                              |
| Store home cold refresh | Up to ~37 sequential SAM GETs | `recent` 2 pages + 3 slow pools × 5 + 4 tag rails × 5 |
| More like this          | Up to ~9 SAM                  | 3 parallel batches × up to 3 calls                    |


Bulk library update: **N × `gameDetail`**, with 600 ms default delay (`src/lib/updates.ts`) or 800 ms from Library / News UI → ~100/min or ~75/min while the run lasts.

---

## Pacing knobs


| Knob                    | Value                                                 | Effect                                             |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Update-check delay      | 600 ms (lib) / 800 ms (UI)                            | Caps bulk `gameDetail` rate                        |
| Discovery recent TTL    | 1 h                                                   | Avoids re-fetching “recent” pool                   |
| Discovery slow-pool TTL | 24 h                                                  | likes / views / rating / tag rails                 |
| Tag sample rotation     | 30 min                                                | UI rotation only; does not by itself refetch pools |
| Store pool refresh      | Sequential                                            | One pool after another                             |
| Sidecar RPC             | Parallel except `init` / `login` / `logout` / `close` | Session methods serialized                         |
| Game detail prefetch    | max 4 (default)                                       | `gameDetailCache.ts`                               |
| More-like-this SAM      | 3 parallel queries                                    | `moreLikeThisFetch.ts`                             |
| F95 HTTP client timeout | 10 s                                                  | Sidecar `domain/f95/client.ts`                     |
| Alerts → F95-down       | 2 consecutive failures                                | `reportF95Reachability` in `Offline.tsx`           |


There is no app-wide request counter, token bucket, or hourly budget across these sources.

---

## Key file index


| Topic                               | Path                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| Alerts / RSS intervals + F95 report | `src/contexts/Notifications.tsx`                                      |
| Offline / reachability              | `src/contexts/Offline.tsx`                                            |
| Probe implementation                | `src-tauri/src/commands/network.rs`                                   |
| Bulk update delay                   | `src/lib/updates.ts`                                                  |
| Discovery TTLs / page counts        | `src/lib/discoveryConfig.ts`                                          |
| Sequential pool refresh             | `src/lib/discoveryRefresh.ts`, `src/hooks/useStoreDiscovery.ts`       |
| Sidecar concurrency                 | `src-tauri/sidecar/src/main/index.ts`                                 |
| SAM / game HTTP                     | `src-tauri/sidecar/src/domain/sam/client.ts`, `domain/game/client.ts` |
