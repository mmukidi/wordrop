# Wordrop Burst — Gap Analysis vs. Market Leaders

Written 2026-08-01. A from-scratch comparison of Wordrop Burst against the
games that dominate the word/puzzle category — Wordscapes (world's #1 word
game, ~125M downloads, 5M DAU), NYT Wordle, Royal Match (top-grossing
puzzle game, passed Candy Crush), Candy Crush, and Words With Friends —
to identify what's missing and what matters most. Supersedes and extends
the earlier `BACKLOG.md` (which stays as the running task list).

## What Wordrop has today

Solid core loop: swipe-to-spell on a rising board, 10-level speed curve,
combo/length/direction multipliers, 7-tier letter rarity, Glow Tiles
(row/column bursts), hint/shuffle/vortex power-ups, in-run stats, high
score, Game Center leaderboard + 5 achievements, retro-arcade SFX, and an
ambient water+piano soundtrack. That's a genuinely fun *minute-to-minute*
game. What it lacks is almost everything that makes players come back on
day 2, day 7, and day 30 — the meta layer around the core.

## Feature comparison

| Feature | Wordscapes | Wordle | Royal Match | Wordrop today |
|---|---|---|---|---|
| Tutorial / FTUE | ✅ guided | ✅ trivially simple | ✅ guided | ❌ static HOW TO PLAY text |
| Daily challenge | ✅ | ✅ (is the whole game) | ✅ | ❌ |
| Streaks | ✅ | ✅ core hook | ✅ | ❌ |
| Shareable results | ✅ | ✅ THE viral engine | ✅ | ❌ |
| Push notifications | ✅ | ✅ (NYT app) | ✅ | ❌ |
| Level/progression map | ✅ 6,000+ levels, themed worlds | n/a | ✅ | ❌ endless only |
| Live events / seasonal content | ✅ ~weekly | ✅ (NYT games suite) | ✅ every 2 weeks | ❌ |
| Collection / cosmetic meta | ✅ avatars, backgrounds | n/a | ✅ decorating meta | ❌ |
| Soft currency (coins) | ✅ | n/a | ✅ | ❌ power-ups are flat-limited |
| Social (friends/teams/clans) | ✅ teams | ✅ implicit via sharing | ✅ teams | ⚠️ leaderboard only |
| Adaptive difficulty | ✅ | n/a | ✅ | ⚠️ fixed speed curve |
| Analytics | ✅ | ✅ | ✅ | ❌ (Sentry crashes only) |
| Cloud save / sync | ✅ | ✅ | ✅ | ❌ localStorage only |
| Haptics | ✅ | ✅ | ✅ | ❌ |
| Monetization (IAP/ads) | ✅ hybrid | ✅ subscription | ✅ IAP | ❌ none |

## The gaps, in priority order

### Tier 1 — the difference between "played once" and "daily habit"

**1. Daily Challenge + streak counter.** The single most proven retention
mechanic in the genre. One seeded board per day, same for everyone,
separate daily leaderboard, streak counter with real stakes (lose it if
you skip a day). Wordle built 300K+ players in two months on essentially
nothing but this. Cheap to build (seeded RNG + a date check) and it
pairs with every other Tier 1 item.

**2. Shareable result card.** Wordle's emoji grid is the most effective
zero-cost user acquisition machine in mobile history — shares are both
brag and tease, spoiler-free. Wordrop's version: end-of-run card (score,
level, longest word, glow bursts) plus a compact emoji-grid rendering of
your best word, pushed through the iOS share sheet. Without this the
game has no organic growth channel at all.

**3. First-run tutorial.** New players must understand "swipe a path to
spell a word before the board rises" within ~15 seconds or they churn.
A 3-step guided overlay on first launch (forced easy word → forced glow
burst → go). Every leader hand-holds the first minute.

**4. Push notifications.** Streak-at-risk reminders and daily-challenge
reset alerts. Currently there is zero re-engagement once the app closes.
This is the biggest D7/D30 lever that exists and it's a Capacitor plugin
away.

**5. Haptics.** Every top iOS game uses the Taptic engine; a word-clear
without a thump feels flat on device. Capacitor Haptics plugin, wired to
word-clear (light), glow burst (heavy), game over. Small effort, big
perceived-quality jump.

### Tier 2 — depth that keeps week-2 players engaged

**6. Progression beyond endless.** Endless-only is the biggest structural
gap vs. Wordscapes' 6,000 levels and themed worlds. A "Journey" mode
with hand-tuned objective levels (clear N glow tiles, score X in Y
words, themed boards) gives players a sense of place and completion that
endless can't. Even 50 levels at launch changes the game's shape. The
level-map screen is also where events, collections, and monetization
naturally live later.

**7. Soft currency + earn loop.** Coins earned per run (score-based,
daily bonus, achievements) and spent on hints/shuffles/continues.
Converts existing power-ups from a flat cap into an economy, makes every
run feel productive, and is the prerequisite for any monetization later.

**8. Collection / cosmetic meta.** Tile skins, board themes, burst
effects earned through play (streak milestones, journey progress,
events). Wordscapes' collection events and zen-theme variety are a large
part of its "one more session" pull. Purely cosmetic — doesn't touch
balance.

**9. Live events cadence.** Top puzzle games now run dozens of events
monthly; even a light version works: weekend "double glow spawn",
themed word lists (holidays), limited-time leaderboard resets. Requires
a remote config file (even a static JSON fetched from GitHub Pages
works at first) so events ship without App Store review.

**10. Real analytics.** Can't tune what you can't see: level quit
points, session length, D1/D7 retention, power-up usage. A
privacy-respecting, event-level tool (e.g. TelemetryDeck) keeps the
existing privacy-policy promise of anonymity. This should honestly ship
*before* heavy Tier 2 investment, to know what's working.

### Tier 3 — scale features, once retention is proven

**11. Social beyond a leaderboard.** Friend challenges ("beat my daily
score"), then teams/clans with shared weekly goals — multiplayer
features are associated with ~30% retention lift, but they only pay off
once there's a player base to be social with.

**12. Adaptive difficulty.** Candy Crush's quiet superpower: keep players
at "almost won". Wordrop equivalents: dynamic rise-speed easing after
repeated early game-overs, letter-quality pity timers, smarter glow
thresholds per player skill.

**13. Cloud save.** iCloud key-value sync for streaks/coins/cosmetics.
Mandatory before players have meaningful progression to lose (a lost
100-day streak is an uninstall).

**14. Monetization.** Deliberately last: hybrid model like Wordscapes —
rewarded ads (extra continue/hint) + "remove ads" IAP + coin packs.
Monetizing before retention is solid just accelerates churn. Current
state (nothing) is fine for launch; the coin economy in #7 is the
foundation.

## What NOT to change

The core loop (rising board + swipe words + glow bursts) is
differentiated — nothing in the top 10 plays like it. The zen
audio/visual direction matches the market's winning "calm brain workout"
positioning (Wordscapes' entire brand). Don't chase match-3 mechanics;
the gap is entirely in the meta layer, not the game.

## Suggested build order

1. Haptics + tutorial + share card (small, ship together as v1.1 "feel" release)
2. Daily challenge + streaks + push notifications (v1.2 — the habit release)
3. Analytics (alongside v1.2, so its impact is measured from day one)
4. Coins + collections (v1.3)
5. Journey mode 50 levels + events config (v1.4)
6. Cloud save, social, adaptive difficulty, monetization (v2.x, informed by analytics)

## Sources

- [Wordscapes hybrid monetization / LTV analysis (AppLovin)](https://blog.applovin.com/how-wordscapes-improved-ltv-hybrid-monetization-trends/)
- [Wordscapes overview & live-ops (Grokipedia)](https://grokipedia.com/page/Wordscapes)
- [PeopleFun / Wordscapes strategy (Ludocious/Naavik)](https://ludocious.com/index.php?p=blog&u=naav-worldscapes)
- [Wordle streak/sharing psychology (Quiz Rebel)](https://quizrebel.com/blog/wordle-psychology-daily-streaks.html)
- [Wordle habit loops (Economix Everyday)](https://economixeverday.substack.com/p/why-youre-addicted-to-wordle-habit)
- [Royal Match surpasses Candy Crush (Sensor Tower)](https://sensortower.com/blog/royal-match-surpasses-candy-crush-saga-in-revenue-and-downloads-for-the)
- [Royal Match $3B strategy (Udonis)](https://www.blog.udonis.co/mobile-marketing/mobile-games/royal-match-analysis)
- [Live-ops trends in mobile puzzle (Naavik)](https://naavik.co/digest/live-ops-trends-powering-mobile-puzzle/)
- [Mobile game retention benchmarks 2026 (Segwise)](https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies)
- [Word game statistics (WordsRated)](https://wordsrated.com/guides/word-games-statistics/)
