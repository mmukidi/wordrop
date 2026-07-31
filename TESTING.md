# Testing checklist — before committing a code change

This project has no automated test suite and no CI test step, and there's no
Xcode/Simulator available in the environment where most of these fixes get
written. That means every logic fix is a guess until it's actually verified
somehow. This checklist is the minimum bar before a fix is considered done.

## The rule

**Before committing any change to game logic (not pure styling/copy), write
and run an isolated verification that exercises the real code with the
specific scenario the bug report describes.** Don't just re-read the code and
convince yourself it's right — run it.

## How, depending on what changed

### 1. Pure logic / state bugs (grid, gravity, scoring, matching, etc.)

Extract the *actual* function source straight out of `game.js` — never
retype it from memory — and run it in an isolated Node script against a
constructed scenario matching the bug.

- Read the function's real text out of the file (e.g. by locating
  `function name(` and matching braces, or just `Read`-ing the relevant
  lines directly).
- Build the smallest fake environment the function needs (a mock `grid`
  array, fake tile objects with a `.el.style.setProperty` stub, whatever
  globals it touches). Keep it minimal — only what the function actually
  reads or calls.
- Construct the *exact* failure scenario from the bug report (e.g. a column
  with a real gap under a tile), not a generic happy-path case.
- Run it and assert the invariant that should hold afterward (e.g. "no tile
  has an empty cell directly beneath it").
- **Also run the same scenario against the old (pre-fix) version**, pulled
  via `git show HEAD:game.js`. If the old version doesn't actually reproduce
  the bug, the diagnosis is wrong — go back and re-diagnose before shipping
  anything. If it does reproduce and the new version doesn't, that's real
  confirmation, not a guess.

Example from the floating-tile gravity fix (2026-07-30): extracted
`applyGravity()` and `forceUnlockBoard()` verbatim from `game.js`, built a
grid with an isolated tile sitting above several truly-empty rows (the exact
shape from the user's screenshot), ran it against the last commit's
`forceUnlockBoard()` (bug reproduced — tile stayed floating) and against the
new one (invariant held, DOM resynced). Both runs used the literal function
text from the file, not a paraphrase.

### 2. Pure math / geometry bugs (coordinate mapping, scaling, layout)

A standalone numeric model is enough — plug in representative real numbers
(actual device dimensions, actual CSS values) and confirm the magnitude of
the error matches what was reported, and that the fixed formula produces
zero (or near-zero) error. This is faster than a full extraction when the
bug is "this formula produces the wrong number," not "this function mutates
state incorrectly."

Example: the swipe-trail canvas bug — modeled the canvas-buffer-vs-CSS-size
mismatch numerically, confirmed the predicted offset (~8-9% of board height)
matched the screenshot before touching any code.

### 3. Rendering / visual output (SVG art, generated images, CSS)

Actually render it and look at the pixels — don't just read the markup and
assume it's right. This caught two real bugs during icon design work
(`feGaussianBlur` silently not rendering, and a gradient-filled path
painting its bounding box instead of clipping to the curve) that would have
shipped invisibly otherwise.

- Render to a real file (`cairosvg`, etc.) at the actual target resolution.
- View it.
- For anything that will be shown small (app icons, tile art), also render
  a downscaled version at the actual display size and view that too —
  something can look fine at 1024px and be illegible at 60px.

### 4. What Node-level testing can't cover — say so explicitly

Real device/WKWebView touch timing, animation jank under load, Safari-only
CSS quirks, and anything that depends on actual user interaction timing
cannot be verified in this environment. When a fix touches one of those,
say plainly that it's untested beyond static analysis, and that real
verification requires the person to run it on device — don't imply a
confidence level the verification didn't earn.

### 5. Native Swift/Xcode code — no compiler available at all

This environment has no Xcode, no Swift toolchain that knows about
`Capacitor`/`GameKit`/`UIKit`, and no simulator/device. For a native file
like `GameCenterPlugin.swift`, "verification" means: manually balance-check
braces/parens, and confirm every unfamiliar or infrequently-used API call
(exact init signatures, parameter labels, class vs. instance methods)
against Apple's current developer documentation via web search rather than
recalling it from memory — memory of API surfaces can be stale or subtly
wrong in ways that only show up as a compile error. This is real but
partial verification: it catches wrong-API and syntax mistakes, not logic
bugs, and none of it substitutes for actually building the target in Xcode.
Say so explicitly rather than implying the file was "tested."

Example from the Game Center integration (2026-07-31): looked up
`GKGameCenterViewController(leaderboardID:playerScope:timeScope:)`,
`GKLeaderboard.submitScore(...)`, and the Game Center entitlement
requirement directly against developer.apple.com and capacitorjs.com rather
than assuming; used trailing-closure syntax on `GKAchievement.report(...)`
specifically to sidestep uncertainty about the exact completion-handler
parameter label, since trailing closures don't require the label to match.

### 6. Full end-to-end runs — real browser DOM, not just mocked functions

Extraction tests (sections 1-5) mock out everything a function calls, which
means they can't catch a bug in the *interaction* between two real functions
— only in one function's isolated logic. For that, run the actual unmodified
`index.html`/`game.js`/`dictionary.js`/`audio.js` in a real DOM via
[jsdom](https://github.com/jsdom/jsdom) (no Xcode/Simulator available in
this environment, and no root access to install a real headless browser's
system dependencies — jsdom needs neither) and drive it with real touch
events, exactly as a player would.

How, concretely (see `/tmp` or session outputs for a throwaway harness,
not part of the repo):
- Read the real `index.html`, strip the `<script type="module">` tag, and
  inject a classic `<script>` built by concatenating the real
  `dictionary.js` + `audio.js` + `game.js` with only their `import`/`export`
  lines stripped (jsdom's ES module support is unreliable; string-splicing
  the import/export lines is the only non-behavioral change made).
- Override `Element.prototype.getBoundingClientRect()` for `#tile-matrix`/
  `#game-board` and `.tile` elements to compute the same rects the real CSS
  transform (`translate3d(col*100%, (ROWS-1-row)*100%, 0)`) would produce —
  jsdom doesn't run a layout engine, so without this `coordToGrid()` can't
  work.
- **Dispatch real `touchstart`/`touchmove`/`touchend` events, not mouse
  events.** jsdom defines `ontouchstart` on `window` (even without full
  touch support), so the game's own `isTouchDevice` feature-detect picks
  the touch code path — same as a real phone. Simulating mouse events
  instead silently attaches to the wrong (never-fired) listeners with zero
  error, which looks exactly like "nothing happened" and wastes time
  debugging the wrong layer.
- Find real words to swipe by reading actual rendered tile letters from the
  DOM and checking them against the game's own fallback word list (seeded
  synchronously in `dictionary.js`'s constructor, so it's ready before
  `validator.init()`'s fetch — which fails harmlessly in jsdom since
  `fetch` isn't defined — ever resolves).
- Read results back from the DOM only (tile count, `#score-val` text,
  presence of specific CSS classes like `.word-burst-ring.glow`,
  `.tile-glow`) — never from JS-internal state, which isn't reachable
  from Node once `import`/`export` are stripped anyway, and DOM state is
  what a real player/tester would actually observe.
- If a mechanic needs several game-minutes of real play to reach naturally
  (e.g. a rarely-spawning tile, or reaching a certain level), it's fine to
  tune a *few explicit, named constants* in an in-memory copy of `game.js`
  for speed/determinism — never the algorithm itself, and never write the
  patched copy back to disk. Document exactly which constants were tuned
  and why in the test script itself.

This caught a real, pre-existing, previously-unnoticed production bug
(2026-07-31): `showWordClearPopup()`'s floating "+N" score number
unconditionally called `calculateWordScore()` even when passed a
placeholder anchor like `{ el: boardEl }` (used by `triggerHint()`,
`triggerVortex()`, `checkLevelProgression()`, and `selectLevel()` for
generic status messages with no real tile to anchor to). That placeholder
has no `.letter`, so `calculateWordScore()` threw on `undefined.length` —
uncaught, since `showWordClearPopup()` is called synchronously with no
surrounding try/catch from those call sites. Concretely, leveling up on
the exact word that triggered the level-up would throw inside
`checkLevelProgression()` (called from `updateScore()`, called from
`sliceClearWord()`), skipping every line after it in that word-clear call
— including the `setTimeout` that runs `applyGravity()`/
`resolveBoardCascades()` — leaving the board stuck locked until the 2s
watchdog force-recovered it. No Node-level extraction test caught this,
because every extraction test up to that point mocked `showWordClearPopup`
as a no-op rather than running its real body. Fixed by only building the
floating score popup when `anchorTile.letter` is actually present.

A second real bug this same methodology caught (2026-07-31, reported by the
user from actual device play as "the whole row is not bursting"): the
Glow Tile feature's real usage — `sliceClearWord({ word, tiles: path })` in
`swipeFinish()` — never included a `direction` field, even though both
`findGlowTileInLine()` and `triggerRowColumnBurst()` branch on
`match.direction === "horizontal"` to decide whether to scan/detonate a row
or a column. `undefined !== "horizontal"` is falsy, so every real player
swipe — horizontal or vertical — silently fell into the "vertical" branch.
A horizontal word could still correctly *find* a glow tile in its row (the
detection scan doesn't depend on direction being right), but the burst
itself would then try to clear a *column* instead of the row that was
actually swiped — which looks exactly like "the row isn't bursting" from
the player's side, since nothing visibly happens along the row itself.
Every earlier extraction test for this feature passed, because those tests
all constructed the `match` object by hand with `direction` set correctly
— none of them exercised the actual `swipeFinish()` call site. Only a real
end-to-end swipe through the genuine game path exposed it. Fixed by
deriving `direction` from the swipe path's own first two tiles right
before calling `sliceClearWord()` (the path is already locked to one axis
during swiping, so this is always correct, not a guess).

## Sync direction

The App Store build (`ios/App/App/public/`) is the source of truth once
it's been the one actually archived and submitted — not the other way
around. Before starting new work, diff root, `www/`, and
`ios/App/App/public/` to confirm they agree. After any change, propagate
identically to all three and re-diff to confirm zero drift before calling
it done.
