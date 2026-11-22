# AI Usage Tracker Widget

A compact, always-on-top Windows widget that shows your **real** Claude and Grok usage limits, read
from your own accounts every minute, with alerts before you run out.

## Features

- **Live usage**: Claude 5-hour session and weekly limits (with plan), and Grok's weekly pool, synced every
  minute with exact reset countdowns.
- **Two layouts**: a detailed bar view, or a compact ring strip (⚪ button in the title bar, or the tray menu).
- **Pace heads-up**: from your recent burn rate, shows "Out in ~1h 5m" when a limit will run out before it
  resets, and notifies you about 30 minutes ahead.
- **Threshold alerts**: Windows notifications at the percentages you choose (default 75, 90, 100%), once per
  reset window.
- **Limit-back alert**: tells you when a limit you'd nearly used up has reset.
- **24-hour sparklines**: readings are stored locally (7 days) and drawn next to each limit.
- **Automatic updates**: the installed app checks GitHub Releases, downloads new versions in the background,
  and shows an **Update** button to restart into them.
- Frameless, draggable, sizes itself to its content, remembers its position, lives in the tray.

## Connecting accounts

Click **Sign in** on the widget (or in ⚙ Settings). The real claude.ai or grok.com login opens in a window;
sign in as usual. The window closes by itself once the app can read your usage, and the widget comes back
to the front with your numbers. You only do this once per account.

Your password goes only to Claude or xAI. The app keeps the sites' normal login cookies in its own private
profile (like a browser does) and uses them to read your usage. **Sign out** in Settings deletes them.

If "Continue with Google" is blocked inside the sign-in window, use email sign-in.

### How syncing works

Neither Claude nor xAI offers a public API for personal usage, so the widget reads the same internal
endpoints their own websites use:

| Service | Endpoint read | Shows |
| ------- | ------------- | ----- |
| Claude  | `claude.ai/api/organizations/{org}/usage` (the data behind Settings → Usage) | 5-hour session %, weekly %, reset times, plan |
| Grok    | `GET grok.com/rest/grok/credits` (falls back to `POST /rest/rate-limits`) | Used % of the weekly pool and its reset |

These are unofficial endpoints. If Anthropic or xAI change them, the widget shows a "Sync problem" line until
it's updated. The raw last response is saved as `sync-debug-claude.json` / `sync-debug-grok.json` next to the
data file to make fixing that quick. Grok usage inside the X app may be counted separately from grok.com.

## Install

Download `AI-Usage-Tracker-Setup-<version>.exe` from
[Releases](https://github.com/Pengopal/ai-usage-tracker-widget/releases) and run it. Builds aren't
code-signed, so SmartScreen asks first: **More info → Run anyway**.

The portable `AI-Usage-Tracker-Portable-<version>.exe` needs no install but can't update itself.

To start with Windows: `Win + R` → `shell:startup` → drop a shortcut to the app there.

## Develop

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
```

```bash
npm start
```

Build the installer and portable exe into `dist/`:

```bash
npm run build
```

### Releasing an update

1. Bump `version` in `package.json`.
2. Publish to GitHub Releases (needs a token with access to the repo):

```bash
GH_TOKEN=$(gh auth token) npm run release
```

Installed copies pick the new version up within a few hours (or on next start) and offer **Update**.

## Data

`%APPDATA%\ai-usage-tracker-widget\`: `usage-data.json` (last readings and settings), `history.json` (7 days
of readings), the sync debug files, and `Partitions\` (the Claude and Grok login sessions). Delete the folder
to reset everything.

## Project layout

```
src/
  main.js          window, tray, sync loop, alerts, IPC
  sync.js          sign-in windows and the Claude / Grok usage readers
  insights.js      burn-rate pace and sparkline series from history
  store.js         JSON persistence for readings, settings and history
  updater.js       GitHub Releases auto-update
  preload.js       safe bridge exposed to the UI as window.api
  renderer/        widget UI (bars, rings, settings)
```

## License

MIT
