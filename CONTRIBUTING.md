# Contributing to AI Usage Tracker

Thanks for helping. This page covers how to run the app, how the code is laid out, and the rules every change
follows.

## Getting set up

You need Windows 10 or 11 and Node 22.

```bash
npm install
```

```bash
npm start
```

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/main.js` | Electron main process: window, tray, sync loop, alerts, IPC |
| `src/sync.js` | Sign-in windows and the per-provider usage readers (runs inside the site's own page) |
| `src/parsers.js` | Pure functions turning each provider's response into `{ windows, plan, detail }` |
| `src/providers.js` | The provider catalog: plans and which limits each plan shows |
| `src/insights.js` | Pace and trend lines from stored history |
| `src/store.js` | JSON persistence and migration of older data files |
| `src/updater.js` | electron-updater wiring |
| `src/renderer/` | The widget UI (no framework) |
| `test/` | Unit tests for the pure modules |

## Making a change

1. **Branch** from `main` (`feat/…`, `fix/…`, `docs/…`).
2. **Write the failing test first** for anything in `parsers.js`, `providers.js`, `insights.js` or `store.js`,
   then the code.
3. **Run the checks** before pushing:

   ```bash
   npm test
   ```

4. **Try it in the app** with `npm start`. Attach a screenshot to the pull request for anything a user will see.
5. **Add a line to `CHANGELOG.md`** under `[Unreleased]`.
6. **Open a pull request** against `main`. CI must be green and the code owner must approve.

## Rules every change follows

- **Sessions never leave the provider.** Usage is read inside the provider's own page. Never return tokens or
  cookies to the main process, write them to disk, or log them; the `sync-debug-*.json` files must hold only
  usage responses.
- **The renderer stays sandboxed.** `contextIsolation`, `sandbox` and no `nodeIntegration`; the UI talks to the
  main process only through `preload.js`. No remote content in the widget window.
- **Adding a provider** means: a service in `sync.js`, a parser plus tests in `parsers.js`, and a catalog entry
  in `providers.js`. The UI picks it up from there.
- **Older data keeps working.** If you change the shape of `usage-data.json` or `history.json`, migrate it in
  `store.js` / `insights.js` and add a test.
- **Plain language in the UI.** "Resets in 3h", "Out in ~1h", not window sizes in seconds.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org): `feat(sync): …`, `fix(widget): …`, `docs: …`,
`test: …`, `chore: …`. Keep the subject under 72 characters and explain the why in the body.

## Reporting problems

- **Bugs:** open an issue with steps to reproduce, what you expected, and what happened. For sync problems,
  include the relevant `sync-debug-*.json` after checking it holds nothing personal.
- **Security problems:** don't open a public issue — see [SECURITY.md](SECURITY.md).
