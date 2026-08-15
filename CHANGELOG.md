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

## [1.7.4] - 2026-08-15

### Added
- Ren'Py Save Editor: browse and surgically edit save variables from Library game detail.
- RPG Maker MV/MZ Save Editor: list `.rpgsave` slots, LZ-String decode/encode, and primitive patches with backups.
- Curated RPG Maker tabs (Party, Inventory, Actors, Switches, Variables) plus Raw tree; `System.json` switch/variable names and item DB labels when available.

### Fixed
- Ren'Py 7/8 edits no longer break loads (pickle splice, FRAME sizes, drop stale zip signatures).
- RPG Maker JsonEx `@a` array wrappers for actors, switches, variables, and party members.
- Actors tab layout for dense modded saves: core stats plus searchable, collapsible extras.

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
