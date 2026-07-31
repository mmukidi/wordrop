/**
 * game.js
 * Core game loop, event handling, logic, and rendering for Wordrop.
 */

import { validator } from "./dictionary.js";
import { audio } from "./audio.js";

// Global Production Error Catchers for Sentry.io
window.addEventListener("error", (event) => {
    console.error("[Wordrop Global Error Caught]", event.error || event.message);
    if (window.Sentry && typeof Sentry.captureException === "function") {
        Sentry.captureException(event.error || new Error(event.message));
    }
});

window.addEventListener("unhandledrejection", (event) => {
    console.error("[Wordrop Unhandled Rejection]", event.reason);
    if (window.Sentry && typeof Sentry.captureException === "function") {
        Sentry.captureException(event.reason);
    }
});

// Game Constants
const GRID_COLS = 8;
const GRID_ROWS = 14;
const START_ROWS = 4;
const SWIPE_THRESHOLD = 25; // px

// Letter distribution & points (Scrabble weighted)
const WEIGHTED_LETTERS = 
    "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTTTTLLLLSSSSUUUDDDDGGGBBCCMMMPPFFHHHVVWWYYKJXZQZ";
const TILE_VALUES = {
    A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:3, I:1, J:6, K:6, L:2, M:2,
    N:1, O:1, P:3, Q:9, R:1, S:1, T:1, U:1, V:4, W:4, X:8, Y:4, Z:9
};

// Game Center leaderboard/achievement IDs — must match what's configured
// in App Store Connect exactly (see GAME_CENTER_SETUP.md).
const GC_LEADERBOARD_HIGH_SCORE = "wordrop_high_score";
const GC_ACH_FIRST_WORD = "wordrop_first_word";
const GC_ACH_LEVEL_5 = "wordrop_level_5";
const GC_ACH_LEVEL_10 = "wordrop_level_10";
const GC_ACH_CENTURY = "wordrop_century";
const GC_ACH_WORDSMITH = "wordrop_wordsmith";

// Glow Tiles — normal tiles (fall/shuffle/swap exactly like any other
// tile) that additionally carry a threshold number badge. Any single word
// cleared anywhere in that tile's row or column, scoring at least its
// threshold, detonates the *entire* row or column (the glow tile
// included) for a big bonus. This is deliberately the first of several
// "one new toy per level" mechanics — see BACKLOG.md — rather than only
// ramping difficulty via drop speed. Available from level 1 onward.
const GLOW_TILE_UNLOCK_LEVEL = 1;
const GLOW_TILE_SPAWN_CHANCE = 0.12; // per new bottom-row tile spawned
const MAX_GLOW_TILES_ON_BOARD = 3;   // cap so the board never gets clogged
const GLOW_TILE_BURST_BONUS = 25;    // flat bonus on top of tile values cleared

// State Variables
let grid = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(null));
let score = 0;
let highScore = 0;
let level = 1;
let wordsClearedCount = 0;
let isPlaying = false;
let isPaused = false;
let isBoardLocked = false;
let tileIdCounter = 0;
let lockWatchdogTimer = null;

function setBoardLock(locked) {
    isBoardLocked = locked;
    if (lockWatchdogTimer) clearTimeout(lockWatchdogTimer);

    if (locked) {
        // Watchdog: If board stays locked for > 2.0s, force unlock to guarantee no freezing
        lockWatchdogTimer = setTimeout(() => {
            if (isBoardLocked) {
                console.warn("[Wordrop Watchdog] Board locked state timed out. Forcing unlock.");
                forceUnlockBoard();
            }
        }, 2000);
    }
}

function forceUnlockBoard() {
    isBoardLocked = false;
    isSwipingPath = false;
    swipePath = [];
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Clear stuck CSS classes across all tiles
    if (boardEl) {
        boardEl.querySelectorAll(".tile.swapping, .tile.selected, .tile.dragging").forEach(el => {
            el.classList.remove("swapping", "selected", "dragging");
        });
    }

    // This function fires whenever normal flow gets interrupted mid-animation
    // (an error, or the 2s watchdog above) — at exactly the moment a word
    // clear/rise/swap may have left the grid mid-fall. Without this, tiles
    // can be left visually "floating" with empty rows beneath them until an
    // unrelated later event happens to trigger gravity again. Reconcile the
    // grid and resync every tile's DOM position now so that never lingers.
    applyGravity();
    if (typeof grid !== "undefined") {
        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                const tile = grid[y][x];
                if (tile && tile.el) {
                    tile.el.style.setProperty("--row", tile.y);
                    tile.el.style.setProperty("--col", tile.x);
                }
            }
        }
    }
}

// Grid Rise Timer State
let riseProgress = 0; // 0 to 100
let riseTimerInterval = null;
const LEVEL_SPEEDS = {
    1: 15.0, // Level 1: 15s per row
    2: 12.0, // Level 2: 12s per row (-3s)
    3: 9.0,  // Level 3: 9s per row (-3s)
    4: 6.0,  // Level 4: 6s per row (-3s)
    5: 4.5,  // Level 5: 4.5s per row
    6: 3.5,  // Level 6: 3.5s per row
    7: 3.0,  // Level 7: 3.0s per row
    8: 2.5,  // Level 8: 2.5s per row
    9: 2.0,  // Level 9: 2.0s per row
    10: 1.5  // Level 10: 1.5s per row (HARD MODE!)
};

function getLevelMultiplier(lvl) {
    // Level 1 = 1.0x, Level 2 = 1.5x (+50%), Level 3 = 2.0x (+100%), Level 4 = 2.5x (+150%)...
    return 1 + (lvl - 1) * 0.5;
}

// Powerups state
let shuffleCooldownActive = false;
const SHUFFLE_COOLDOWN_MS = 20000; // 20s

// Pointer & Swipe Trail state
let swipePath = []; // Array of active tile objects in swipe path
let isSwipingPath = false;
let canvas = null;
let ctx = null;
let activeMatches = []; // Words currently highlighted on grid

// DOM Element References (Initialized dynamically in initDOMElements)
let boardEl, tileMatrixEl, scoreValEl, highScoreValEl, levelValEl, timerBarEl, timerCountdownEl;
let btnShuffle, shuffleCooldownEl, btnHint, btnVortex, btnStats, btnPause, btnSound, btnInfo, btnRestart, levelBtn;
let lastWordTextEl, lastWordScoreEl, pauseOverlay, btnResume, gameOverOverlay, finalScoreEl, finalLevelEl, finalWordsCountEl, btnPlayAgain;
let infoOverlay, btnCloseInfo, statsOverlay, btnCloseStats, levelSelectOverlay, btnCloseLevelSelect;
let statsWordsCountEl, statsLongestWordEl, statsRareCountEl, statsHighScoreEl, comboBadge, wordPopup;

// Gamer Stats Tracking
let longestWordSpelled = "—";
let rareTilesClearedCount = 0;

function initDOMElements() {
    boardEl = document.getElementById("game-board");
    tileMatrixEl = document.getElementById("tile-matrix") || boardEl;
    scoreValEl = document.getElementById("score-val");
    highScoreValEl = document.getElementById("high-score-val");
    levelValEl = document.getElementById("level-val");
    timerBarEl = document.getElementById("timer-bar");
    timerCountdownEl = document.getElementById("timer-countdown-val");

    btnShuffle = document.getElementById("btn-shuffle");
    shuffleCooldownEl = document.getElementById("shuffle-cooldown");
    btnHint = document.getElementById("btn-hint");
    btnVortex = document.getElementById("btn-vortex");
    btnStats = document.getElementById("btn-stats");
    btnPause = document.getElementById("btn-pause");
    btnSound = document.getElementById("btn-sound");
    btnInfo = document.getElementById("btn-info");
    btnRestart = document.getElementById("btn-restart");
    levelBtn = document.getElementById("level-btn");

    lastWordTextEl = document.getElementById("last-word-text");
    lastWordScoreEl = document.getElementById("last-word-score");

    pauseOverlay = document.getElementById("pause-overlay");
    btnResume = document.getElementById("btn-resume");
    gameOverOverlay = document.getElementById("game-over-overlay");
    finalScoreEl = document.getElementById("final-score");
    finalLevelEl = document.getElementById("final-level");
    finalWordsCountEl = document.getElementById("final-words-count");
    btnPlayAgain = document.getElementById("btn-play-again");

    infoOverlay = document.getElementById("info-overlay");
    btnCloseInfo = document.getElementById("btn-close-info");
    statsOverlay = document.getElementById("stats-overlay");
    btnCloseStats = document.getElementById("btn-close-stats");
    levelSelectOverlay = document.getElementById("level-select-overlay");
    btnCloseLevelSelect = document.getElementById("btn-close-level-select");

    statsWordsCountEl = document.getElementById("stats-words-count");
    statsLongestWordEl = document.getElementById("stats-longest-word");
    statsRareCountEl = document.getElementById("stats-rare-count");
    statsHighScoreEl = document.getElementById("stats-high-score");
    gamerTagInput = document.getElementById("gamer-tag-input");

    comboBadge = document.getElementById("combo-badge");
    wordPopup = document.getElementById("word-popup");
}

let gamerTagInput;
let gamerTag = localStorage.getItem("wordrop_gamer_tag") || ("WordRunner_" + Math.floor(1000 + Math.random() * 9000));
localStorage.setItem("wordrop_gamer_tag", gamerTag);

/* --- Game Center Integration ---
 * Every function here is deliberately fire-and-forget and fails silently:
 * Game Center is a bonus feature layered on top of the game, never a
 * dependency of it. On the website (no Capacitor) or if a player declines
 * Game Center sign-in, every gc* call below is a safe no-op so gameplay is
 * never blocked or slowed down by it.
 */

function gcPlugin() {
    return (
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === "function" &&
        window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.GameCenter
    ) || null;
}

function gcAuthenticate() {
    const gc = gcPlugin();
    if (!gc) return;
    gc.authenticate().catch(err => console.warn("[GameCenter] authenticate failed:", err));
}

function gcSubmitScore(value) {
    const gc = gcPlugin();
    if (!gc || !value) return;
    gc.submitScore({ leaderboardID: GC_LEADERBOARD_HIGH_SCORE, score: value })
        .catch(err => console.warn("[GameCenter] submitScore failed:", err));
}

function gcUnlockAchievement(achievementID) {
    const gc = gcPlugin();
    if (!gc) return;
    gc.unlockAchievement({ achievementID })
        .catch(err => console.warn("[GameCenter] unlockAchievement failed:", err));
}

function gcUpdateAchievementProgress(achievementID, percentComplete) {
    const gc = gcPlugin();
    if (!gc) return;
    const clamped = Math.max(0, Math.min(100, percentComplete));
    gc.updateAchievementProgress({ achievementID, percentComplete: clamped })
        .catch(err => console.warn("[GameCenter] updateAchievementProgress failed:", err));
}

// One-time-per-device achievement unlocks. GameKit itself is idempotent
// (re-unlocking an already-unlocked achievement is a harmless no-op), but
// gating locally avoids firing a native call on every single word/level.
function gcUnlockOnce(localStorageKey, achievementID) {
    if (localStorage.getItem(localStorageKey)) return;
    localStorage.setItem(localStorageKey, "1");
    gcUnlockAchievement(achievementID);
}

// Called every time a word is cleared, regardless of game mode/level, to
// drive the lifetime (cross-session) achievements. wordsClearedCount below
// resets every run, so lifetime totals need their own persisted counter.
function gcRecordWordCleared(word) {
    const lifetimeWords = (parseInt(localStorage.getItem("wordrop_lifetime_words_cleared")) || 0) + 1;
    localStorage.setItem("wordrop_lifetime_words_cleared", lifetimeWords);
    gcUpdateAchievementProgress(GC_ACH_CENTURY, (lifetimeWords / 100) * 100);

    gcUnlockOnce("wordrop_ach_first_word_done", GC_ACH_FIRST_WORD);

    if (word && word.length >= 7) {
        gcUnlockOnce("wordrop_ach_wordsmith_done", GC_ACH_WORDSMITH);
    }
}

/* --- Initialization --- */

async function initGame() {
    initDOMElements();
    highScore = parseInt(localStorage.getItem("wordrop_high_score")) || 0;
    if (highScoreValEl) highScoreValEl.textContent = formatScore(highScore);

    // Sync Gamer Tag with input field only.
    // NOTE: deliberately NOT attached to Sentry.setUser() — gamerTag is
    // free-text the player can set to anything, including their real name,
    // and our privacy policy promises anonymous crash telemetry. Attaching
    // a user-editable identifier to error reports would both contradict
    // that promise and pull avoidable PII into a third-party service.
    if (gamerTagInput) gamerTagInput.value = gamerTag;

    // Initialize Swipe Canvas
    canvas = document.getElementById("swipe-canvas");
    if (canvas) {
        ctx = canvas.getContext("2d");
        resizeSwipeCanvas();

        // Keep the canvas's drawing buffer in lockstep with its actual
        // rendered size at all times. A single resize-on-load is not
        // enough: on iOS WKWebView, web fonts finish loading and safe-area
        // insets settle AFTER this point, which reflows the board's
        // aspect-ratio-based height without ever firing a window "resize"
        // event. If the canvas buffer is stamped with a stale size, every
        // point drawn on it gets silently rescaled to the wrong place,
        // which is exactly why swipe trails render far from the tiles
        // that were actually swiped.
        if (window.ResizeObserver) {
            const canvasResizeObserver = new ResizeObserver(() => resizeSwipeCanvas());
            canvasResizeObserver.observe(tileMatrixEl);
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(resizeSwipeCanvas).catch(() => {});
        }
    }

    // Initialize Dictionary async
    validator.init().catch(err => console.warn("Dictionary async init fallback:", err));

    // Attach Event Listeners
    setupEventListeners();

    // Sign into Game Center in the background — never blocks game start,
    // and is a total no-op on the website build (see gcPlugin()).
    gcAuthenticate();

    // Start Game
    startGame();
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initGame);
} else {
    initGame();
}

function resizeSwipeCanvas() {
    if (!canvas) return;
    // The canvas element's CSS box (width/height: 100%) is sized relative
    // to its actual parent, #tile-matrix — NOT #game-board, which is 22px
    // taller because it also contains the floor bar. Sizing the drawing
    // buffer from boardEl instead of tileMatrixEl silently stretches/
    // squashes everything drawn on the canvas relative to where the real
    // tiles (positioned via getBoundingClientRect against boardEl) sit.
    const target = tileMatrixEl || boardEl;
    const w = target.clientWidth;
    const h = target.clientHeight;
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        // Buffer just got wiped by the resize — redraw the active path
        // immediately so an in-progress swipe doesn't flash empty.
        if (isSwipingPath && swipePath.length > 0) drawSwipePath();
    }
}
window.addEventListener("resize", resizeSwipeCanvas);

// Render geometric path connecting selected tile centers
function drawSwipePath() {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (swipePath.length < 2) return;

    ctx.beginPath();
    const p0 = getTileCenter(swipePath[0]);
    ctx.moveTo(p0.x, p0.y);

    for (let i = 1; i < swipePath.length; i++) {
        const p = getTileCenter(swipePath[i]);
        ctx.lineTo(p.x, p.y);
    }

    // Outer glow
    ctx.strokeStyle = "rgba(0, 240, 255, 0.85)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#bd00ff";
    ctx.stroke();

    // Inner bright core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
}

function getTileCenter(tile) {
    if (!tile || !tile.el) return { x: 0, y: 0 };
    const rect = tile.el.getBoundingClientRect();
    const parentRect = boardEl.getBoundingClientRect();
    return {
        x: rect.left - parentRect.left + (rect.width / 2),
        y: rect.top - parentRect.top + (rect.height / 2)
    };
}

function setupEventListeners() {
    // Game controls
    btnPause.addEventListener("click", togglePause);
    btnResume.addEventListener("click", togglePause);
    btnRestart.addEventListener("click", () => {
        audio.playClick();
        startGame();
    });
    btnPlayAgain.addEventListener("click", () => {
        audio.playClick();
        startGame();
    });
    
    btnSound.addEventListener("click", () => {
        const soundOn = audio.toggle();
        btnSound.textContent = soundOn ? "🔊" : "🔇";
        audio.playClick();
    });

    if (levelBtn) levelBtn.addEventListener("click", openLevelSelectModal);
    if (btnCloseLevelSelect) btnCloseLevelSelect.addEventListener("click", closeLevelSelectModal);

    if (gamerTagInput) {
        gamerTagInput.addEventListener("change", (e) => {
            const newTag = e.target.value.trim() || ("WordRunner_" + Math.floor(1000 + Math.random() * 9000));
            gamerTag = newTag;
            localStorage.setItem("wordrop_gamer_tag", gamerTag);
            // Not sent to Sentry — see note in initGame().
        });
    }

    document.querySelectorAll(".level-select-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const chosenLvl = e.currentTarget.dataset.lvl;
            selectLevel(chosenLvl);
        });
    });

    btnShuffle.addEventListener("click", triggerShuffle);
    btnHint.addEventListener("click", triggerHint);
    if (btnVortex) btnVortex.addEventListener("click", triggerVortex);
    if (btnInfo) btnInfo.addEventListener("click", openInfoModal);
    if (btnCloseInfo) btnCloseInfo.addEventListener("click", closeInfoModal);
    if (btnStats) btnStats.addEventListener("click", openStatsModal);
    if (btnCloseStats) btnCloseStats.addEventListener("click", closeStatsModal);

    // ========================================================================
    // GROUND-UP TOUCH/SWIPE SYSTEM (v2 — rebuilt for iOS WKWebView + Desktop)
    // ========================================================================
    // Strategy: Use native touch events as PRIMARY input on touch devices.
    // Fall back to mouse events on desktop. Avoid pointer events entirely
    // because iOS WKWebView fires both touch* and pointer* for the same
    // finger, causing double-handling and coordinate mismatches.
    //
    // All hit-testing uses pure mathematical coordinate→grid mapping.
    // No elementFromPoint, no e.target.closest, no setPointerCapture.
    // ========================================================================

    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    if (isTouchDevice) {
        boardEl.addEventListener("touchstart", handleTouchStart, { passive: false });
        boardEl.addEventListener("touchmove",  handleTouchMove,  { passive: false });
        boardEl.addEventListener("touchend",   handleTouchEnd,   { passive: false });
        boardEl.addEventListener("touchcancel", handleTouchEnd,  { passive: false });
    } else {
        boardEl.addEventListener("mousedown", handleMouseDown);
        boardEl.addEventListener("mousemove", handleMouseMove);
        boardEl.addEventListener("mouseup",   handleMouseUp);
        boardEl.addEventListener("mouseleave", handleMouseUp);
    }
}

function openLevelSelectModal() {
    audio.playClick();
    if (levelSelectOverlay) levelSelectOverlay.classList.remove("hidden");
}

function closeLevelSelectModal() {
    audio.playClick();
    if (levelSelectOverlay) levelSelectOverlay.classList.add("hidden");
}

function selectLevel(targetLvl) {
    level = parseInt(targetLvl) || 1;
    levelValEl.textContent = level;
    
    document.querySelectorAll(".level-select-btn").forEach(btn => {
        if (parseInt(btn.dataset.lvl) === level) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    audio.playLevelUp();
    showWordClearPopup(`LEVEL ${level} SELECTED!`, { el: boardEl });

    riseProgress = 0;
    if (timerBarEl) timerBarEl.style.width = "0%";
    startRiseTimer();
    closeLevelSelectModal();
}

function openInfoModal() {
    audio.playClick();
    if (infoOverlay) infoOverlay.classList.remove("hidden");
}

function closeInfoModal() {
    audio.playClick();
    if (infoOverlay) infoOverlay.classList.add("hidden");
}

/* --- Gameplay Loop & Core Logic --- */

function getTileMatrixContainer() {
    return document.getElementById("tile-matrix") || document.getElementById("game-board") || boardEl;
}

function startGame() {
    // Reset scores & states
    score = 0;
    level = 1;
    wordsClearedCount = 0;
    longestWordSpelled = "—";
    isPlaying = true;
    isPaused = false;
    forceUnlockBoard();
    riseProgress = 0;
    tileIdCounter = 0;
    shuffleCooldownActive = false;
    swipePath = [];
    isSwipingPath = false;
    activeMatches = [];
    resizeSwipeCanvas();

    if (scoreValEl) scoreValEl.textContent = formatScore(score);
    if (levelValEl) levelValEl.textContent = level;
    if (timerBarEl) timerBarEl.style.width = "0%";
    if (boardEl) boardEl.classList.remove("danger");

    // Reset HUD Spelled Word indicators
    if (lastWordTextEl) lastWordTextEl.textContent = "—";
    if (lastWordScoreEl) lastWordScoreEl.textContent = "";

    if (btnShuffle) btnShuffle.disabled = false;
    if (shuffleCooldownEl) shuffleCooldownEl.style.width = "0%";
    
    // Hide Overlays
    if (pauseOverlay) pauseOverlay.classList.add("hidden");
    if (gameOverOverlay) gameOverOverlay.classList.add("hidden");
    if (comboBadge) comboBadge.classList.add("hidden");
    if (wordPopup) wordPopup.classList.add("hidden");

    // Clear Board DOM & Matrix
    const container = getTileMatrixContainer();
    if (container) {
        container.querySelectorAll(".tile").forEach(t => t.remove());
    }
    if (boardEl) {
        boardEl.querySelectorAll(".tile").forEach(t => t.remove());
    }
    grid = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(null));

    // Spawn Starting Board (4 rows)
    for (let y = 0; y < START_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            spawnTile(x, y);
        }
    }

    // Safety Verification Check: If 0 tiles exist, force emergency spawn
    const createdTiles = (container || boardEl).querySelectorAll(".tile");
    if (createdTiles.length === 0) {
        console.warn("Emergency: 0 tiles found after spawn. Forcing emergency board generation.");
        for (let y = 0; y < START_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                spawnTile(x, y);
            }
        }
    }

    // Resolve any starting words immediately without scoring
    resolveInitialMatches();

    // Start Rise Timer
    startRiseTimer();
}

function spawnTile(x, y, forcedLetter = null, isGlow = false, burstValue = null) {
    const parentContainer = getTileMatrixContainer();
    if (!parentContainer) return;

    const letter = forcedLetter || getRandomLetter();
    const value = TILE_VALUES[letter];

    // Determine rarity class
    let rarityClass = "tile-common";
    if (value >= 5) rarityClass = "tile-rare";
    else if (value >= 2) rarityClass = "tile-uncommon";

    // Create element
    const tileEl = document.createElement("div");
    tileEl.className = `tile ${rarityClass}${isGlow ? " tile-glow" : ""}`;
    tileEl.style.setProperty("--col", x);
    tileEl.style.setProperty("--row", y);

    const id = tileIdCounter++;
    tileEl.dataset.id = id;

    // Create interior layout. Glow tiles get an extra badge showing their
    // burst threshold, opposite corner from the normal per-letter value.
    // Otherwise a glow tile is a completely normal tile — it falls,
    // shuffles, and swaps exactly like any other (see GLOW_TILE_UNLOCK_LEVEL
    // comment above for why it's deliberately NOT immovable).
    tileEl.innerHTML = `
        <div class="tile-inner">
            ${isGlow ? `<span class="tile-burst-badge">⚡${burstValue}</span>` : ""}
            <span class="tile-letter">${letter}</span>
            <span class="tile-value">${value}</span>
        </div>
    `;

    parentContainer.appendChild(tileEl);

    // Save in matrix
    grid[y][x] = {
        id: id,
        letter: letter,
        value: value,
        x: x,
        y: y,
        el: tileEl,
        glow: isGlow,
        burstValue: isGlow ? burstValue : null
    };
}

// Whether the next spawned tile in a rising row should be a glow tile —
// gated by level unlock, a flat per-tile chance, and a board-wide cap so
// glow tiles stay a spotlight moment rather than clutter.
function shouldSpawnGlowTile() {
    if (level < GLOW_TILE_UNLOCK_LEVEL) return false;
    if (countGlowTilesOnBoard() >= MAX_GLOW_TILES_ON_BOARD) return false;
    return Math.random() < GLOW_TILE_SPAWN_CHANCE;
}

function countGlowTilesOnBoard() {
    let count = 0;
    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            if (grid[y][x] && grid[y][x].glow) count++;
        }
    }
    return count;
}

// Threshold scales gently with level so later levels ask a bit more of a
// single word to trigger a burst. A first-pass tuning value, easy to adjust.
function rollGlowThreshold() {
    return 5 + Math.floor(Math.random() * 6) + Math.floor(level / 3);
}

function getRandomLetter() {
    const index = Math.floor(Math.random() * WEIGHTED_LETTERS.length);
    return WEIGHTED_LETTERS[index];
}

// Make sure initial starting board doesn't contain pre-formed words
function resolveInitialMatches() {
    let resolving = true;
    let safeguard = 0;

    while (resolving && safeguard < 10) {
        let { matches } = scanForWords();
        if (matches.length === 0) {
            resolving = false;
        } else {
            // Re-roll the tiles in the matches
            matches.forEach(m => {
                m.tiles.forEach(tile => {
                    const newLetter = getRandomLetter();
                    tile.letter = newLetter;
                    tile.value = TILE_VALUES[newLetter];
                    
                    // Rebuild inner HTML and classes
                    let rarityClass = "tile-common";
                    if (tile.value >= 5) rarityClass = "tile-rare";
                    else if (tile.value >= 2) rarityClass = "tile-uncommon";
                    
                    tile.el.className = `tile ${rarityClass}`;
                    tile.el.querySelector(".tile-letter").textContent = newLetter;
                    tile.el.querySelector(".tile-value").textContent = tile.value;
                });
            });
            safeguard++;
        }
    }
}

// ========================================================================
// COORDINATE → GRID MAPPING (Pure Math, No DOM Hit-Testing)
// ========================================================================
//
// Tile CSS positioning:
//   width:  calc(100% / 8)   → tileWidth  = matrixWidth  / 8
//   height: calc(100% / 14)  → tileHeight = matrixHeight / 14
//   transform: translate3d(col * 100%, (13 - row) * 100%, 0)
//
// So visually:
//   Column c occupies X range: [c * tileWidth, (c+1) * tileWidth)
//   Row r occupies Y range from top: [(13-r) * tileHeight, (14-r) * tileHeight)
//
// To convert touch (clientX, clientY) → (col, row):
//   relX = clientX - matrixRect.left
//   relY = clientY - matrixRect.top
//   col = floor(relX / tileWidth)              → 0..7
//   visualRow = floor(relY / tileHeight)       → 0..13 (0 = top)
//   gameRow = 13 - visualRow                   → 13..0 (13 = top)
// ========================================================================

function coordToGrid(clientX, clientY) {
    const matrix = document.getElementById("tile-matrix");
    if (!matrix) return null;

    const rect = matrix.getBoundingClientRect();

    // Reject touches outside the tile matrix
    if (clientX < rect.left || clientX >= rect.right ||
        clientY < rect.top  || clientY >= rect.bottom) {
        return null;
    }

    const relX = clientX - rect.left;
    const relY = clientY - rect.top;

    const tileW = rect.width  / GRID_COLS;   // 8 columns
    const tileH = rect.height / GRID_ROWS;   // 14 rows

    const col = Math.min(Math.floor(relX / tileW), GRID_COLS - 1);
    const visualRow = Math.min(Math.floor(relY / tileH), GRID_ROWS - 1);
    const row = (GRID_ROWS - 1) - visualRow;   // flip: top visual = row 13

    // Return the tile object at this grid cell (may be null if cell is empty)
    return grid[row] && grid[row][col] ? grid[row][col] : null;
}

// ========================================================================
// TOUCH EVENT HANDLERS (iOS WKWebView — uses e.touches[0])
// ========================================================================

function handleTouchStart(e) {
    if (!isPlaying || isPaused || isBoardLocked) return;
    e.preventDefault();   // block iOS scroll/zoom

    const t = e.touches[0];
    swipeBegin(t.clientX, t.clientY);
}

function handleTouchMove(e) {
    if (!isSwipingPath) return;
    e.preventDefault();

    const t = e.touches[0];
    swipeContinue(t.clientX, t.clientY);
}

function handleTouchEnd(e) {
    if (!isSwipingPath) return;
    e.preventDefault();
    swipeFinish();
}

// ========================================================================
// MOUSE EVENT HANDLERS (Desktop fallback)
// ========================================================================

let mouseIsDown = false;

function handleMouseDown(e) {
    if (!isPlaying || isPaused || isBoardLocked) return;
    mouseIsDown = true;
    swipeBegin(e.clientX, e.clientY);
}

function handleMouseMove(e) {
    if (!mouseIsDown || !isSwipingPath) return;
    swipeContinue(e.clientX, e.clientY);
}

function handleMouseUp(e) {
    if (!mouseIsDown) return;
    mouseIsDown = false;
    swipeFinish();
}

// ========================================================================
// UNIFIED SWIPE LOGIC (shared by touch & mouse handlers)
// ========================================================================

function swipeBegin(clientX, clientY) {
    // Cheap safety net: if any tile was left floating by an interrupted
    // animation (see forceUnlockBoard), settle it before resolving what the
    // player is touching. A no-op when the board is already stable.
    applyGravity();

    // Clear previous path
    boardEl.querySelectorAll(".tile.selected").forEach(el => el.classList.remove("selected"));
    swipePath = [];
    isSwipingPath = false;

    // Unmute AudioContext on first interaction
    audio.init();

    const tile = coordToGrid(clientX, clientY);
    if (!tile) return;

    isSwipingPath = true;
    swipePath.push(tile);
    tile.el.classList.add("selected");
    audio.playClick();
    drawSwipePath();
}

function swipeContinue(clientX, clientY) {
    const tile = coordToGrid(clientX, clientY);
    if (!tile) return;

    const last = swipePath[swipePath.length - 1];
    if (tile.id === last.id) return;   // still on same tile

    // Backtrack: dragging back reverses the path
    if (swipePath.length >= 2 && tile.id === swipePath[swipePath.length - 2].id) {
        const removed = swipePath.pop();
        removed.el.classList.remove("selected");
        audio.playClick();
        drawSwipePath();
        return;
    }

    // No loops
    if (swipePath.some(t => t.id === tile.id)) return;

    // Must be orthogonally adjacent (no diagonals)
    const dx = Math.abs(tile.x - last.x);
    const dy = Math.abs(tile.y - last.y);
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) return;

    // Straight-line lock: after 2 tiles, path is locked to one axis
    if (swipePath.length >= 2) {
        const first  = swipePath[0];
        const second = swipePath[1];
        const horizontal = (first.y === second.y);
        if (horizontal && tile.y !== first.y) return;
        if (!horizontal && tile.x !== first.x) return;
    }

    // Accept tile
    swipePath.push(tile);
    tile.el.classList.add("selected");
    audio.playSwipeStep(swipePath.length);
    drawSwipePath();
}

function swipeFinish() {
    isSwipingPath = false;
    boardEl.querySelectorAll(".tile.selected").forEach(el => el.classList.remove("selected"));

    const path = [...swipePath];
    swipePath = [];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (path.length === 2) {
        // 2-tile swipe → swap positions. Glow tiles swap like any other
        // tile — they're only special for their burst badge/trigger, not
        // for movement.
        executeSwap(path[0], path[1].x, path[1].y);
    } else if (path.length >= 3) {
        // 3+ tile swipe → validate word
        const word = path.map(t => t.letter).join("").toLowerCase();
        if (validator.isValidWord(word)) {
            // Real bug fix (2026-07-31): this object was missing `direction`,
            // which calculateWordScore()'s 1.5x vertical bonus and
            // findGlowTileInLine()/triggerRowColumnBurst() both depend on.
            // Every real player swipe silently fell through to `undefined`,
            // which findGlowTileInLine treated as "vertical" regardless of
            // the actual swipe axis — the root cause of glow-tile bursts
            // seeming to randomly not fire on the row/column the player
            // actually cleared. The path is already locked to one axis by
            // swipeContinue()'s straight-line lock above, so this is safe to
            // derive from the first two tiles.
            const direction = path.length < 2 || path[0].y === path[1].y ? "horizontal" : "vertical";
            sliceClearWord({ word, tiles: path, direction });
        } else {
            drawErrorPath(path);
            audio.playClick();
        }
    }
}

function drawErrorPath(path) {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.beginPath();
    const p0 = getTileCenter(path[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < path.length; i++) {
        const p = getTileCenter(path[i]);
        ctx.lineTo(p.x, p.y);
    }
    
    // Glowing neon red trail
    ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ef4444";
    ctx.stroke();
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
    
    setTimeout(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 200);
}

function getTileById(id) {
    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            if (grid[y][x] && grid[y][x].id === id) {
                return grid[y][x];
            }
        }
    }
    return null;
}

async function executeSwap(tileA, targetCol, targetRow) {
    setBoardLock(true);
    try {
        const tileB = grid[targetRow][targetCol];
        audio.playSwap();

        // 1. Swap positions in matrix
        grid[tileA.y][tileA.x] = tileB;
        grid[targetRow][targetCol] = tileA;

        // 2. Animate swap visually via CSS variables
        tileA.el.classList.add("swapping");
        tileA.el.style.setProperty("--col", targetCol);
        tileA.el.style.setProperty("--row", targetRow);

        if (tileB) {
            tileB.el.classList.add("swapping");
            tileB.el.style.setProperty("--col", tileA.x);
            tileB.el.style.setProperty("--row", tileA.y);
            
            // Update tileB coordinates
            tileB.x = tileA.x;
            tileB.y = tileA.y;
        }

        // Update tileA coordinates
        tileA.x = targetCol;
        tileA.y = targetRow;

        // Wait for slide animation (150ms)
        await delay(150);

        tileA.el.classList.remove("swapping");
        if (tileB) tileB.el.classList.remove("swapping");

        // 3. Scan and cascade matches
        await resolveBoardCascades();
    } catch (err) {
        console.error("Error during executeSwap:", err);
        forceUnlockBoard();
    } finally {
        setBoardLock(false);
    }
}

/* --- Word Scanning & Cascading Engine --- */

function scanForWords() {
    const matchedCoords = new Set();
    const wordsFound = [];

    // 1. Horizontal Scan
    for (let y = 0; y < GRID_ROWS; y++) {
        const rowTiles = [];
        for (let x = 0; x < GRID_COLS; x++) {
            rowTiles.push(grid[y][x]);
        }
        findWordsInLine(rowTiles, "horizontal", wordsFound, matchedCoords);
    }

    // 2. Vertical Scan (Top-to-Bottom, as English is read)
    for (let x = 0; x < GRID_COLS; x++) {
        const colTiles = [];
        for (let y = GRID_ROWS - 1; y >= 0; y--) {
            colTiles.push(grid[y][x]);
        }
        findWordsInLine(colTiles, "vertical", wordsFound, matchedCoords);
    }

    return {
        matches: wordsFound,
        matchedCoords: matchedCoords
    };
}

function findWordsInLine(lineTiles, direction, wordsFound, matchedCoords) {
    for (let start = 0; start < lineTiles.length; start++) {
        // Look for contiguous blocks of non-null tiles
        if (lineTiles[start] === null) continue;

        let end = start;
        while (end < lineTiles.length && lineTiles[end] !== null) {
            end++;
        }

        const segment = lineTiles.slice(start, end);
        if (segment.length < 3) {
            start = end;
            continue;
        }

        // Scan windows from longest to shortest (greedy match)
        for (let size = segment.length; size >= 3; size--) {
            for (let windowStart = 0; windowStart <= segment.length - size; windowStart++) {
                const windowTiles = segment.slice(windowStart, windowStart + size);
                const wordStr = windowTiles.map(t => t.letter).join("").toLowerCase();
                
                if (validator.isValidWord(wordStr)) {
                    // Save word details
                    wordsFound.push({
                        word: wordStr,
                        tiles: windowTiles,
                        direction: direction
                    });
                    
                    // Add coordinates
                    windowTiles.forEach(t => matchedCoords.add(`${t.x},${t.y}`));
                    
                    // Skip windows that overlap the rest of this word (avoid sub-word matches in same line)
                    start += size - 1;
                }
            }
        }
    }
}

async function resolveBoardCascades() {
    try {
        // ALWAYS run applyGravity() first to guarantee zero floating gaps remain
        applyGravity();

        // Clear any previous hint highlights
        const oldHints = boardEl.querySelectorAll(".tile.hint-highlight");
        oldHints.forEach(t => t.classList.remove("hint-highlight"));

        const { matches } = scanForWords();
        activeMatches = matches;

        // Check danger status
        updateDangerGlow();
    } catch (err) {
        console.error("Error during resolveBoardCascades:", err);
    } finally {
        setBoardLock(false);
    }
}

function triggerHint() {
    if (!isPlaying || isPaused || isBoardLocked) return;

    if (score < 10) {
        showWordClearPopup("NEED 10 PTS FOR HINT!", { el: boardEl });
        audio.playClick();
        return;
    }

    const { matches } = scanForWords();
    if (matches.length === 0) {
        showWordClearPopup("NO WORDS FOUND!", { el: boardEl });
        audio.playClick();
        return;
    }

    // Deduct 10 points
    updateScore(-10);
    audio.playHint();

    // Pick the word with the most letters to highlight for the player
    matches.sort((a, b) => b.tiles.length - a.tiles.length);
    const targetMatch = matches[0];

    // Temporarily highlight word tiles for 3.5 seconds
    targetMatch.tiles.forEach(tile => {
        if (tile && tile.el) {
            tile.el.classList.add("hint-highlight");
        }
    });

    setTimeout(() => {
        targetMatch.tiles.forEach(tile => {
            if (tile && tile.el) {
                tile.el.classList.remove("hint-highlight");
            }
        });
    }, 3500);
}

// Looks for a live glow tile anywhere along the swiped word's row
// (horizontal words) or column (vertical words) — must be captured before
// the word's own tiles are cleared below, since the word itself may pass
// directly through the glow tile.
function findGlowTileInLine(match) {
    if (!match.tiles || match.tiles.length === 0) return null;
    const first = match.tiles[0];
    if (match.direction === "horizontal") {
        const y = first.y;
        for (let x = 0; x < GRID_COLS; x++) {
            const t = grid[y][x];
            if (t && t.glow) return t;
        }
    } else {
        const x = first.x;
        for (let y = 0; y < GRID_ROWS; y++) {
            const t = grid[y][x];
            if (t && t.glow) return t;
        }
    }
    return null;
}

// Detonates every tile currently in the glow tile's row or column
// (including the glow tile itself, and including cells already emptied
// by the word that triggered it — those are just skipped as null).
function triggerRowColumnBurst(glowTile, direction) {
    const isHorizontal = direction === "horizontal";
    const line = [];
    if (isHorizontal) {
        for (let x = 0; x < GRID_COLS; x++) {
            const t = grid[glowTile.y][x];
            if (t) line.push(t);
        }
    } else {
        for (let y = 0; y < GRID_ROWS; y++) {
            const t = grid[y][glowTile.x];
            if (t) line.push(t);
        }
    }
    if (line.length === 0) return;

    spawnWordBurstRing(line, "glow");

    let bonus = 0;
    line.forEach(tile => {
        bonus += tile.value;
        spawnTileSparks(tile);
        if (tile.el) tile.el.remove();
        grid[tile.y][tile.x] = null;
    });

    const totalBonus = bonus + GLOW_TILE_BURST_BONUS;
    updateScore(totalBonus);
    triggerScreenShake();
    showWordClearPopup(`⚡ ${isHorizontal ? "ROW" : "COLUMN"} GLOW! +${totalBonus}`, { el: boardEl });
    audio.playSlash();
    audio.playBurstPop();
}

async function sliceClearWord(match) {
    setBoardLock(true);

    // Snapshot before this word's own tiles are removed below — the glow
    // tile being searched for may be one of the tiles in `match` itself.
    const glowTile = findGlowTileInLine(match);

    // Play sounds: blade slash whoosh + acoustic burst pop + chime
    audio.playSlash();
    audio.playBurstPop();
    
    setTimeout(() => {
        audio.playWordClear(match.word.length);
    }, 80);

    triggerScreenShake();

    // 1. Spawn word-sized shockwave ring centered over the exact swiped word coordinates
    spawnWordBurstRing(match.tiles);

    // 2. Visual Splitting halves & sparkling particles per tile
    match.tiles.forEach(tile => {
        if (!tile || !tile.el) return;

        // Spawn 4 burst particles per tile
        spawnTileSparks(tile);

        // Hide original tile element
        tile.el.style.display = "none";

        // Spawn left half
        const leftHalf = document.createElement("div");
        leftHalf.className = "tile-half tile-half-left " + getRarityClass(tile.value);
        leftHalf.style.setProperty("--col", tile.x);
        leftHalf.style.setProperty("--row", tile.y);
        leftHalf.innerHTML = tile.el.innerHTML;
        boardEl.appendChild(leftHalf);

        // Spawn right half
        const rightHalf = document.createElement("div");
        rightHalf.className = "tile-half tile-half-right " + getRarityClass(tile.value);
        rightHalf.style.setProperty("--col", tile.x);
        rightHalf.style.setProperty("--row", tile.y);
        rightHalf.innerHTML = tile.el.innerHTML;
        boardEl.appendChild(rightHalf);

        // Remove halves from DOM after split animation completes (500ms)
        setTimeout(() => {
            leftHalf.remove();
            rightHalf.remove();
        }, 500);

        // Remove from memory grid
        grid[tile.y][tile.x] = null;
        tile.el.remove();
    });

    // Score Calculations
    const scoreResult = calculateWordScore(match, 1);
    updateScore(scoreResult.score);
    wordsClearedCount++;

    // Glow tile payoff: this single word's score met the threshold of a
    // glow tile living anywhere in its row/column — blow the whole line.
    if (glowTile && scoreResult.score >= glowTile.burstValue) {
        triggerRowColumnBurst(glowTile, match.direction);
    }

    // Track longest word spelled this run (previously declared but never
    // actually updated, so the stats card always showed "—").
    if (longestWordSpelled === "—" || scoreResult.word.length > longestWordSpelled.length) {
        longestWordSpelled = scoreResult.word;
    }

    gcRecordWordCleared(scoreResult.word);

    // Update Last Spelled Word HUD
    lastWordTextEl.textContent = scoreResult.word.toUpperCase();
    lastWordScoreEl.textContent = `(+${scoreResult.score} PTS)`;

    // Display floating popup
    showWordClearPopup(scoreResult.word.toUpperCase(), match.tiles[Math.floor(match.tiles.length / 2)]);

    // Trigger gravity and scan for cascaded combinations after halves slide away (350ms)
    setTimeout(async () => {
        try {
            const cascaded = applyGravity();
            if (cascaded) {
                await delay(200);
            }
            await resolveBoardCascades();
        } catch (err) {
            console.error("Error in sliceClearWord cascade:", err);
            forceUnlockBoard();
        } finally {
            setBoardLock(false);
        }
    }, 350);
}

function spawnWordBurstRing(tiles, variant = "") {
    if (!tiles || tiles.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    tiles.forEach(t => {
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
    });

    const variantClass = variant ? ` ${variant}` : "";

    const ring = document.createElement("div");
    ring.className = `word-burst-ring${variantClass}`;

    const leftPct = (minX / GRID_COLS) * 100;
    const bottomPct = (minY / GRID_ROWS) * 100;
    const widthPct = ((maxX - minX + 1) / GRID_COLS) * 100;
    const heightPct = ((maxY - minY + 1) / GRID_ROWS) * 100;

    ring.style.left = `calc(${leftPct}% - 4px)`;
    ring.style.bottom = `calc(${bottomPct}% - 4px)`;
    ring.style.width = `calc(${widthPct}% + 8px)`;
    ring.style.height = `calc(${heightPct}% + 8px)`;

    boardEl.appendChild(ring);
    setTimeout(() => ring.remove(), 500);

    // Fast bright flash underneath the ring's slower expansion — reads as
    // an immediate "impact" the instant the word clears, rather than only
    // the outline sweeping outward a moment later.
    const flash = document.createElement("div");
    flash.className = `word-burst-flash${variantClass}`;
    flash.style.left = ring.style.left;
    flash.style.bottom = ring.style.bottom;
    flash.style.width = ring.style.width;
    flash.style.height = ring.style.height;

    boardEl.appendChild(flash);
    setTimeout(() => flash.remove(), 250);
}

// Rarity-matched particle color so the burst visually ties back to what was
// actually cleared (a rare gold tile bursts gold, not a generic cyan).
function getRarityColor(value) {
    if (value >= 5) return "#f59e0b"; // rare
    if (value >= 2) return "#a855f7"; // uncommon
    return "#3b82f6"; // common
}

function spawnTileSparks(tile) {
    const parentRect = boardEl.getBoundingClientRect();
    const rect = tile.el.getBoundingClientRect();
    const cx = rect.left - parentRect.left + rect.width / 2;
    const cy = rect.top - parentRect.top + rect.height / 2;
    // Glow-tile bursts get a distinct fiery color so a row/column
    // detonation always reads visually different from a normal word clear.
    const color = tile.glow ? "#f97316" : getRarityColor(tile.value);

    const PARTICLE_COUNT = 8;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = document.createElement("div");
        p.className = "burst-particle";
        p.style.left = `${cx}px`;
        p.style.top = `${cy}px`;
        p.style.setProperty("--pcolor", color);
        p.style.setProperty("--size", `${6 + Math.random() * 6}px`);

        const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() * 0.35 - 0.175);
        const dist = 28 + Math.random() * 30;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;

        p.style.setProperty("--dx", `${dx}px`);
        p.style.setProperty("--dy", `${dy}px`);

        boardEl.appendChild(p);
        setTimeout(() => p.remove(), 600);
    }
}

function getRarityClass(value) {
    if (value >= 5) return "tile-rare";
    if (value >= 2) return "tile-uncommon";
    return "tile-common";
}

function calculateWordScore(match, comboStreak) {
    const baseScore = match.tiles.reduce((sum, t) => sum + t.value, 0);
    
    // Multipliers
    let lengthMult = 1.0;
    const len = match.word.length;
    if (len === 4) lengthMult = 1.2;
    else if (len === 5) lengthMult = 1.5;
    else if (len === 6) lengthMult = 2.0;
    else if (len >= 7) lengthMult = 3.0;

    const directionMult = match.direction === "vertical" ? 1.5 : 1.0;
    const comboMult = 1.0 + (comboStreak - 1) * 0.5;

    const finalScore = Math.round(baseScore * lengthMult * directionMult * comboMult);
    
    return {
        word: match.word,
        score: finalScore
    };
}

function applyGravity() {
    let cascaded = false;
    let keepChecking = true;
    
    // Multi-pass gravity loop: Repeat until no tile has an empty slot underneath it
    while (keepChecking) {
        keepChecking = false;
        for (let x = 0; x < GRID_COLS; x++) {
            for (let y = 0; y < GRID_ROWS - 1; y++) {
                // Glow tiles fall exactly like any other tile — they're
                // only special for their burst badge/trigger, not movement.
                if (grid[y][x] === null && grid[y + 1][x] !== null) {
                    const tile = grid[y + 1][x];
                    grid[y][x] = tile;
                    grid[y + 1][x] = null;
                    
                    tile.y = y;
                    if (tile.el) {
                        tile.el.style.setProperty("--row", y);
                    }
                    keepChecking = true;
                    cascaded = true;
                }
            }
        }
    }
    return cascaded;
}

/* --- Rising Grid Mechanic & Gamer Power-Ups --- */

function triggerVortex() {
    if (!isPlaying || isPaused || isBoardLocked) return;

    if (score < 25) {
        showWordClearPopup("NEED 25 PTS FOR VORTEX!", { el: boardEl });
        audio.playClick();
        return;
    }

    // Check if bottom row (y=0) has any tiles
    let hasBottomTiles = false;
    for (let x = 0; x < GRID_COLS; x++) {
        if (grid[0][x] !== null) {
            hasBottomTiles = true;
            break;
        }
    }

    if (!hasBottomTiles) {
        showWordClearPopup("BOTTOM ROW EMPTY!", { el: boardEl });
        audio.playClick();
        return;
    }

    setBoardLock(true);

    // Deduct 25 pts
    updateScore(-25);
    audio.playSlash();
    audio.playBurstPop();
    triggerScreenShake();

    // Vaporize bottom row (y=0)
    for (let x = 0; x < GRID_COLS; x++) {
        const tile = grid[0][x];
        if (tile && tile.el) {
            spawnTileSparks(tile);
            grid[0][x] = null;
            tile.el.remove();
        }
    }

    showWordClearPopup("🔥 VORTEX CLEAR!", { el: boardEl });

    // Apply gravity
    setTimeout(async () => {
        try {
            applyGravity();
            await resolveBoardCascades();
        } catch (err) {
            console.error("Error in triggerVortex:", err);
            forceUnlockBoard();
        } finally {
            setBoardLock(false);
        }
    }, 250);
}

function openStatsModal() {
    audio.playClick();
    if (statsWordsCountEl) statsWordsCountEl.textContent = wordsClearedCount;
    if (statsLongestWordEl) statsLongestWordEl.textContent = longestWordSpelled.toUpperCase();
    if (statsRareCountEl) statsRareCountEl.textContent = rareTilesClearedCount;
    if (statsHighScoreEl) statsHighScoreEl.textContent = formatScore(highScore);
    if (statsOverlay) statsOverlay.classList.remove("hidden");
}

function closeStatsModal() {
    audio.playClick();
    if (statsOverlay) statsOverlay.classList.add("hidden");
}

function startRiseTimer() {
    if (riseTimerInterval) clearInterval(riseTimerInterval);

    riseTimerInterval = setInterval(() => {
        if (!isPlaying || isPaused || isBoardLocked) return;

        const duration = LEVEL_SPEEDS[level] || 15.0;
        // Increment progress (ticks every 100ms)
        riseProgress += (100 / (duration * 10));

        if (riseProgress >= 100) {
            riseProgress = 0;
            pushGridUp();
        }

        timerBarEl.style.width = `${Math.min(100, riseProgress)}%`;

        // Update digital countdown timer
        const remainingSecs = Math.max(0, Math.ceil(duration * (1 - riseProgress / 100)));
        if (timerCountdownEl) timerCountdownEl.textContent = `${remainingSecs}s`;
    }, 100);
}

async function pushGridUp() {
    setBoardLock(true);
    try {
        // 0. Ensure all floating tiles are collapsed before rising
        applyGravity();

        // 1. Check for Game Over: Is any tile at Row 13 (top boundary)?
        for (let x = 0; x < GRID_COLS; x++) {
            if (grid[GRID_ROWS - 1][x] !== null) {
                triggerGameOver();
                return;
            }
        }

        // 2. Shift all existing tiles up
        for (let y = GRID_ROWS - 2; y >= 0; y--) {
            for (let x = 0; x < GRID_COLS; x++) {
                const tile = grid[y][x];
                if (tile) {
                    grid[y + 1][x] = tile;
                    grid[y][x] = null;
                    tile.y = y + 1;
                    tile.el.style.setProperty("--row", y + 1);
                }
            }
        }

        // 3. Spawn new row at bottom (Row 0) — occasionally a glow tile
        // once the player has reached the unlock level.
        for (let x = 0; x < GRID_COLS; x++) {
            if (shouldSpawnGlowTile()) {
                spawnTile(x, 0, null, true, rollGlowThreshold());
            } else {
                spawnTile(x, 0);
            }
        }

        // Wait for shifts (150ms)
        await delay(150);

        // 4. Resolve matches created by the rise
        await resolveBoardCascades();
    } catch (err) {
        console.error("Error during pushGridUp:", err);
        forceUnlockBoard();
    } finally {
        setBoardLock(false);
    }
}

function updateDangerGlow() {
    // If any tile occupies Row 11, 12, or 13, show warning
    let dangerActive = false;
    for (let y = GRID_ROWS - 3; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            if (grid[y][x] !== null) {
                dangerActive = true;
                break;
            }
        }
        if (dangerActive) break;
    }

    if (dangerActive) {
        boardEl.classList.add("danger");
        audio.playDangerWarning();
    } else {
        boardEl.classList.remove("danger");
    }
}

/* --- Power-Ups (Shuffle) --- */

async function triggerShuffle() {
    if (!isPlaying || isPaused || isBoardLocked || shuffleCooldownActive) return;
    
    setBoardLock(true);
    try {
        audio.playClick();

        // Gather all active tiles on the board — glow tiles shuffle
        // along with everything else, same as any other tile.
        const tilesList = [];
        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                if (grid[y][x]) {
                    tilesList.push(grid[y][x]);
                }
            }
        }

        if (tilesList.length === 0) return;

        // Clear matrix references
        grid = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(null));

        // Fisher-Yates shuffle positions
        const positions = tilesList.map(t => ({ x: t.x, y: t.y }));
        shuffleArray(positions);

        // Assign new positions
        tilesList.forEach((tile, index) => {
            const newPos = positions[index];
            tile.x = newPos.x;
            tile.y = newPos.y;
            grid[newPos.y][newPos.x] = tile;
            
            tile.el.classList.add("swapping");
            tile.el.style.setProperty("--col", newPos.x);
            tile.el.style.setProperty("--row", newPos.y);
        });

        // Spark visual effect from center
        audio.playSwap();

        await delay(200);

        tilesList.forEach(t => t.el.classList.remove("swapping"));

        // Activate cooldown
        startShuffleCooldown();

        // Check for words created by shuffle
        await resolveBoardCascades();
    } catch (err) {
        console.error("Error during triggerShuffle:", err);
        forceUnlockBoard();
    } finally {
        setBoardLock(false);
    }
}

function startShuffleCooldown() {
    shuffleCooldownActive = true;
    btnShuffle.disabled = true;
    let cdElapsed = 0;
    
    const cdInterval = setInterval(() => {
        cdElapsed += 100;
        const percent = 100 - (cdElapsed / SHUFFLE_COOLDOWN_MS) * 100;
        shuffleCooldownEl.style.width = `${percent}%`;

        if (cdElapsed >= SHUFFLE_COOLDOWN_MS) {
            clearInterval(cdInterval);
            shuffleCooldownActive = false;
            btnShuffle.disabled = false;
            shuffleCooldownEl.style.width = "0%";
        }
    }, 100);
}

/* --- Scoring and Level Progression --- */

function updateScore(amount) {
    score += amount;
    scoreValEl.textContent = formatScore(score);

    // Save High Score
    if (score > highScore) {
        highScore = score;
        highScoreValEl.textContent = formatScore(highScore);
        localStorage.setItem("wordrop_high_score", highScore);
    }

    checkLevelProgression();
}

function checkLevelProgression() {
    // Level 2 unlock condition: score >= 100 OR wordsClearedCount >= 4
    let targetLevel = 1;
    if (score >= 4000 || wordsClearedCount >= 40) targetLevel = 6 + Math.floor((score - 4000) / 3000);
    else if (score >= 2200 || wordsClearedCount >= 25) targetLevel = 5;
    else if (score >= 1200 || wordsClearedCount >= 16) targetLevel = 4;
    else if (score >= 500 || wordsClearedCount >= 9) targetLevel = 3;
    else if (score >= 100 || wordsClearedCount >= 4) targetLevel = 2;

    if (targetLevel > level) {
        level = targetLevel;
        levelValEl.textContent = level;

        // Triumphant Level Up effects!
        audio.playLevelUp();
        triggerScreenShake();
        showWordClearPopup(`LEVEL ${level} UNLOCKED!`, { el: boardEl });

        // Level Up Reward: Reset rise timer progress to give player a fresh breathing start
        riseProgress = 0;
        if (timerBarEl) timerBarEl.style.width = "0%";

        if (level >= 5) gcUnlockOnce("wordrop_ach_level5_done", GC_ACH_LEVEL_5);
        if (level >= 10) gcUnlockOnce("wordrop_ach_level10_done", GC_ACH_LEVEL_10);
    }
}

function formatScore(val) {
    return String(val).padStart(6, "0");
}

/* --- UI FX (Sparks, Floating Popups, Combo) --- */

function createSparks(tileEl) {
    const rect = tileEl.getBoundingClientRect();
    const parentRect = boardEl.getBoundingClientRect();
    
    const originX = rect.left - parentRect.left + (rect.width / 2);
    const originY = rect.top - parentRect.top + (rect.height / 2);
    
    const colors = ["#00f0ff", "#bd00ff", "#ffb700", "#ffffff"];
    
    // 1. Shockwave Ripple ring
    const ring = document.createElement("div");
    ring.className = "clear-ring";
    ring.style.left = `${originX}px`;
    ring.style.top = `${originY}px`;
    boardEl.appendChild(ring);
    setTimeout(() => ring.remove(), 450);

    // 2. Neon particle sparks (12 total)
    for (let i = 0; i < 12; i++) {
        const spark = document.createElement("div");
        spark.className = "spark";
        
        const angle = Math.random() * Math.PI * 2;
        const distance = 40 + Math.random() * 45;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        
        spark.style.setProperty("--x", `${originX}px`);
        spark.style.setProperty("--y", `${originY}px`);
        spark.style.setProperty("--tx", `${tx}px`);
        spark.style.setProperty("--ty", `${ty}px`);
        
        const color = colors[Math.floor(Math.random() * colors.length)];
        spark.style.backgroundColor = color;
        spark.style.boxShadow = `0 0 6px ${color}`;
        boardEl.appendChild(spark);
        
        setTimeout(() => spark.remove(), 500);
    }
}

function triggerScreenShake() {
    boardEl.classList.remove("shake");
    void boardEl.offsetWidth; // force reflow
    boardEl.classList.add("shake");
    setTimeout(() => boardEl.classList.remove("shake"), 250);
}

function showWordClearPopup(wordText, anchorTile) {
    // 1. Central word pop banner
    wordPopup.textContent = `${wordText}!`;
    wordPopup.classList.remove("hidden");
    
    // Restart animation
    wordPopup.style.animation = "none";
    void wordPopup.offsetWidth; // Trigger reflow
    wordPopup.style.animation = "popupAnim 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards";
    
    setTimeout(() => {
        wordPopup.classList.add("hidden");
    }, 800);

    // 2. Floating score popup over cleared tiles. Only real tile anchors
    // (which carry a .letter) get the floating "+N" number — generic
    // status messages pass a placeholder like `{ el: boardEl }` purely to
    // anchor the position, and have no per-tile score to show. Previously
    // this branch ran unconditionally for BOTH cases: calculateWordScore()
    // would receive `word: undefined` from the placeholder and throw
    // (`undefined.length`), which — since showWordClearPopup is called
    // synchronously from checkLevelProgression()/triggerHint()/
    // triggerVortex() with no surrounding try/catch — unwound uncaught all
    // the way up through updateScore() and back into whatever caller
    // triggered it. In sliceClearWord() specifically, that meant leveling
    // up on the exact word that leveled you up skipped every line after
    // updateScore() in that call — including the setTimeout that runs
    // applyGravity()/resolveBoardCascades() — leaving the board stuck
    // locked until the 2s watchdog force-unlocked it. Found via a real
    // browser DOM test (jsdom) exercising the actual level-up/hint/vortex/
    // glow-burst popup calls end-to-end, not just mocked function tests.
    if (anchorTile && anchorTile.letter) {
        const rect = anchorTile.el.getBoundingClientRect();
        const parentRect = boardEl.getBoundingClientRect();
        const popX = rect.left - parentRect.left + (rect.width / 2);
        const popY = rect.top - parentRect.top;

        const scorePop = document.createElement("div");
        scorePop.className = "score-pop";
        scorePop.textContent = `+${calculateWordScore({ word: anchorTile.letter, tiles: [anchorTile], direction: "h" }, 1).score}`; // Approx value
        scorePop.style.left = `${popX}px`;
        scorePop.style.top = `${popY}px`;
        
        // Custom float styling
        scorePop.style.position = "absolute";
        scorePop.style.transform = "translate(-50%, -50%)";
        scorePop.style.color = "var(--neon-gold)";
        scorePop.style.fontFamily = "'Outfit', sans-serif";
        scorePop.style.fontWeight = "900";
        scorePop.style.fontSize = "16px";
        scorePop.style.pointerEvents = "none";
        scorePop.style.zIndex = "100";
        scorePop.style.animation = "floatUp 0.6s ease-out forwards";
        
        // Append CSS float animation dynamically if not present
        if (!document.getElementById("style-float-up")) {
            const s = document.createElement("style");
            s.id = "style-float-up";
            s.innerHTML = `
                @keyframes floatUp {
                    0% { transform: translate(-50%, -50%) translateY(0); opacity: 1; scale: 0.8; }
                    50% { scale: 1.1; }
                    100% { transform: translate(-50%, -50%) translateY(-30px); opacity: 0; }
                }
            `;
            document.head.appendChild(s);
        }
        
        boardEl.appendChild(scorePop);
        setTimeout(() => scorePop.remove(), 600);
    }
}

function showComboBadge(streak) {
    comboBadge.textContent = `COMBO ${streak}x!`;
    comboBadge.classList.remove("hidden");
    
    comboBadge.style.animation = "none";
    void comboBadge.offsetWidth;
    comboBadge.style.animation = "popupAnim 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards";
    
    setTimeout(() => {
        comboBadge.classList.add("hidden");
    }, 800);
}

function showPopupText(text, color) {
    const pop = document.createElement("div");
    pop.style.position = "absolute";
    pop.style.left = "50%";
    pop.style.top = "40%";
    pop.style.transform = "translate(-50%, -50%)";
    pop.style.color = color;
    pop.style.fontFamily = "'Outfit', sans-serif";
    pop.style.fontWeight = "900";
    pop.style.fontSize = "32px";
    pop.style.letterSpacing = "2px";
    pop.style.pointerEvents = "none";
    pop.style.zIndex = "1000";
    pop.style.textShadow = `0 0 20px ${color}`;
    pop.style.animation = "popupAnim 1s ease forwards";
    
    boardEl.appendChild(pop);
    pop.textContent = text;
    setTimeout(() => pop.remove(), 1000);
}

/* --- Pause & Game Over Controls --- */

function togglePause() {
    if (!isPlaying) return;
    isPaused = !isPaused;
    
    audio.playClick();
    
    if (isPaused) {
        pauseOverlay.classList.remove("hidden");
        btnPause.textContent = "▶️";
    } else {
        pauseOverlay.classList.add("hidden");
        btnPause.textContent = "⏸️";
    }
}

function triggerGameOver() {
    isPlaying = false;
    if (riseTimerInterval) clearInterval(riseTimerInterval);
    
    audio.playGameOver();
    boardEl.classList.remove("danger");

    // Display overlay stats
    finalScoreEl.textContent = score.toLocaleString();
    finalLevelEl.textContent = level;
    finalWordsCountEl.textContent = wordsClearedCount;

    gcSubmitScore(score);

    gameOverOverlay.classList.remove("hidden");
}

/* --- Helpers --- */

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
