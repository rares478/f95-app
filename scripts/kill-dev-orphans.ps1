# Kill orphaned F95 sidecar Node processes and clear stuck Rust incremental
# "*-working" dirs left behind by Ctrl+C mid-compile (Access is denied / os error 5).
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$sidecarNeedles = @(
    (Join-Path $root "src-tauri\sidecar\dist\index.js"),
    (Join-Path $root "src-tauri\sidecar\dist\bundle.cjs"),
    "sidecar\dist\index.js",
    "sidecar\dist\bundle.cjs"
) | ForEach-Object { $_.ToLowerInvariant().Replace("/", "\") }

$killed = 0
Get-CimInstance Win32_Process | ForEach-Object {
    if ($_.Name -ne "node.exe" -or -not $_.CommandLine) { return }
    $cmd = $_.CommandLine.ToLowerInvariant().Replace("/", "\")
    $match = $false
    foreach ($n in $sidecarNeedles) {
        if ($cmd.Contains($n)) { $match = $true; break }
    }
    if (-not $match) { return }
    Write-Host "Killing orphaned sidecar PID $($_.ProcessId)"
    & taskkill.exe /F /T /PID $_.ProcessId | Out-Null
    $script:killed++
}

$pwCache = Join-Path $env:LOCALAPPDATA "f95-app\ms-playwright"
$sidecarRoot = Join-Path $root "src-tauri\sidecar"
Get-CimInstance Win32_Process | ForEach-Object {
    if ($_.Name -ne "chrome-headless-shell.exe" -or -not $_.ExecutablePath) { return }
    $path = $_.ExecutablePath
    $underSidecar = $path.StartsWith($sidecarRoot, [StringComparison]::OrdinalIgnoreCase)
    $underCache = $pwCache -and $path.StartsWith($pwCache, [StringComparison]::OrdinalIgnoreCase)
    if (-not ($underSidecar -or $underCache)) { return }
    Write-Host "Killing orphaned Playwright PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
    $script:killed++
}

$inc = Join-Path $root "src-tauri\target\debug\incremental"
if (Test-Path $inc) {
    Get-ChildItem $inc -Directory -Filter "*-working" -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "Removing stuck incremental session $($_.Name)"
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
}

Write-Host "Done. Processes signaled: $killed"
