# Contributing to AI Usage Tracker

Thanks for helping. This page covers how to run the app, how the code is laid out, and the rules every change
follows.

## Getting set up

The repository holds one folder per platform plus the shared core; see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how they fit.

| Folder | Needs | Run | Test |
| --- | --- | --- | --- |
| `core/` | Node 22 | — | `npm test` |
| `desktop/` | Windows 10/11, Node 22 | `npm install`, then `npm start` | `npm test` |
| `android/` | JDK 17+, Android SDK | `./gradlew installGithubDebug` | `./gradlew testGithubDebugUnitTest` |

Run each command from inside its folder.

## Repository layout

| Path | What lives there |
| --- | --- |
| `core/src/catalog.json` | Providers, plans, which limits each plan shows, sign-in URLs |
| `core/src/readers.js` | The usage readers that run inside each provider's page |
| `core/src/parsers.js`, `interpret.js` | Turn each provider's response into the common shape |
| `core/src/providers.js` | Plan choice and the rows the widgets draw |
| `core/src/insights.js` | Pace from stored history |
| `core/test/` | Tests, and `fixtures/rows-cases.json` that Android's tests also run |
| `desktop/src/` | Electron: main process, sync windows, store, updater, renderer |
| `android/app/src/main/` | Kotlin: sync, sign-in, Glance widget, app screen |
| `android/app/src/github/`, `play/` | The self-updater and its Play Store stub |
| `docs/desktop/`, `docs/android/` | Per-platform guides |

Edit shared code in `core/` only: `desktop/src/core/` and the Android assets are copies made at build time.

## Making a change

1. **Branch** from `main` (`feat/…`, `fix/…`, `docs/…`).
2. **Write the failing test first** for anything in `core/`, `desktop/src/store.js`, or Android's `core/`,
   `sync/Merge.kt` and `update/UpdateLogic.kt`, then the code. A change to row-building gets a case in
   `core/test/fixtures/rows-cases.json` so both platforms check it.
3. **Run the checks** for every folder you touched (see the table above). CI runs all of them.
4. **Try it in the app.** Attach a screenshot to the pull request for anything a user will see, on each
   platform it changes.
5. **Add a line to `CHANGELOG.md`** under `[Unreleased]`, in a Desktop, Android or Core subsection.
6. **Open a pull request** against `main`. CI must be green and the code owner must approve.

## Rules every change follows

- **Keep credentials out of the widget.** The web readers keep tokens and cookies in their provider sessions.
  Windows ChatGPT delegates sign-in to Codex App Server, which stores its credentials in Windows Credential
  Manager. The widget receives account status and rate limits. Keep credentials out of logs and debug files.
- **Only interpreted usage crosses out of the page.** On Android the reader and `interpret()` run together in the
  WebView; Kotlin receives windows and a plan, never the raw response's cookies or tokens.
- **The renderer stays sandboxed.** `contextIsolation`, `sandbox` and no `nodeIntegration`; the UI talks to the
  main process only through `preload.js`. No remote content in the widget window.
- **Adding a provider** means: a catalog entry in `core/src/catalog.json`, a reader in `readers.js`, a parser
  plus tests in `parsers.js`, and a logo on each platform. Both apps pick it up from the catalog.
- **Older data keeps working.** If you change the shape of the desktop's `usage-data.json` / `history.json` or
  Android's `usage.json`, migrate it and add a test.
- **One version everywhere.** `desktop/package.json` and `android/gradle.properties` always carry the same
  version; the release workflow refuses a tag that doesn't match both.
- **Plain language in the UI.** "Resets in 3h", "Out in ~1h", not window sizes in seconds.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org): `feat(sync): …`, `fix(widget): …`, `docs: …`,
`test: …`, `chore: …`. Keep the subject under 72 characters and explain the why in the body.

## Reporting problems

- **Bugs:** open an issue with steps to reproduce, what you expected, and what happened. For sync problems,
  include the relevant `sync-debug-*.json` after checking it holds nothing personal.
- **Security problems:** don't open a public issue — see [SECURITY.md](SECURITY.md).
