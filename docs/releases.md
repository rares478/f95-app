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
