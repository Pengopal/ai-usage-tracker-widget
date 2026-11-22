# Multi-platform layout and the Android widget

Approved 2026-11-22.

## Intent

AI Usage Tracker started as a Windows desktop widget. The repo now holds more than one app:

- the Windows widget, as it is today;
- an Android app with a home-screen widget that shows remaining usage in the same style as the desktop bar view.

Shared logic lives in one place. Each platform has its own folder and its own docs, so platforms can be developed and released without stepping on each other.

## Goals

- The repo is split into `core/`, `desktop/` and `android/`. The docs follow the same split.
- The code that reads usage from claude.ai, chatgpt.com and grok.com, and turns each response into percentages, exists once, in `core/`, and both apps run it.
- Android home-screen widget, matching the bar view:
  - the provider's logo, name and plan chip;
  - one line per limit: label, "Resets in …", and the percentage on the right;
  - a thin bar under each line, coloured ok/warn/danger at the same thresholds (70 and 90).
- Android app: sign in per provider, show/hide toggles, a plan picker, provider order, and a manual refresh.
- The Android app updates itself from GitHub Releases. It checks for a newer APK, downloads it, and Android asks the user to confirm the install.
- A Play Store build can be added later without the self-updater.

## Non-goals (for this version)

- Threshold, pace or limit-back notifications on Android.
- Syncing usage between the phone and the PC. Each device signs in on its own.
- Publishing to the Play Store.

## Anti-goals

- Tokens or cookies leaving the provider page. As on desktop, the page returns only the parsed numbers.
- A second copy of the site readers or parsers that can drift from the first.
- A desktop update that breaks because the newest GitHub release is Android-only.

## Constraints

- **Updates:** the desktop's electron-updater reads the newest GitHub release. So both platforms share one version number and one release per tag, which carries the `.exe` and the `.apk` together.
- **APK signing:** the APK must always be signed with the same key, or installed copies can't update. The release key lives in GitHub secrets. Without it, CI builds the APK but doesn't attach it to the release.
- **Signing in:** the providers' sign-in pages need a real browser. Android uses a WebView with a persistent cookie store, the same model as the desktop's persistent partitions.

## Approaches considered

1. **One shared JS core, run in the page on both platforms (chosen).**
   - The reader functions and parsers are plain JS. Desktop runs them through `executeJavaScript`; Android loads them into a hidden WebView on the provider's site.
   - The parsed result comes back to Kotlin over a message listener locked to the provider's origin.
   - One implementation, and the tests run once in Node.
2. **Port the parsers to Kotlin and fetch with OkHttp.** Two copies would drift. OkHttp's network fingerprint also differs from Chrome's, so Cloudflare on these sites is likely to challenge it.
3. **React Native or Flutter app.** Home-screen widgets have to be native Android anyway (RemoteViews/Glance), so a cross-platform UI layer adds weight without covering the widget.

## Layout

```
core/                 platform-free JS (CommonJS, no dependencies)
  src/catalog.json    providers, metrics, plans, URLs
  src/providers.js    plan and row logic (buildRows, orderedIds, …)
  src/readers.js      in-page reader functions (fetch on the provider's origin)
  src/interpret.js    reader result -> { connected, windows, plan, detail, error }
  src/parsers.js      raw provider responses -> common shape
  src/insights.js     pace (used by desktop alerts)
  test/               node --test
desktop/              Electron app (was the repo root); copies core/src into src/core at build time
android/              Gradle project, Kotlin, Jetpack Glance widget; copies core/src into assets
docs/                 overview + architecture; docs/desktop/, docs/android/
```

## Android design

- **Sync**
  - A `CoreRunner` loads the provider's home URL in an off-screen WebView and injects the core files, wrapped with a tiny CommonJS shim.
  - It calls the reader, then `interpret()`, and posts the JSON back. Kotlin keeps only the parsed result.
- **Scheduling:** a WorkManager job runs every 15 minutes (Android's minimum) when the network is up. A refresh button on the widget and in the app runs it on demand.
- **Storage:** results and settings are a JSON file in the app's private storage, so the widget can read them without a WebView.
- **Rows:** a small Kotlin port of `buildRows` reads the same `catalog.json`. A shared fixture runs in both the JS and the Kotlin tests, so the two can't drift.
- **Widget:** Jetpack Glance, dark, resizable, with a scrolling list. Tapping it opens the app.
- **Updater:** lives only in the `github` product flavour.
  - Reads the latest release from the GitHub API.
  - Compares versions and downloads the `.apk` asset.
  - Installs through `PackageInstaller`, with the user's confirmation.
- **Play flavour:** the same app without the updater and without the install-packages permission.

## Left to the builder

Library versions, file names inside each platform, test layout, and the exact widget spacing (matched to the desktop bars by eye).
