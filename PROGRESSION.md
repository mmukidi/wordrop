# Level Progression & Motivation Design

Added 2026-08-02. This documents *why* the progression system is shaped the
way it is, and the model the numbers were tuned against. `balance_model.js`
in the repo root reproduces the tuning check.

## The problem it solves

Before this, Wordrop had levels but no **goals**. Levels arrived as a
surprise popup driven by hidden score thresholds nothing on screen ever
mentioned. The player never knew what they were working toward, so there was
no anticipation, no moment of achievement, and no reason to start another
run.

The engine behind Candy Crush's retention isn't difficulty — it's that you
**always see the goal, always see progress toward it, and always get a
celebration when you hit it.** That loop is what got built here.

## The loop

```
See the goal  ->  make progress you can watch  ->  hit it  ->  get
celebrated and rated  ->  immediately see the next goal
```

1. **Always-visible goal.** A HUD bar under the rise timer shows
   `LEVEL n GOAL` and `current / target` at all times.
2. **Rising tension.** Past 75% of the target the HUD turns gold and pulses,
   so the last stretch of a level *feels* like the last stretch.
3. **A real completion beat.** Hitting the target freezes the board and
   shows a celebration: stars, level score, words used vs par, lifetime star
   total, and a preview of the next target.
4. **A quality bar, not just a pass bar.** 1–3 stars, so there's a reason to
   replay a level you already beat.
5. **Failure is local.** Overflowing fails *that level*, not the run. You
   retry the same level, not level 1.

## Star rating

Stars are judged on **efficiency**, not speed:

| Stars | Condition |
|-------|-----------|
| ★★★ | Cleared the target in **at or under par** words |
| ★★ | Within 40% over par |
| ★ | Completed at all |

`par = ceil(target / (9.5 × levelMultiplier))` — where 9.5 is the measured
average value of the *best available word* on a real board (see below).

This deliberately rewards finding one 6-letter word over spamming three
3-letter ones. In a word game, vocabulary should be the skill that pays.

## Failure and retry

Overflow fails the level. The retry screen shows how close you got, how many
points short you were, and a tip. Retrying:

- keeps you on the **same level**
- deals a **fresh board**
- **rolls the total score back** to where the level began, so repeated
  attempts can't be farmed for points

Daily Challenge is exempt — it keeps the classic single-run game over so
everyone's shared daily score stays comparable.

## Calibration

Targets and speeds were tuned against two models rather than guessed.

**Scoring model** — 6,000 simulated boards using the real letter weights,
the real 172k-word dictionary and the real `calculateWordScore()`:

| Measure | Value |
|---|---|
| Boards with at least one valid word | 99.5% |
| Valid words available per board | ~6.8 |
| Score of the **best** word on a board | ~9.5 (median 9) |
| Score of a typical word picked | ~5.2 |
| Longest word available | ~3.6 letters |

**Survivability model** — a rise adds 8 tiles; a word clear removes ~3.3; a
strong player clears roughly one word every 3.5s. Net tile inflow determines
how long a board lasts, which caps how many points are extractable at all.

This surfaced a serious pre-existing problem: **levels 7–10 were not
survivable.** The old speed curve bottomed out at 1.5s/row, giving a strong
player ~18 seconds at level 10 no matter how well they played. Those levels
were advertised in the level menu but could never be meaningfully played.

The speed curve was softened and capped:

| Level | Old | New |
|---|---|---|
| 1 | 15.0s | 15.0s |
| 2 | 12.0s | 12.5s |
| 3 | 9.0s | 10.5s |
| 4 | 6.0s | 9.0s |
| 5 | 4.5s | 7.5s |
| 6 | 3.5s | 6.5s |
| 7 | 3.0s | 5.5s |
| 8 | 2.5s | 5.0s |
| 9 | 2.0s | 4.5s |
| 10+ | 1.5s | 4.0s (capped) |

Final targets: `100, 175, 250, 325, 400, 475, 550, 625, 700, 775`, then
+50 per level beyond 10.

Verified headroom (strong player = one word / 3.5s):

| Level | Target | Extractable max | Target uses |
|---|---|---|---|
| 5 | 400 | 5262 | 8% |
| 7 | 550 | 1697 | 32% |
| 10 | 775 | 1130 | 69% |
| 15 | 1025 | 1643 | 62% |
| 25 | 1525 | 2670 | 57% |

Because speed caps at level 10 while the score multiplier keeps growing, the
extractable ceiling **rises faster than the targets do** past level 10 — the
ladder stays climbable indefinitely rather than hitting a wall.

## Related fix

`getLevelMultiplier()` existed but **was never called**. Every level button
advertised "1.5x … 5.5x Pts" and HOW TO PLAY promised "+50% more points per
word", but `calculateWordScore()` ignored it entirely — picking a harder
level bought a faster board for identical score. It is now applied, which is
also what makes the target curve above hold together.

## Deliberately not built (yet)

- **Varied objectives** ("clear 4 words of 5+ letters", "trigger 2 glow
  bursts"). The strongest next addition — it gives each level an identity
  and stops the mid-game feeling repetitive.
- **Unlockable cosmetics** keyed off the lifetime star total. The star
  economy now exists to support this whenever art does.
- **A journey/map screen** visualising levels and stars.
