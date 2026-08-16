# Unity / Easy Save 3 fixtures

Test password for encrypted fixtures: `f95-test-password`

| File | Description |
|------|-------------|
| `sample.json` | Plain JSON object (generic Unity JSON save). |
| `unencrypted.es3` | Plain UTF-8 JSON object (ES3-style `__type` wrapper). |
| `encrypted.es3` | Same JSON encrypted with Moodkie ES3 layout: AES-128-CBC, PBKDF2-HMAC-SHA1 (100 iterations, 16-byte key), IV prefix (also used as PBKDF2 salt). |

Decrypt with the password above; wrong passwords must fail without writing corrupt bytes.
