; Kill F95 App + bundled sidecar runtimes before NSIS copies/deletes files.
; Avoids "Error opening file for writing: ...\node.exe" when an orphaned
; sidecar process still holds the Node Foundation binary open.
!macro F95_KILL_BUNDLED_PROCESSES
  DetailPrint "Stopping F95 App and bundled sidecar processes..."
  ; Main app (Tauri also checks this; keep it for upgrades/passive installs)
  nsExec::Exec 'taskkill /F /T /IM f95-app.exe'
  Pop $R0

  ; Only kill node.exe / chrome-headless-shell.exe that live under $INSTDIR —
  ; never every Node process on the machine.
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i("F95_INSTDIR", "$INSTDIR").r0'
  nsExec::ExecToLog '$SYSDIR\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference=\"SilentlyContinue\"; $$inst=$$env:F95_INSTDIR; if (-not $$inst) { exit 0 }; $$nodeTargets=@((Join-Path $$inst \"resources\sidecar\node.exe\"),(Join-Path $$inst \"sidecar\node.exe\")); Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and (($$nodeTargets -contains $$_.ExecutablePath) -or ($$_.ExecutablePath.StartsWith($$inst + \"\\\") -and $$_.Name -eq \"chrome-headless-shell.exe\")) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
  Pop $R0

  ; Give the OS a moment to release file handles before overwrite/delete.
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro F95_KILL_BUNDLED_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro F95_KILL_BUNDLED_PROCESSES
!macroend
