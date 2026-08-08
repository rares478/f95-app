# Releases

## Updater signing keys

Generate once (do not commit the private key):

```bash
npm run tauri signer generate -- -w ~/.tauri/f95-app.key
```

- Put the **public** key contents into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- Store the **private** key (and password if any) as GitHub Actions secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string secret if none)

Replace the Task 1 placeholder pubkey before relying on signed in-app updates.

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

Pushing a `v*.*.*` tag starts `.github/workflows/release.yml`. You can also run the workflow manually via **Actions → release → Run workflow**.

### 3. Required GitHub secrets

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Private key for updater artifact signatures |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password (use an empty string secret if none) |

`GITHUB_TOKEN` is provided by Actions. Repo **Settings → Actions → General → Workflow permissions** must allow **Read and write** so the job can create draft releases and upload assets.

### 4. Publish the draft release

The workflow creates a **draft** GitHub Release with Windows installers and updater artifacts. After CI finishes, review the assets, then publish the draft in the GitHub UI.

### 5. Verify `latest.json`

Confirm the release includes `latest.json` and that it is reachable at the configured updater endpoint:

`https://github.com/rares478/f95-app/releases/latest/download/latest.json`

(`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`)

### 6. Sidecar `browser-rest-api` alignment

Locally, `src-tauri/sidecar/package.json` depends on `browser-rest-api` via `file:../../../browser-api`. The release workflow rewrites that dependency to `^1.0.0` (published npm) before install, matching the root app. Keep the published package version compatible with what the sidecar expects before cutting a release.
