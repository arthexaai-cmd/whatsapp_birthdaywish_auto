; Extra steps for the NSIS installer/uninstaller (see package.json "nsis.include").
;
; The app creates a Startup-folder shortcut itself (electron/main.js,
; applyRunAtLogin) so it starts at login. The uninstaller only knows about
; files the installer wrote, so remove that shortcut here; otherwise it would
; be left behind pointing at a program that no longer exists.
!macro customUnInstall
  Delete "$SMSTARTUP\Birthday Bot.lnk"
!macroend
