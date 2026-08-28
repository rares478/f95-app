# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From **v1.0.1** onward, each release ships as a new version. Bump these files
together when cutting a release:

- `package.json` / `package-lock.json`
- `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json` (version shown in the app UI)
- `src-tauri/sidecar/package.json` / `src-tauri/sidecar/package-lock.json`

## [Unreleased]

### Added
- Library game detail: Play menu **Install season** when the thread has multiple seasons (opens the install wizard on the season step).
- Library game detail: collapsed Changelog section from the thread OP (heading + outer spoiler).
- Settings → Install locations: expand a library to see installed games by disk usage (largest first) with Uninstall.
- Settings → Install locations: segmented drive usage bar (library / other / free) and per-game share bars.
- Discussion, thread/game OP, and profile posts show non-image file attachments with in-app download to the Downloads folder.
- Click avatar or username in discussions, thread author, forum search, and alerts to open that member's in-app profile.
- Thread-scoped forum search (`?thread=` on Search page; XenForo `c[thread]`) and inline search in discussion views with jump-to-post.
- Forum Search advanced filters: posted by, date range, tags, prefixes, forums, min replies, and title/first-post options.

### Fixed
- In-thread and scoped forum search no longer return hits from other threads (XF expects `constraints` JSON on POST, not bare `c[thread]`).
- Settings → Startup: start with Windows and optional start hidden in tray (enables tray when hidden start is on).
- Store home **Because you…** recommendations after tag panels: up to three daily feature cards from recently played games and weighted tags from recent views (intersection bias + denylist so generic tags do not always win).
- Game detail **More like this** uses the same discovery carousel as the store (chevrons, snap scroll, under-arrow treatment).
- Store cards cycle cover screenshots on hover (rails, capsules, tag tiles, browse, spotlight).
- Discovery rails dim and shrink cards under the nav chevrons and make them unclickable; arrow scrolls snap to card edges.
- Wide store tiles load fuller-resolution images when the card is large enough.
- Single-instance app: a second launch focuses the existing window.

### Changed
- Removed the top **For You** carousels (Recently viewed / Because you play); personalization lives in Because you… instead.
- Store home layout polish: fuller-bleed home column, hover meta pop-out, and tag sampling that avoids repeating the same games across panels.
- App repo and updater target `rares478/f95-app`.

### Fixed
- Post attachments parse CDN links (`attachments.f95zone.to`) so zip/mod files show and download; after download, Open reveals the file in Explorer (including paths with spaces).
- Because you…: no link underline on hover; hovering a screenshot previews it in the large cover; warm pack no longer flickers empty on reload; an empty rebuild does not wipe a good same-day cache.
- Spotlight uses cover art with hover screenshot cycling; version/meta sit above screenshot dots; removed the redundant View details CTA.
- Popular Liked/Viewed/Rated tabs restore a full hit area.
- Tray custom menu opens on the first right-click.
- Downloads finish writing files before extract; extract jobs can be cancelled.
- Game detail screenshots are taken only from the download block.
- Spotlight full-resolution helper export for cover images.

## [1.7.6] - 2026-08-17

### Added
- Wolf RPG Editor Save Editor: decrypt and edit VariableDatabase in `SaveData*.sav` files, with discovery, backups, extra folders, and engine gating.
- Library filters for engines, thread status, prefixes, and searchable tags, persisted in the URL.
- Settings grouped panel navigation with URL deep links.
- Store tags are saved when installing or adding a game to the library.
- Per-library folder disk usage in Settings.
- Warn on startup when installed-and-played library games appear on the F95 community malware list.
- Downloads cards with a live speed graph.

### Fixed
- Tauri dev builds use a separate SQLite file so experimental migrations do not break the installed release database.
- BuzzHeavier downloads work for `bzzhr.to` mirrors, not only `bzzhr.co`.
- Extract destination uses the archive name; extract jobs no longer hang at 100% from stale list reloads.
- Store tags on the game details page are vertically centered in their pills.

## [1.7.5] - 2026-08-17

### Added
- Unity Save Editor: discover saves under `%LocalLow%` and the game install, edit values in a tree with automatic backups.
- Unity format support: Easy Save 3 (AES), plain and XOR-encrypted JSON, XML, Odin binary, Adventure Creator, .NET NRBF (BinaryFormatter), VNGINE, and Mystwood Manor encrypted profile saves.
- Attach extra save folders manually when saves live outside the usual paths (Ren'Py, RPG Maker, and Unity).
- Unity multi-install picker when several copies of the same game are on disk.
- Encrypted Unity saves: password unlock in the editor; Easy Save 3 can auto-unlock from `ES3Defaults` when the game ships it.

### Fixed
- Ren'Py: Depths Revival-style labeled slots (`1-1-LT1.save`) and pickle parsing for complex dict/globals.
- Ren'Py: only list zip-shaped `.save` files; skip zlib `persistent` blobs the editor cannot open yet.
- Unity: list and unlock XOR-encrypted `save_*.json` files.
- Unity: separate LocalLow vs install scan budgets so install-folder saves are not dropped on busy machines.
- Save Editor no longer blocks while game detail metadata is prefetching.
- MediaFire download links parse correctly regardless of HTML attribute order on the button tag.
- Turnstile-protected hosts use API-only or in-browser flow as appropriate; clearer MEGA HTTP 509 errors.
- App exits cleanly when choosing tray Quit or when the system tray is disabled.

## [1.7.4] - 2026-08-15

### Added
- Ren'Py Save Editor: browse and surgically edit save variables from Library game detail.
- RPG Maker MV/MZ Save Editor: list `.rpgsave` slots, LZ-String decode/encode, and primitive patches with backups.
- Curated RPG Maker tabs (Party, Inventory, Actors, Switches, Variables) plus Raw tree; `System.json` switch/variable names and item DB labels when available.

### Fixed
- Login no longer hangs forever on "Loading session…" (network/session probe timeouts + clearer auth bootstrap logs).
- Store spotlight and tag panels use full-resolution images via `attachments.f95zone.to` (SAM `preview.*` CDN was showing soft/downscaled art).
- Store rails / Up next keep lightweight preview covers instead of inventing broken `/thumb/` URLs.
- Settings → Maintenance → Store cache now also clears discovery pools so the Store home actually refreshes on the next visit.

## [1.7.3] - 2026-08-12

### Added
- Library collections with folders, collection pages, and a collection picker.
- Auto-update from GitHub Releases, with a Settings toggle to disable automatic checks.
- In-app changelog for app versions under Settings → System.
- System tray icon with show/quit actions and a Settings toggle (close hides to tray when enabled).
- App skins (Default and Steam) with a Steam color theme and Steam-style library layout.
- Top navigation layout option for the default skin.
- In-app friend/member profiles from the Friends page.
- Improved store search with relevance ranking and better tag filtering.
- Extraction preflight disk-space checks and clearer unrar errors.

### Changed
- Renamed the Search nav item to Forum across all locales.

### Fixed
- Steam skin library scroll: game detail and sidebar now scroll independently.
- Steam skin top nav now includes the Forum link.

## [1.7.2] - 2026-08-10

### Improved
- Deep-link forum search hits to the exact post page.
- Open F95 thread links from post HTML in-app.

## [1.0.1] - 2026-08-05

### Improved
- Store search is more Google-like: query normalization, progressive token
  fallbacks when the exact phrase returns nothing, and relevance ranking.
- Library search matches all query tokens and also searches custom tags.

### Fixed
- Tag autocomplete now handles SAM responses that return bare tag IDs.
- Tag suggestions fall back to the local catalog when the remote search fails.
- Tag catalog is persisted locally and refreshed more aggressively so pills
  stop showing raw `#id` placeholders.
- Default tag filter mode is OR (less restrictive when combining tags).

## [1.0.0] - 2026-08-05

### Added
- Initial public release of the F95 App desktop client.
