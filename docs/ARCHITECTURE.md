# Architecture

One repository, one version, one release, several platforms. What every platform needs to agree on lives in
`core/`; each platform owns only how it signs in, runs the readers, stores data and draws the bars.

```
core/src/                     shared, plain CommonJS, no dependencies
  catalog.json                providers, plans, limits per plan, sign-in and home URLs
  readers.js                  claude(), openai(), grok(model): run inside the provider's page
  parsers.js                  provider response → { windows, plan, detail }
  interpret.js                reader result → { connected, windows, plan, detail, error }
  providers.js                plan choice and buildRows() for the widget
  insights.js                 pace from history (desktop alerts)
core/test/fixtures/
  rows-cases.json             run by core's JS tests and Android's Kotlin RowsTest

desktop/  copies core/src → desktop/src/core   (scripts/copy-core.js, git-ignored)
android/  copies core/src → APK assets/core     (Gradle copyCore task, build output)
```

## One read, start to finish

1. **Sign in.** The platform opens the provider's `loginUrl` in a persistent browser profile: an Electron
   partition on Windows, the app's WebView cookie store on Android. The user signs in on the real page.
2. **Read.** The platform loads the provider's `home` page in a hidden window or WebView and evaluates the
   reader from `readers.js` there. The reader calls the provider's own usage endpoint with the page's cookies
   and returns only the usage JSON, never a token or cookie.
3. **Interpret.** `interpret(id, result)` turns that JSON into windows (percent used and reset time), the plan,
   and an error if the response was unexpected. Desktop calls it in Node; Android calls it in the same page
   right after the reader, so only the interpreted result crosses into Kotlin.
4. **Merge and store.** A failed read keeps the last good windows and records the error, so a flaky network
   never blanks the widget.
5. **Draw.** `buildRows()` (JS) and its Kotlin port pick which limits to show from the catalog and the user's
   plan choice. The shared fixture keeps the two in step.

## Why it's split this way

- **Readers and parsers are shared** because they break when a provider changes its site. Fixing one file
  fixes every platform.
- **Row-building is ported, not shared, on Android**, because the widget renders without a WebView. The shared
  fixture test is what stops the port drifting.
- **Storage, scheduling and UI stay per platform.** Electron and Android differ too much there for a shared
  layer to pay for itself.

## Releases and updates

A `v*` tag runs [release.yml](../.github/workflows/release.yml): it checks the tag against
`desktop/package.json` and `android/gradle.properties`, publishes the Windows installer and `latest.yml`, then
attaches the signed APK. Both apps update from GitHub's *latest* release, which is why there is one release for
every platform rather than one per platform.

## Adding a platform

Create a top-level folder for it, copy `core/src` in at build time the way `desktop/` and `android/` do, run
the shared fixture in its tests, add a CI job and a `test` dependency in [ci.yml](../.github/workflows/ci.yml),
and add its guide under `docs/<platform>/`.

## Adding a provider

Add it to `catalog.json`, a reader in `readers.js`, a parser plus tests in `parsers.js`, and a logo on each
platform. Both apps pick it up from the catalog.
