# Wordrop Burst — App Store Connect Listing

Everything below is written from the app's actual code and content (info modal, level system, power-ups, privacy policy) — nothing invented. Paste directly into App Store Connect fields; character counts are Apple's real limits.

---

## App Information

**App Name** (30 char max)
```
Wordrop Burst
```

**Subtitle** (30 char max)
```
Stack, Spell & Survive
```

**Bundle ID:** `com.wordrop.game` (already set)

**Primary Category:** Games → Word
**Secondary Category (optional):** Games → Puzzle

**Copyright**
```
© 2026 Manohar Mukidi
```

---

## Pricing & Availability

**Price:** Free (no ads, no in-app purchases exist in the code — confirmed, nothing to configure here)

---

## Promotional Text (170 char max — editable anytime without a new review)
```
Neon tiles rise from the baseline. Swipe 3+ letters to spell a word and burst them, or swap 2 tiles to set up your next play. 10 levels, zero ads.
```
(148 chars)

---

## Description (4000 char max)
```
Letters rise from the baseline. Spell words before they reach the top.

WORDROP BURST is a fast, neon-lit word puzzle built around one simple move: swipe. Swipe across 3 or more letters in a straight line — horizontal or vertical — to spell a valid word and burst it off the board. Swipe across just 2 adjacent tiles to swap their positions and set up your next word. Drag backward mid-swipe to undo your last pick before you commit.

New letter tiles keep climbing from the baseline. Let them reach the top of the grid and it's game over — so the pressure to keep clearing words never lets up.

FEATURES

• Swipe-to-spell gameplay — 3+ tiles in a line to clear a word, 2 tiles to swap
• Scrabble-style letter values with three tile rarities: common (blue), uncommon (purple), and rare (gold, highest value)
• 10 selectable difficulty levels — each one rises faster and scores higher, from a relaxed 15-second pace up to a frantic 1.5-second sprint
• Power-ups: Hint (reveals a valid word on the board), Shuffle (scrambles the grid), and Vortex (clears the bottom row when things get tall)
• Combo streaks and stat tracking — words cleared, longest word spelled, rare tiles cleared, and your all-time high score
• Set a custom gamer tag
• Clean neon cyberpunk visual style, built for quick sessions or long runs

No ads. No in-app purchases. No account or sign-in required. Your scores and settings stay on your device.

How high can you stack your vocabulary before the grid overflows?
```
(Well under 4000 chars)

---

## Keywords (100 char max, comma-separated)
```
word game,puzzle,spelling,swipe,brain teaser,anagram,vocabulary,arcade,letters,word search
```
(90 chars)

---

## Support URL
```
https://github.com/mmukidi/wordrop
```

## Marketing URL (optional)
```
https://mmukidi.github.io/wordrop/
```

## Privacy Policy URL (required)
```
https://mmukidi.github.io/wordrop/privacy.html
```
Confirmed live and reachable.

---

## Age Rating Questionnaire

Answer every content-descriptor question **"None"** — verified accurate as of the wordlist profanity/slur filtering pass:

| Question | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Sexual Content or Nudity | None |
| Profanity or Crude Humor | None |
| Alcohol, Tobacco, or Drug Use | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Gambling (simulated) | None |
| Unrestricted Web Access | No |
| User-Generated Content | No (gamer tag is local-only, never shown to other users, no multiplayer/sharing) |
| Contests | No |

**Expected result: 4+**

---

## App Privacy ("Nutrition Label")

Based on the actual code — Sentry is used purely for anonymous crash telemetry (the `Sentry.setUser()` calls were removed specifically so this section is accurate):

**Data Types Collected:** Diagnostics → Crash Data only

**For Crash Data:**
- Linked to your identity? **No**
- Used for tracking? **No**
- Purpose: **App Functionality** (stability/bug-fixing)

**Everything else (Contact Info, Financial Info, Location, Browsing/Search History, Identifiers, Purchases, User Content, Usage Data, Sensitive Info):** Not collected.

This should qualify for the "Data Not Linked to You" privacy label — the strongest tier short of "No Data Collected."

---

## What's New in This Version (release notes for v1.0)
```
Initial release. Swipe to spell, swap, and survive — 10 levels, 3 power-ups, zero ads.
```

---

## Screenshots — you'll still need to capture these yourself

App Store requires screenshots per device size class (currently: 6.9" and 6.5" iPhone displays minimum, plus iPad sizes if you support iPad — you do, per Info.plist). Capture from the Simulator or a real device in Xcode:
- Mid-game with a word mid-swipe (shows the core mechanic)
- A cleared word / combo popup (shows feedback)
- Level select screen (shows depth/progression)
- Stats or game-over screen (shows scoring)

3–5 screenshots per size class is typical.
