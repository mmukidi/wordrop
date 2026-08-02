# Backlog — future engagement/retention work

Captured 2026-07-31 from a discussion of what successful/addictive mobile
games (Candy Crush, Wordscapes, Wordle, 2048, Words With Friends) have in
common, and how that maps onto Wordrop Burst. Game Center (leaderboards +
achievements) was pulled out of this list and implemented first as the
highest-leverage, lowest-effort item — see `GAME_CENTER_SETUP.md`. Everything
below is intentionally deferred, roughly in priority order.

## Retention hooks (biggest gap right now)

- **Shareable result card.** End-of-run card (score, level reached, longest
  word) pushed through the iOS share sheet. Wordle's entire growth engine was
  "share your result" — cheap to build, high viral upside.
- **Daily challenge mode.** Same seeded board for everyone, resets once a
  day, separate leaderboard from endless mode. Strongest "come back
  tomorrow" hook, and pairs naturally with a streak counter.
- **Push notifications.** Streak reminders, daily challenge reset alerts.
  Right now there is zero re-engagement mechanism once the app is closed —
  this is the single biggest lever for D7/D30 retention that doesn't exist.
- **Real engagement analytics.** Sentry only catches crashes. No visibility
  into which level people quit at or how many rounds before churn. Needs to
  be privacy-respecting (event-level, not identity-linked) since the privacy
  policy already promises anonymity — something like TelemetryDeck rather
  than invasive tracking.

## Game feel / depth

- **New mechanics at higher levels, not just speed — Glow Tiles shipped
  2026-07-31 (originally called "Charge Tiles," renamed same day).**
  `LEVEL_SPEEDS` (in `game.js`) still ramps drop speed 1-10, but as of this
  session there's a first "new toy" mechanic layered on top: Glow Tiles.
  Unlocked from level 1 (`GLOW_TILE_UNLOCK_LEVEL`), rising rows occasionally
  spawn a tile carrying a burst threshold (`⚡N` badge) — it's a completely
  normal tile otherwise, falling/shuffling/swapping like any other (an
  earlier "immovable" version was tried and explicitly reverted per user
  feedback the same day). Clear any single word worth ≥N anywhere in that
  tile's row or column and the whole line detonates — cumulative score
  bonus (sum of every tile's value in the line, plus a flat
  `GLOW_TILE_BURST_BONUS`), distinct amber burst effect. See `spawnTile()`,
  `sliceClearWord()` → `findGlowTileInLine()` / `triggerRowColumnBurst()`
  in `game.js`.

  **Real bug found and fixed the same day:** the only real call site of
  `sliceClearWord()` (a player's actual swipe, in `swipeFinish()`) never
  passed a `direction` field, so `findGlowTileInLine()` and
  `triggerRowColumnBurst()` both silently treated every real player word as
  vertical regardless of whether it was swiped horizontally — a horizontal
  word could find and validate against a glow tile in its row correctly,
  but the burst itself would try to detonate a column instead of the row,
  which visibly looked like "the row isn't bursting." Root-caused via a
  jsdom end-to-end test (see `TESTING.md` section 6) after the user
  reported it from real device play, not caught by any earlier
  extraction/mock test since those all passed `direction` explicitly by
  hand. Fixed by deriving `direction` from the swipe path's own two first
  tiles (the path is already locked to one axis during swiping) before
  calling `sliceClearWord()`.

  Next candidates for the same "one new toy per level" pattern, not yet
  built: multiplier tiles (2x/3x a word's score if included), bomb tiles
  (clear a small radius on trigger instead of a full line), locked/frozen
  *letter-cell* obstacles that must be cleared a set number of times before
  releasing a bonus, and a Game Center achievement for triggering N glow
  bursts in one run ("Chain Reaction").
- **Onboarding / first-run tutorial.** Confirmed there is currently no
  tutorial overlay anywhere in `index.html`. New players likely bounce in
  the first 30 seconds if they don't immediately understand "swipe a
  multi-tile path to spell a word while the board rises."

## Monetization (currently nonexistent)

- No ads, no IAP at all right now. Worth deciding intentionally rather than
  leaving as a pure cost center — e.g. a "remove ads" IAP, or a rewarded ad
  for an extra hint/shuffle/continue. Low priority relative to retention
  work above; monetizing a game nobody comes back to doesn't help.

## Ongoing (not a one-time task)

- **ASO iteration.** Once install/keyword data exists in App Store Connect,
  revisit keywords, screenshots, and description based on actual conversion
  data rather than the initial guesses in `wordrop_app_store_listing.md`.

## Already shipped (for reference, not backlog)

- High score, 10-level difficulty curve, combo/length/direction score
  multipliers, in-run stats (words cleared, longest word, rare count), hint
  / shuffle / vortex power-ups, Game Center leaderboard + achievements,
  Glow Tiles (see `TESTING.md` for the full history), a 7-tier letter
  rarity color system, and an ambient soundtrack. The soundtrack went
  through 4 procedurally-synthesized iterations (wind+pad-drone → sounded
  like radio static; white-noise rain hiss → sounded like TV static;
  pink-noise hiss with scattered droplets; rhythmic pitched water-drop
  pulses) before landing on what actually shipped: two original
  AI-generated (Suno) tracks the user produced from a "soothing water +
  piano, rhythmic" prompt, bundled as local assets
  (`assets/audio/rainstone-loop-1.mp3` / `-2.mp3`, ~6MB/11MB) and
  alternated randomly between plays — see `AMBIENCE_TRACKS` /
  `_playNextAmbienceTrack()` in `audio.js`. All the synthesis code was
  removed once the real tracks landed.
