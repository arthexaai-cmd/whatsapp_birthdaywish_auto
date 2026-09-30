# Releasing and updating

The app updates itself from **GitHub Releases** of
`arthexaai-cmd/whatsapp_birthdaywish_auto` (public). The installer is built by
GitHub Actions, never on a user's machine, and an installed app only ever
*downloads a finished installer*.

```
you: npm version minor + git push --follow-tags
  -> GitHub Actions (release.yml): npm ci, npm test, tag == package.json version?, build, publish Release
  -> installed app: checks Releases on launch and every 6 h, shows "Version X available"
  -> you click Download, then Install and restart (only when it is safe)
```

## Making a release
1. Commit and push your changes to `main`. `ci.yml` runs the tests on every push.
2. Bump the version and tag it in one step (this edits `package.json`, commits, and creates the tag):
   ```bash
   npm version minor      # 2.0.0 -> 2.1.0   (use "patch" for a small fix: 2.1.0 -> 2.1.1)
   git push --follow-tags
   ```
3. Watch **GitHub → Actions → Release**. When it is green, the Release exists with
   `Birthday-Bot-Setup-<version>.exe`, its `.blockmap`, and `latest.yml`.
4. Installed apps find it within a few hours (or straight away via **Settings → Updates → Check now**
   or the tray's **Check for updates**).

The workflow **refuses to publish** if the tests fail or if the tag doesn't equal `v<package.json version>`
(`scripts/release-check.mjs`), so a mistyped tag can't ship a mislabelled installer.

## What the app does (and never does)
- Checks automatically unless **Settings → Updates → Check automatically** is off. **It never downloads or installs by itself.**
- **Install and restart is refused** while messages are being sent, and in Automatic mode when the daily
  send is due within 30 minutes (`src/core/updatePolicy.js`), with the reason shown.
- Your data (contacts, history, WhatsApp session) lives in `%APPDATA%\Birthday Bot` and is untouched; the
  database migrates itself on the next start.

## First release
- The 2.0.0 install has no updater. **Install the first updater-enabled version (2.1.0) by hand once**
  (`Birthday-Bot-Setup-2.1.0.exe` from the Release); every update after that is in-app.
- The first `git push` also uploads the local commits that are not on GitHub yet.
- Windows SmartScreen warns on a manual install of an unsigned installer ("More info → Run anyway").
  Updates downloaded by the app are verified by hash. A code-signing certificate removes the warning.

## Rolling back
The updater never downgrades. To roll back, revert the bad change on `main` and release a **higher** version
(for example 2.1.2 containing 2.1.0's code). If a release is broken and not yet installed anywhere, delete it
on the Releases page; installed apps then keep their current version.

## Security notes
- **Anyone who can push tags to the repo can ship code to every install.** Use two-factor authentication on
  the GitHub account and consider protecting `v*` tags (Settings → Tags → New rule).
- No token is stored in the app. It reads the public Release over HTTPS and checks the SHA-512 of the
  installer against `latest.yml` before installing.

## Testing the update flow without GitHub
Build a "newer" version and a "current" version, serve the newer one, and point the current one at it. The
feed override only works when `BIRTHDAY_BOT_USER_DATA` is also set (test mode):
```bash
npx electron-builder --config.extraMetadata.version=2.1.1 --config.directories.output=dist-update-test
cp "dist-update-test/Birthday Bot Setup 2.1.1.exe" "dist-update-test/Birthday-Bot-Setup-2.1.1.exe"   # names in latest.yml use hyphens
# serve dist-update-test on http://127.0.0.1:8099 (any static server), then:
npx electron-builder --config.extraMetadata.version=2.1.0
BIRTHDAY_BOT_USER_DATA=D:\bb-test-data BIRTHDAY_BOT_UPDATE_URL=http://127.0.0.1:8099 "dist-installer\win-unpacked\Birthday Bot.exe"
```
Do not press **Install and restart** in an unpacked test build: it would run the installer over a real install.
