# Multi-platform + Android Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the repo into `core/`, `desktop/` and `android/`, and ship an Android app whose home-screen widget shows usage in the desktop bar style.

**Architecture:**
- `core/` is dependency-free CommonJS: the catalog, readers, interpret, parsers, rows and pace.
- At build time each platform copies `core/src` in: desktop into `desktop/src/core`, Android into its assets.
- Android runs the readers and `interpret` inside an off-screen WebView on the provider's origin, and gets back only the parsed JSON.

**Tech Stack:**
- Desktop: Node 22, Electron, electron-builder.
- Android build: Gradle 8.14.3, AGP 8.13.1, Kotlin 2.2.20.
- Android libraries: Compose (BOM), Jetpack Glance 1.1.x, WorkManager, androidx.webkit, org.json.
- SDK levels: compileSdk/targetSdk 36, minSdk 26.

**Spec:** `docs/design/2026-11-22-multi-platform-android.md`

## Global Constraints

- One version for both platforms. Each `v*` tag makes one GitHub release with the `.exe`, `latest.yml` and the `.apk`. The version is **1.3.0** for this change.
- Version sources:
  - `desktop/package.json` `version`;
  - `android/gradle.properties` `appVersion`.
  
  The release workflow fails if either differs from the tag. `versionCode` = major*10000 + minor*100 + patch.
- Tokens and cookies never leave the provider page. Android's message listener is restricted to the provider's origin.
- Colour thresholds: warn ≥ 70, danger ≥ 90. Colours:
  - bg `#0E0E12`, raise `#17171D`, track `#23232B`;
  - text `#ECECF1`, muted `#A3A3AE`, faint `#80808C`;
  - ok `#5FAE84`, warn `#D9944F`, danger `#DD6663`, accent `#6AA8FF`.
- Product flavours `github` (has the updater and `REQUEST_INSTALL_PACKAGES`) and `play` (has neither).
- Application id `com.pengopal.aiusagetracker`.
- The APK is only attached to the release when the keystore secrets exist:
  - `ANDROID_KEYSTORE_BASE64`
  - `ANDROID_KEYSTORE_PASSWORD`
  - `ANDROID_KEY_ALIAS`
  - `ANDROID_KEY_PASSWORD`

## Review Focus

1. **Provider site shows a Cloudflare or interstitial page:** the reader returns `{auth:false}` or an error. The widget must show "Sign in" or the last good numbers, never crash. *Test:* `interpret` with `{auth:false}` and with a thrown error.
2. **A newer release has no `.apk` asset** (keystore not configured): the updater reports "up to date / no Android build", not a broken download. *Test:* `UpdateCheckTest.noApkAsset`.
3. **Version compare** of `1.10.0` vs `1.9.0`, and `v`-prefixed tags. *Test:* `UpdateCheckTest.compare`.
4. **Hidden providers and stale order ids** in Android settings: rows follow the same rules as desktop. *Test:* shared `core/test/fixtures/rows-cases.json`, run by both the JS and Kotlin tests.
5. **Widget before any sync / never signed in:** the widget renders an empty state ("Open the app to sign in") instead of a blank box. *Covered by:* the emulator screenshot check in Task 7.

---

### Task 1: core package

**Files:**
- Create:
  - `core/package.json` (`name: "@ai-usage-tracker/core"`, private, `test: node --test "test/*.test.js"`)
  - `core/src/catalog.json`
  - `core/src/readers.js`
  - `core/src/interpret.js`
  - `core/test/fixtures/rows-cases.json`
  - `core/test/readers.test.js`
  - `core/test/interpret.test.js`
- Move:
  - `src/parsers.js`, `src/providers.js`, `src/insights.js` → `core/src/`
  - `test/{parsers,providers,insights}.test.js` → `core/test/`

**Interfaces:**
- **Produces:**
  - `catalog.json`: `{ [id]: { name, logo, url, home, loginUrl, metrics, plans } }`, holding today's `CATALOG` plus `home` and `loginUrl` from `sync.js`.
  - `providers.js` loads `CATALOG` from `./catalog.json`, with the same exports as today.
  - `readers.js` exports `{ claude(), openai(), grok(model) }`.
    - These are async functions that run in the page. They are self-contained, with no closures over module scope, so `fn.toString()` works.
    - The bodies come from `CLAUDE_JS`, `OPENAI_JS` and `grokJs`.
  - `interpret.js` exports `interpret(id, res, now) -> { connected, windows?, plan?, detail?, error? }`.
    - This is the logic currently in `Service.read`, minus `raw`.
    - The parsers are picked by id.
- `rows-cases.json` is an array of `{ name, services, providerSettings, order, expect: [{ id, plan, metrics: [label] }] }`.

- [ ] **Step 1:** Write the failing tests.
  - `interpret('claude', {auth:false})` deep-equals `{connected:false}`.
  - `interpret('grok', {auth:true, error:'x'})` deep-equals `{connected:true, error:'x'}`.
  - A Claude usage body gives `windows.session.pct`.
  - `readers.claude.toString()` contains no `require(`.
  - `providers.test.js` loads `fixtures/rows-cases.json`. For each case, `buildRows` gives the ids, plans and labels in `expect`. Copy at least the max20, hidden and order cases from the current tests.
- [ ] **Step 2:** Run `cd core && npm test`. Expected: FAIL, because `interpret.js` and `readers.js` are missing.
- [ ] **Step 3:** Implement `catalog.json`, `readers.js` and `interpret.js`. Point `providers.js` at the catalog.
- [ ] **Step 4:** Run `cd core && npm test`. Expected: all pass.

### Task 2: desktop/ moves onto core

**Files:**
- Move: `src/`, `test/`, `package.json`, `package-lock.json` → `desktop/`
- Create: `desktop/scripts/copy-core.js`, which copies `../core/src` to `src/core` (wiping it first)
- Modify:
  - `desktop/src/sync.js`: scripts come from `readers` via `` `(${fn})(${JSON.stringify(arg)})` ``, and the parse from `interpret`.
  - `main.js`, `store.js`: require `./core/...`
  - `desktop/test/store.test.js`
  - `desktop/package.json`: `prestart`, `pretest`, `prebuild*` and `prerelease` run `copy-core`. `build.files` includes `src/**/*`.
  - `.gitignore`: add `desktop/src/core/`, `android/**/build/`, `android/.gradle/`, `android/local.properties` and `*.keystore`.

- [ ] **Step 1:** Run `cd desktop && npm test`. Expected: store tests pass, and requires resolve through the copied core.
- [ ] **Step 2:** Re-run the screenshot harness against `desktop/src/main.js`. Expected: bars render as before.

### Task 3: Android project, core runner, rows port

**Files:**
- Create the Gradle project files:
  - `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties` (`appVersion=1.3.0`)
  - `android/gradle/wrapper/*`, `android/gradlew*`
  - `android/app/build.gradle.kts`
  
  The app build has the flavours `github` and `play`, plus a `copyCore` task (`../../core/src` → `build/generated/coreAssets/core`) registered as an assets source dir.
- Create the core runner and rows port in `app/src/main/java/com/pengopal/aiusagetracker/`:
  - `core/CoreScripts.kt`: reads the asset files; `bundle(): String` wraps each file in a CommonJS shim, with `require` mapping `./x` to the loaded modules and `.json` to parsed JSON.
  - `core/Catalog.kt`: data classes read from `catalog.json`.
  - `core/Rows.kt`: `buildRows(services, settings, catalog): List<Row>` and `orderedIds`.
  - `data/Models.kt`: `Window(pct, reset)`, `Service(...)`, `ProviderSetting(enabled, plan)`, `Settings(order, providers)`, `Row`, `Metric`.
- Test: `app/src/test/java/.../RowsTest.kt` runs every case in `core/test/fixtures/rows-cases.json`, read through a relative path.

- [ ] **Step 1:** Write `RowsTest`, then run `gradlew testGithubDebugUnitTest`. Expected: FAIL (missing `buildRows`).
- [ ] **Step 2:** Implement, and run again. Expected: PASS.

### Task 4: Android sync and sign-in

**Files:** under `app/src/main/java/com/pengopal/aiusagetracker/`:
- `sync/CoreRunner.kt`: `suspend fun read(id: String, grokModel: String): JSONObject`
  - Runs on the main thread, with a 45 s timeout.
  - Off-screen WebView with JS and DOM storage on, a Chrome-like user agent, and third-party cookies accepted.
  - Loads `catalog[id].home`, then calls `WebViewCompat.addWebMessageListener("aiut", setOf(origin))`.
  - Runs `evaluateJavascript(bundle + call)`, where the call posts `JSON.stringify(interpret(id, await readers[id](arg), Date.now()))`.
- `data/UsageStore.kt`: JSON file `usage.json` with `services`, `settings` and `lastSync`, plus a `Flow` of changes.
- `sync/SyncWorker.kt`:
  - `CoroutineWorker` that reads every enabled provider.
  - Merge rule as on desktop: on error keep the old windows and set `error`; on `connected:false` reset the service.
  - Then updates the widget.
  - `schedule(context)` sets a 15 min periodic job with a network constraint; `runNow(context)` runs one-off.
- `ui/LoginActivity.kt`:
  - A visible WebView on `loginUrl`.
  - Every 3 s, probes with `CoreRunner` logic in the same WebView. When connected: `SyncWorker.runNow`, then finish.
- Sign-out clears that origin's cookies through `CookieManager`, by expiring each cookie on that URL.

- [ ] **Step 1:** `gradlew assembleGithubDebug` builds.
- [ ] **Step 2:** On the emulator, sign-in for one provider opens the real login page. Manual check: the user signs in later on their phone.

### Task 5: Glance widget

**Files:**
- `widget/UsageWidget.kt` (`GlanceAppWidget`, `SizeMode.Exact`)
- `widget/UsageWidgetReceiver.kt`
- `widget/RefreshAction.kt`
- `res/xml/usage_widget_info.xml` (resizable, min 250x110dp, `updatePeriodMillis=0`)
- `res/drawable/logo_{claude,openai,xai}.xml`, from the desktop sprite paths
- `res/layout/glance_default_loading_layout.xml`, `res/values/strings.xml`

**Layout, mirroring the desktop bars:**
- Title row: dot, "Usage", time of last sync, refresh icon.
- Per provider: logo, name, plan chip.
- Per metric: label (muted 12sp), "Resets in 2h 12m" (faint 11sp), pct right (650 weight, coloured), then a 3dp `LinearProgressIndicator`.
- A signed-out provider shows "Not connected · Sign in" (accent), which opens the app.
- Empty state text from Review Focus 5. Content scrolls in a `LazyColumn`.

- [ ] **Step 1:** `formatReset(resetIso, now)` lives in `core/Format.kt`.
  - Test: `FormatTest`. `2h 12m`, `3d 9h` and `<1m` match the desktop's `formatDuration`. An already-past reset gives `Resetting…`.
- [ ] **Step 2:** Build, install on the emulator, and add the widget. Screenshot it.

### Task 6: App UI and updater

**Files:**
- `ui/MainActivity.kt` + `ui/theme/*` (Compose, dark):
  - the same bars as the widget;
  - provider cards with a show switch, plan dropdown, ↑/↓ reorder, Sign in/out;
  - Refresh;
  - an About section with the version and update status.
- `src/github/java/.../update/Updater.kt`:
  - Reads `https://api.github.com/repos/Pengopal/ai-usage-tracker-widget/releases/latest`.
  - `isNewer(remote, local)`.
  - Picks the asset ending in `.apk`.
  - Downloads to `cacheDir/updates/`.
  - Installs with a `PackageInstaller` session; the status `PendingIntent` launches the confirm dialog.
- `src/play/java/.../update/Updater.kt`: no-op with the same API.
- `src/github/AndroidManifest.xml`: `REQUEST_INSTALL_PACKAGES`.
- Tests: `UpdateCheckTest` (compare, `v` prefix, no APK asset), in `src/testGithub`.

- [ ] **Step 1:** Write the tests, see them fail, implement, see them pass.
- [ ] **Step 2:** Screenshot the app on the emulator.

### Task 7: CI, release, docs

**Files:**
- `.github/workflows/ci.yml`: jobs `core`, `desktop` and `android` (JDK 21, `./gradlew testGithubDebugUnitTest assembleGithubDebug`).

  Keep a job named `test` that depends on all three, so the existing required check still passes.
- `.github/workflows/release.yml`:
  - The Windows job runs in `desktop/`.
  - The `android` job builds `assembleGithubRelease`, signed from secrets, and uploads `AI-Usage-Tracker-<version>.apk` with `gh release upload`. It skips with a warning when there are no secrets.
  - Tag checks run against both version files.
- `.github/dependabot.yml`: npm in `/desktop`, gradle in `/android`.
- Docs:
  - Root `README.md`: overview, a platforms table, the repo layout.
  - `docs/desktop/README.md`: the current desktop content. Move `docs/images` to `docs/desktop/images`, and move `CODE-SIGNING.md` to `docs/desktop/`.
  - `docs/android/README.md`: install the APK, add the widget, signing secrets, Play flavour.
  - `docs/ARCHITECTURE.md`.
  - Update `CONTRIBUTING.md`.
  - `CHANGELOG.md` 1.3.0 with Android and Desktop subsections.
- Bump versions to 1.3.0.

- [ ] **Step 1:** Run `cd core && npm test`, `cd desktop && npm test`, and `cd android && gradlew testGithubDebugUnitTest assembleGithubDebug`. All green.
- [ ] **Step 2:** Push the branch and open a PR. CI is green.
