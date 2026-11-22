# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each release's notes on GitHub are taken from its section below.

## [Unreleased]

### Android

- Builds with Android Gradle Plugin 9.5 (built-in Kotlin) and Gradle 9.9, and compiles against Android API 37.1.
  The app still targets API 36, so its behaviour is unchanged.
- Updated Compose (BOM 2026.11.01), WorkManager 2.12 and Kotlin 2.4.

### Fixed

- **Android:** refreshing from the widget no longer times out. Each provider's reader starts as soon as its page
  is on the provider's site instead of waiting for the whole web app to load, which in the background could take
  longer than the 45-second limit.
- **Android:** "Continue with Google" sign-in no longer ends on a white screen. Sign-in popups now open as a
  window over the page, so they can hand the sign-in back to it.

### Desktop

- Updated to Electron 45 and electron-builder 26.

## [1.3.0] - 2026-11-22

### Android

- **New: Android home-screen widget.** Your Claude, ChatGPT and Grok limits on the home screen, in the same bar
  layout as the desktop: one line per limit with its reset time and percentage, orange at 70%, red at 90%.
- A small app to sign in to each provider, show or hide them, pick your plan, and set their order.
- Refreshes every 15 minutes, when you open the app, and when you tap ↻ on the widget.
- Updates itself from GitHub releases: **About → Update** downloads the new APK and asks Android to install it.

### Desktop

- No visible changes. The app now runs the shared readers from `core/`, the same code Android uses.

### Core

- The provider catalog, usage readers, parsers and row-building moved to a shared `core/` folder used by every
  platform, with a test fixture both platforms run.
- The repository is split into `core/`, `desktop/` and `android/`, with per-platform guides under `docs/`.

## [1.2.1] - 2026-11-22

### Added

- **Reorder providers**: drag a provider by its handle in Settings, or focus the handle and use the arrow
  keys. The widget, ring view and tray menu follow that order.

### Changed

- Each limit is one line: its name on the left, "Resets in …" next to it, and the percentage on the right.

### Removed

- The trend line and the "Out in …" estimate from the widget. The pace heads-up notification stays.

## [1.2.0] - 2026-11-22

### Added

- **ChatGPT limits**: sign in to chatgpt.com to see your 5-hour and weekly limits, with plan detection
  (Free, Plus, Pro, Business, Enterprise).
- **Plans**: pick your plan per provider in Settings, and the widget shows that plan's limits. For example,
  Claude Max 20x shows only the weekly limit. "Auto-detect" shows every limit your account reports and labels
  the plan it finds.
- **Show or hide providers**: a switch per provider in Settings. Hidden providers aren't synced.
- Ring view shows one ring per limit and widens to fit.
- Unit tests, CI, and a tag-triggered release workflow that builds on Windows and publishes the installer.
- Code-signing support through Azure Artifact Signing, switched on by repository secrets
  (see [docs/desktop/CODE-SIGNING.md](docs/desktop/CODE-SIGNING.md)).

### Changed

- **More compact bars**: each limit is one line — name and percentage on the left, reset time or pace on the
  right — with a thinner bar underneath.
- Claude's 5-hour limit is labelled "5-hour" instead of "Session".
- Data from 1.1 (readings, history and settings) carries over automatically.

## [1.1.0] - 2026-11-22

### Added

- Compact ring view.
- Pace heads-up: "Out in ~1h 5m" when a limit will run out before it resets, and a notification about
  30 minutes ahead.
- Alerts at chosen thresholds (default 75, 90 and 100%) and when a limit is back.
- 24-hour sparklines from locally stored history (7 days).
- Automatic updates from GitHub Releases, with an **Update** button when a new version is ready.

### Changed

- Cleaner, more compact design; the window sizes itself to its content.

## [1.0.0] - 2026-10-30

### Added

- Always-on-top widget showing Claude (5-hour and weekly) and Grok usage, read from your accounts every
  minute after a one-time sign-in.
- Colour-coded bars, reset countdowns, threshold notifications, tray icon.

[Unreleased]: https://github.com/Pengopal/ai-usage-tracker-widget/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Pengopal/ai-usage-tracker-widget/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/Pengopal/ai-usage-tracker-widget/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Pengopal/ai-usage-tracker-widget/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Pengopal/ai-usage-tracker-widget/releases/tag/v1.1.0
