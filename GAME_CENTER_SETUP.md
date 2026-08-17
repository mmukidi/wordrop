# Game Center setup — one-time manual steps

The code side is done: `ios/App/App/GameCenterPlugin.swift` wraps GameKit
(sign-in, leaderboard, achievements), and `game.js` calls into it at the
right moments (see "What the code already does" below).

## 1. Add the plugin file to the Xcode target — DONE (2026-07-31)

Done via screen control and verified by reading `project.pbxproj` directly:
`GameCenterPlugin.swift` is registered as a `PBXFileReference` and in the
`Sources` build phase (`GameCenterPlugin.swift in Sources`), and Target
Membership shows **App — Default** in the file inspector.

**Correction (2026-08-15):** being compiled into the target was not enough —
GAMER STATS kept showing "Not available on web" for Game Center even in the
native build, while Haptics showed ready. Root cause: Capacitor's bridge
only auto-discovers plugins that arrive as an SPM package product (that's
how `Capacitor`, `Cordova`, and the four `CapacitorHaptics`/etc. products in
`CapApp-SPM` get wired up). `GameCenterPlugin.swift` is a loose source file
in the App target, not a package product, so it was never auto-registered.
Fixed by adding `ios/App/App/MainViewController.swift`, a
`CAPBridgeViewController` subclass that calls
`bridge?.registerPluginInstance(GameCenterPlugin())` in `capacitorDidLoad()`,
and pointing `Main.storyboard`'s root view controller at it instead of the
stock `CAPBridgeViewController`. If any other app-local (non-SPM) plugin is
added later, it needs the same explicit `registerPluginInstance` call in
that same override.

## 2. Enable the Game Center capability — DONE (2026-07-31)

Done via screen control (Signing & Capabilities → +Capability → Game
Center) and verified directly: Xcode created `ios/App/App/App.entitlements`
with `com.apple.developer.game-center = true` and wired
`CODE_SIGN_ENTITLEMENTS = App/App.entitlements` into both Debug and Release
build configs automatically.

## 3. Configure Game Center in App Store Connect — DONE (2026-07-31)

Done via Chrome. Created and saved (all in "Prepare for Submission" —
deliberately not clicked "Add for Review" yet, see note below):

- Leaderboard `wordrop_high_score` — Integer, Best Score, High to Low, Classic (never resets)
- Achievement `wordrop_first_word` — 10 pts, not hidden
- Achievement `wordrop_level_5` — 20 pts, not hidden
- Achievement `wordrop_level_10` — 30 pts, not hidden
- Achievement `wordrop_century` — 20 pts, not hidden
- Achievement `wordrop_wordsmith` — 20 pts, not hidden
- 900 of 1,000 total achievement points remaining if more are added later

Also done (2026-07-31, follow-up pass): localized copy + icons for all 5 achievements, and a localized display name/description/score-suffix for the leaderboard. Generated 5 themed badge icons (cyan "W" for First Word, blue "5" for Level 5 Survivor, orange "10" for Hard Mode, gold "100" for Century Club, purple "7+" for Wordsmith) and wrote earned/pre-earned copy for each, all saved.

Still deliberately not done:
- **Clicking "Add for Review"** on the leaderboard and achievements — the page warns that once something is live for any app version it can never be removed, only edited going forward. Everything is fully content-complete and ready to submit; this is the one remaining step, held for your explicit yes since it's irreversible.

## Testing before shipping

Game Center requires either a real device or a Simulator signed into a
**Sandbox Apple ID** (Settings → Game Center on device, or via Xcode's
Simulator once signed in) — it will not authenticate with your everyday
Apple ID in a dev build. Create a Sandbox tester under App Store Connect →
Users and Access → Sandbox if you don't already have one.

What to check once built:
- On first launch, a Game Center sign-in sheet should appear (or silently
  succeed if already signed into Game Center on the device).
- After signing in, a small Game Center badge (the "access point") should
  appear near the top-right of the screen — tapping it opens the native
  Game Center dashboard.
- Finish a run: check that the score appears on the `wordrop_high_score`
  leaderboard (may take a few seconds).
- Clear a word, reach level 5, reach level 10, clear a 7+ letter word,
  clear 100 words lifetime: each should unlock the matching achievement,
  visible in the Game Center dashboard.

This part — actual sign-in flow, access point rendering, achievement
banners — can't be verified from this environment at all (no device, no
Sandbox Apple ID, no Xcode). The Swift code was checked for syntax balance
and every GameKit API call was verified against Apple's current
documentation, but real verification only happens once you run it. Per
`TESTING.md`, saying that plainly rather than implying a confidence level
this wasn't able to earn.

## What the code already does

- `initGame()` calls `gcAuthenticate()` on every launch (non-blocking,
  silently no-ops on web).
- `triggerGameOver()` submits the run's score to the leaderboard.
- Clearing any word updates the lifetime word-count achievement progress,
  and unlocks "First Word" / "Wordsmith" (7+ letters) when earned.
- Reaching level 5 or level 10 unlocks the matching achievement.
- All of it is wrapped so that on the website build, or if a player
  declines/can't sign into Game Center, every call is a harmless no-op —
  gameplay is never blocked or slowed by any of this.
