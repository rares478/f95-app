# Releases

## Updater signing keys

Generate once (do not commit the private key):

```bash
# Prefer no password so CI does not need TAURI_SIGNING_PRIVATE_KEY_PASSWORD
npm run tauri signer generate -- -w ~/.tauri/f95-app.key --ci
```

- Put the **public** key contents into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- Store only the private key as a GitHub Actions secret:
  - `TAURI_SIGNING_PRIVATE_KEY` — full file contents of the private key
- **Do not** create `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unless you generated the key with a real password. GitHub cannot store an empty secret; a space/placeholder will fail with “Wrong password for that key”.

## Release procedure

### 1. Bump version

Update the same version in all three places:

- `package.json`
- `src-tauri/tauri.conf.json` (`version`)
- `src-tauri/Cargo.toml` (`package.version`)

### 2. Commit and tag

```bash
git commit -am "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin HEAD
git push origin vX.Y.Z
```

Pushing a `v*.*.*` tag starts `.github/workflows/release.yml`. You can also run the workflow manually via **Actions → release → Run workflow**, but you must pass a `tag` input (`vX.Y.Z`). Manual runs never use the branch name as the release tag; the job fails early if the tag is missing or not `v*.*.*`.

### 3. Required GitHub secrets

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Private key for updater artifact signatures |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Only if the key was generated with a password (omit otherwise) |

`GITHUB_TOKEN` is provided by Actions. Repo **Settings → Actions → General → Workflow permissions** must allow **Read and write** so the job can create draft releases and upload assets.

Tag builds restore the Windows Rust cache from `main`. That cache is warmed by `.github/workflows/rust-cache-warm.yml` (pushes to `main` that touch `src-tauri`, or **Actions → rust-cache-warm → Run workflow**). Both workflows use `shared-key: windows-tauri`.

### 4. Publish the draft release

The workflow creates a **draft** GitHub Release with Windows installers and updater artifacts. After CI finishes, review the assets, then publish the draft in the GitHub UI.

### 5. Verify `latest.json`

Confirm the release includes `latest.json` and that it is reachable at the configured updater endpoint. The workflow sets `updaterJsonPreferNsis: true` so Windows updates prefer NSIS over MSI when both are built:

`https://github.com/rares478/f95-app/releases/latest/download/latest.json`

(`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`)

### 6. Sidecar `browser-rest-api` alignment

Locally, `src-tauri/sidecar/package.json` depends on `browser-rest-api` via `file:../../../browser-api`. The release workflow rewrites that dependency to `^1.0.0` (published npm) before install, matching the root app. Keep the published package version compatible with what the sidecar expects before cutting a release.
