Drop official 7-Zip CLI binaries in this folder for bundling:

- `7z.exe` (or `7za.exe`)
- `7z.dll` (or `7za.dll`)
- `License.txt` (from 7-Zip distribution)

The app will prefer this bundled binary at runtime, then fall back to a system
7-Zip installation, then to Rust extractors.
