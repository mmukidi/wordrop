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

// Letter rarity tiers, redesigned 2026-07-31 -- one distinct color per
// point value actually present in TILE_VALUES (1,2,3,4,6,8,9; 5 and 7
// never occur), instead of the original 3 broad buckets. A low-to-high
// "heat" gradient (cool blue = common, hot gold = legendary) so every
// tier reads as visually distinct at a glance. Full table documented in
// TESTING.md. getRarityClass()/getRarityColor() below both derive from
// this single source of truth -- update colors/names here only.
const RARITY_TIERS = [
    { minValue: 9, name: "Legendary", cssClass: "tile-legendary", color: "#eab308" },
    { minValue: 8, name: "Mythic",    cssClass: "tile-mythic",    color: "#ef4444" },
    { minValue: 6, name: "Epic",      cssClass: "tile-epic",      color: "#f97316" },
    { minValue: 4, name: "Rare",      cssClass: "tile-rare",      color: "#ec4899" },
    { minValue: 3, name: "Scarce",    cssClass: "tile-scarce",    color: "#a855f7" },
    { minValue: 2, name: "Uncommon",  cssClass: "tile-uncommon",  color: "#22c55e" },
    { minValue: 1, name: "Common",    cssClass: "tile-common",    color: "#3b82f6" }
];

function getRarityTier(value) {
    return RARITY_TIERS.find(t => value >= t.minValue) || RARITY_TIERS[RARITY_TIERS.length - 1];
}

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

// Progress within the CURRENT level only -- what the goal bar reads from,
// and what stars are judged on. Reset every time a level starts or restarts.
let levelScore = 0;
let levelWords = 0;
// Total score as it stood when this level began, so a retry rolls back to
// it instead of letting the player farm points off repeated attempts.
let scoreAtLevelStart = 0;
// True between hitting the target and the player dismissing the celebration.
let levelCompletePending = false;
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

// Timestamp (ms) at which a due rise started being held back because the
// player had a finger down mid-swipe. 0 = nothing deferred. See the rise
// tick in startRiseTimer() for why the board must not move under a finger.
let riseDeferredSince = 0;
// Hard cap on that deferral, so resting a finger on the board can never
// stall the game indefinitely.
const MAX_RISE_DEFER_MS = 2000;
/* Rise speed per level, in seconds per new row.
 *
 * Rebalanced 2026-08-02. The old curve bottomed out at 1.5s, which is not a
 * difficulty setting -- it's a countdown. Modelling the tile economy (a rise
 * adds 8 tiles; a word clear removes ~3.3; a strong player clears one word
 * roughly every 3.5s) showed a level-10 board buries a strong player in
 * ~18 seconds no matter how well they play, and levels 7-10 could not be
 * survived long enough to score meaningfully. Those levels were advertised
 * in the level menu but were never actually playable.
 *
 * The softened curve keeps every level winnable-but-hard, and is capped at
 * 4s from level 10 on. Past 10 the score multiplier keeps rising while the
 * speed holds, so the ceiling grows and the ladder stays climbable forever.
 * See balance/verify.js for the model this was tuned against.
 */
const LEVEL_SPEEDS = {
    1: 15.0,  // endless for a competent player -- the learning level
    2: 12.5,
    3: 10.5,
    4: 9.0,
    5: 7.5,   // pressure becomes real here
    6: 6.5,
    7: 5.5,
    8: 5.0,
    9: 4.5,
    10: 4.0   // speed cap: level 11+ stays at 4.0s
};
const MAX_RISE_SPEED = 4.0;

function getLevelMultiplier(lvl) {
    // Level 1 = 1.0x, Level 2 = 1.5x (+50%), Level 3 = 2.0x (+100%), Level 4 = 2.5x (+150%)...
    return 1 + (lvl - 1) * 0.5;
}

/* --- Level goals & stars -------------------------------------------------
 * Every level is now a stated objective: score N points on this board before
 * the tiles overflow. The player can always see the goal and how close they
 * are to it, and completing one is a real event rather than a surprise
 * popup.
 *
 * The curve is calibrated against a 6,000-board Monte Carlo run using the
 * real letter weights, the real 172k dictionary and the real
 * calculateWordScore(): a 4-row board offers ~6.8 valid words, the best of
 * which is worth ~9.5 pts at 1.0x. Targets are therefore set so a level
 * takes roughly 12-16 good clears, and they scale with getLevelMultiplier()
 * so the difficulty comes from the rising speed rather than from the target
 * inflating faster than scoring does.
 */
const LEVEL_TARGETS = [100, 175, 250, 325, 400, 475, 550, 625, 700, 775];
const LEVEL_TARGET_STEP = 50; // added per level beyond the table

function getLevelTarget(lvl) {
    if (lvl <= 0) return LEVEL_TARGETS[0];
    if (lvl <= LEVEL_TARGETS.length) return LEVEL_TARGETS[lvl - 1];
    return LEVEL_TARGETS[LEVEL_TARGETS.length - 1] + (lvl - LEVEL_TARGETS.length) * LEVEL_TARGET_STEP;
}

// "Par": how many near-best words it should take to clear the level. Stars
// are awarded on efficiency against this, so finding one 6-letter word beats
// spamming three 3-letter ones -- the skill a word game should reward.
const AVG_BEST_WORD_SCORE = 9.5; // measured, see comment above

function getLevelPar(lvl) {
    return Math.max(3, Math.ceil(getLevelTarget(lvl) / (AVG_BEST_WORD_SCORE * getLevelMultiplier(lvl))));
}

// 3 stars = at or under par, 2 = within 40% over, 1 = completed at all.
function starsForLevel(lvl, wordsUsed) {
    const par = getLevelPar(lvl);
    if (wordsUsed <= par) return 3;
    if (wordsUsed <= Math.round(par * 1.4)) return 2;
    return 1;
}

function getStarsMap() {
    try { return JSON.parse(localStorage.getItem("wordrop_level_stars") || "{}"); }
    catch { return {}; }
}

function recordLevelStars(lvl, stars) {
    const map = getStarsMap();
    const prev = map[lvl] || 0;
    if (stars > prev) {
        map[lvl] = stars;
        localStorage.setItem("wordrop_level_stars", JSON.stringify(map));
    }
    return Math.max(prev, stars);
}

function getTotalStars() {
    return Object.values(getStarsMap()).reduce((sum, s) => sum + s, 0);
}

function getBestLevelReached() {
    return parseInt(localStorage.getItem("wordrop_best_level") || "1", 10) || 1;
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

/* --- Native plugin helpers (Haptics / Share / LocalNotifications) ---
 * Same philosophy as Game Center above: bonus layers, never dependencies.
 * Each is a safe no-op on the website build or if the plugin is missing.
 */

function capPlugin(name) {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
}

/* Real bug fix (2026-08-02): these passed title-case strings ("Light",
 * "Success"). The plugin's ImpactStyle/NotificationType enums are
 * UPPERCASE, and HapticsPlugin.swift compares them with an exact `==`:
 *
 *   impact:       starts at .heavy, matches only "MEDIUM" / "LIGHT"
 *   notification: starts at .success, matches only "WARNING" / "ERROR"
 *
 * So "Light" fell through to a HEAVY thump on every word clear, and the
 * game-over "Error" buzz was delivered as a cheerful SUCCESS. Normalise to
 * uppercase and validate, so a bad argument can never silently become the
 * wrong physical sensation.
 *
 * NOTE: none of this fires at all until CocoaPods has actually installed
 * the Capacitor plugins -- see HAPTICS_SETUP note in TESTING.md.
 */
const IMPACT_STYLES = ["LIGHT", "MEDIUM", "HEAVY"];
const NOTIFICATION_TYPES = ["SUCCESS", "WARNING", "ERROR"];

function hapticImpact(style) { // "Light" | "Medium" | "Heavy" (any case)
    const h = capPlugin("Haptics");
    if (!h || !h.impact) return;
    const s = String(style || "").toUpperCase();
    h.impact({ style: IMPACT_STYLES.includes(s) ? s : "LIGHT" }).catch(() => {});
}

function hapticNotification(type) { // "Success" | "Warning" | "Error" (any case)
    const h = capPlugin("Haptics");
    if (!h || !h.notification) return;
    const t = String(type || "").toUpperCase();
    h.notification({ type: NOTIFICATION_TYPES.includes(t) ? t : "SUCCESS" }).catch(() => {});
}

/* --- Daily Challenge + streaks ---
 * One seeded board per calendar day, same for every player: all
 * gameplay-affecting randomness (letter draws + glow-tile spawn rolls)
 * goes through gameRand(), which swaps Math.random for a date-seeded
 * deterministic PRNG in daily mode. Purely-visual randomness (particle
 * angles, shuffle animation) deliberately stays on Math.random so it
 * can't perturb the seeded stream. The spawn stream's consumption order
 * depends only on rise cycles, not player choices, so two players on the
 * same date see the same letters arrive in the same order.
 */

let isDailyMode = false;
let dailyRng = null;
const DAILY_START_LEVEL = 2; // everyone starts the daily at the same speed

function localDateKey(d = new Date()) {
    // LOCAL date, not UTC -- "today's puzzle" should roll over at the
    // player's midnight, like Wordle, not at UTC midnight.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateKey(d);
}

// Small, well-known seeded PRNG (mulberry32) -- deterministic, fast, and
// plenty good for letter draws (this is game fairness, not cryptography).
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function dailySeedForDate(dateKey) {
    // Simple string hash (djb2) of the date -- every device hashes
    // "2026-08-01" to the same 32-bit seed with no server involved.
    let h = 5381;
    for (let i = 0; i < dateKey.length; i++) {
        h = ((h << 5) + h + dateKey.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}

function gameRand() {
    return (isDailyMode && dailyRng) ? dailyRng() : Math.random();
}

function getDailyStreak() {
    return parseInt(localStorage.getItem("wordrop_daily_streak")) || 0;
}

function hasPlayedDailyToday() {
    return localStorage.getItem("wordrop_daily_last_played") === localDateKey();
}

function getDailyBestToday() {
    if (localStorage.getItem("wordrop_daily_best_date") !== localDateKey()) return 0;
    return parseInt(localStorage.getItem("wordrop_daily_best_score")) || 0;
}

// Called once per finished daily run (from triggerGameOver). Counts the
// streak at most once per day: consecutive-day play extends it, a gap
// resets it to 1. Replays the same day just update the daily best score.
function recordDailyRunFinished(finalScore) {
    const today = localDateKey();
    const last = localStorage.getItem("wordrop_daily_last_played");

    if (last !== today) {
        const newStreak = (last === yesterdayKey()) ? getDailyStreak() + 1 : 1;
        localStorage.setItem("wordrop_daily_streak", newStreak);
        localStorage.setItem("wordrop_daily_last_played", today);
    }

    if (localStorage.getItem("wordrop_daily_best_date") !== today) {
        localStorage.setItem("wordrop_daily_best_date", today);
        localStorage.setItem("wordrop_daily_best_score", finalScore);
    } else if (finalScore > getDailyBestToday()) {
        localStorage.setItem("wordrop_daily_best_score", finalScore);
    }

    scheduleStreakReminder(getDailyStreak());
    return { streak: getDailyStreak(), best: getDailyBestToday() };
}

function startDailyChallenge() {
    if (isLevel0) level0Finish(); // leaving the tutorial for the daily board
    isDailyMode = true;
    startGame(); // startGame() re-seeds dailyRng itself (so replays get the identical board)
    showWordClearPopup("🔥 DAILY CHALLENGE!", { el: boardEl });
}

/* --- Local notifications (streak reminders) ---
 * Scheduled AFTER a daily run finishes -- the permission prompt appears
 * in a moment of positive engagement (just finished playing), not as an
 * ambush at first launch. One pending notification, id 1001, replaced
 * each time it's rescheduled: tomorrow evening, "your streak is at risk."
 */
const STREAK_REMINDER_ID = 1001;

async function scheduleStreakReminder(streak) {
    const ln = capPlugin("LocalNotifications");
    if (!ln) return;
    try {
        const perm = await ln.requestPermissions();
        if (!perm || perm.display !== "granted") return;
        await ln.cancel({ notifications: [{ id: STREAK_REMINDER_ID }] }).catch(() => {});
        const at = new Date();
        at.setDate(at.getDate() + 1);
        at.setHours(18, 0, 0, 0); // tomorrow 6pm local
        await ln.schedule({
            notifications: [{
                id: STREAK_REMINDER_ID,
                title: streak > 1 ? `🔥 ${streak}-day streak at risk!` : "🔥 Today's Daily Challenge is ready",
                body: streak > 1
                    ? "Play today's Daily Challenge to keep your streak alive."
                    : "A fresh board is waiting. Can you beat yesterday's score?",
                schedule: { at }
            }]
        });
    } catch (e) {
        console.warn("[Notifications] schedule failed:", e);
    }
}

/* --- Shareable result card ---
 * Wordle-style: compact, spoiler-free, braggable text with an emoji
 * strip encoding the longest word's letter rarities. Native share sheet
 * via the Capacitor Share plugin -> Web Share API -> clipboard fallback.
 */

function rarityEmojiForValue(v) {
    if (v >= 8) return "🟨";
    if (v >= 6) return "🟧";
    if (v >= 4) return "🟥";
    if (v >= 3) return "🟪";
    if (v >= 2) return "🟩";
    return "🟦";
}

function buildShareText() {
    const lines = ["🔤 WORDROP BURST"];
    if (isDailyMode) {
        lines.push(`📅 Daily Challenge ${localDateKey()}`);
    }
    lines.push(`🏆 ${score.toLocaleString()} pts · Lvl ${level} · ${wordsClearedCount} words`);
    if (longestWordSpelled && longestWordSpelled !== "—") {
        const strip = longestWordSpelled.toUpperCase().split("")
            .map(ch => rarityEmojiForValue(TILE_VALUES[ch] || 1)).join("");
        lines.push(`📖 ${longestWordSpelled.toUpperCase()}`);
        lines.push(strip);
    }
    const streak = getDailyStreak();
    if (streak > 1) lines.push(`🔥 ${streak}-day streak`);
    return lines.join("\n");
}

async function shareResultCard() {
    const text = buildShareText();
    const sharePlugin = capPlugin("Share");
    try {
        if (sharePlugin && sharePlugin.share) {
            await sharePlugin.share({ text });
            return;
        }
        if (navigator.share) {
            await navigator.share({ text });
            return;
        }
        await navigator.clipboard.writeText(text);
        showWordClearPopup("COPIED TO CLIPBOARD!", { el: boardEl });
    } catch (e) {
        // AbortError = user closed the share sheet -- not an error.
        if (e && e.name !== "AbortError") console.warn("[Share] failed:", e);
    }
}

/* --- Level 0: Guided Tutorial Game Mode ---
 * A real playable level (not an overlay) that teaches every core mechanic
 * by making the player actually DO it. Fully action-driven: each step
 * stages the board, spotlights exactly which tiles/buttons to touch, and
 * refuses to advance until the player performs that specific action
 * correctly. Nothing is on a timer and the rise is disabled until the very
 * last step, so a first-time player can never fail or get lost.
 *
 * Progression (each gate is a real user action, not a "Next" button):
 *   1. SWIPE   -- clear the pre-placed word C-A-T
 *   2. SWAP    -- drag across exactly 2 tiles to turn O-T-P into T-O-P
 *   3. SPELL   -- swipe the word they just built
 *   4. SHUFFLE -- tap the 🌀 button
 *   5. GLOW    -- clear a word in the ⚡ tile's row to detonate the row
 *   6. RISE    -- rise unlocks, tutorial ends, free play begins
 *
 * Shown once per device (localStorage "wordrop_level0_done").
 */

let isLevel0 = false;
let level0Step = 0;
let level0TargetIds = [];      // tile ids currently spotlighted
let level0Locked = false;      // true while a cheer/stage transition plays

// How long the green "✓ you did it" confirmation sits before the next step
// is staged. Long enough to read, short enough not to feel like waiting.
const LEVEL_0_CHEER_MS = 1200;

// Each step: what to say, how to stage the board, and which player action
// completes it. `gate` receives the event name emitted by the real game
// functions plus a payload (see level0Notify call sites) and returns true
// to advance. Kept deliberately tiny -- three directions of tile movement,
// then one word -- so a first-timer is never holding more than one idea.
const LEVEL_0_STEPS = [
    {
        key: "swapLeft",
        title: "STEP 1 OF 4 · MOVE A TILE LEFT",
        hint: "Drag a tile onto its LEFT neighbour to swap the two. Try the glowing pair.",
        cheer: "✓ Nice — that's how you move tiles.",
        stage: () => level0SpotlightSwapPair(-1, 0),
        gate: (evt, p) => evt === "swap" && p && p.dx === -1
    },
    {
        key: "swapRight",
        title: "STEP 2 OF 4 · NOW MOVE ONE RIGHT",
        hint: "Same move, other way: drag a tile onto its RIGHT neighbour.",
        cheer: "✓ Got it. Left and right, sorted.",
        stage: () => level0SpotlightSwapPair(1, 0),
        gate: (evt, p) => evt === "swap" && p && p.dx === 1
    },
    {
        key: "swapDown",
        title: "STEP 3 OF 4 · NOW MOVE ONE DOWN",
        hint: "Tiles move up and down too. Drag a tile DOWN onto the one below it.",
        cheer: "✓ Any direction you like. Last one!",
        stage: () => level0SpotlightSwapPair(0, -1),
        gate: (evt, p) => evt === "swap" && p && p.dy === -1
    },
    {
        key: "spell",
        title: "STEP 4 OF 4 · SPELL A WORD",
        hint: "Now the real thing: drag across 3 or more letters in a line to spell a word. The glowing tiles spell C-A-T.",
        cheer: "🎉 That's a word! You're ready.",
        stage: () => level0PlaceWord(0, 0, "CAT", true),
        gate: (evt) => evt === "wordCleared"
    }
];

function startLevel0() {
    isLevel0 = true;
    isDailyMode = false;
    level0Step = 0;
    level0TargetIds = [];
    level0Locked = false;
    level = 1;
    if (levelValEl) levelValEl.textContent = "🎓";
    startGame(); // stages step 1 + shows its hint via level0EnterStep()
}

function level0CurrentStep() {
    return LEVEL_0_STEPS[level0Step] || null;
}

// Stage the board for the current step, then show its instruction.
function level0EnterStep() {
    const step = level0CurrentStep();
    if (!step) return;
    level0ClearSpotlights();
    level0SpotlightShuffle(false);
    if (typeof step.stage === "function") step.stage();
    level0UpdateControls();
    showLevel0Hint();
}

function showLevel0Hint() {
    const step = level0CurrentStep();
    const hintEl = document.getElementById("level0-hint");
    if (!hintEl || !step) return;
    const titleEl = hintEl.querySelector(".hint-title");
    const textEl = hintEl.querySelector(".hint-text");
    const dotsEl = hintEl.querySelector(".hint-progress");
    if (titleEl) titleEl.textContent = step.title;
    if (textEl) textEl.textContent = step.hint;
    if (dotsEl) {
        dotsEl.textContent = LEVEL_0_STEPS
            .map((_, i) => (i < level0Step ? "●" : i === level0Step ? "◉" : "○"))
            .join("");
    }
    hintEl.classList.remove("hidden", "cheering");
}

function hideLevel0Hint() {
    const hintEl = document.getElementById("level0-hint");
    if (hintEl) hintEl.classList.add("hidden");
}

// Green "you did it" confirmation shown in the hint box between steps.
function showLevel0Cheer(text) {
    const hintEl = document.getElementById("level0-hint");
    if (!hintEl) return;
    const titleEl = hintEl.querySelector(".hint-title");
    const textEl = hintEl.querySelector(".hint-text");
    const dotsEl = hintEl.querySelector(".hint-progress");
    if (titleEl) titleEl.textContent = text;
    if (textEl) textEl.textContent = "";
    if (dotsEl) {
        // The step just cleared counts as done in the tracker.
        dotsEl.textContent = LEVEL_0_STEPS
            .map((_, i) => (i <= level0Step ? "●" : "○"))
            .join("");
    }
    hintEl.classList.remove("hidden");
    hintEl.classList.add("cheering");
}

// Single entry point the rest of the game calls after a real player action.
// Only the CURRENT step's gate can advance the tutorial, so actions done
// out of order are simply ignored rather than skipping ahead.
function level0Notify(evt, payload) {
    if (!isLevel0 || level0Locked) return;
    const step = level0CurrentStep();
    if (!step || typeof step.gate !== "function") return;
    if (!step.gate(evt, payload)) return;

    level0Locked = true;
    level0ClearSpotlights();
    level0SpotlightShuffle(false);
    showLevel0Cheer(step.cheer);
    hapticNotification("Success");
    audio.playLevelUp();

    setTimeout(() => {
        level0Step++;
        level0Locked = false;
        if (level0Step >= LEVEL_0_STEPS.length) {
            level0Celebrate();
        } else {
            level0EnterStep();
        }
    }, LEVEL_0_CHEER_MS);
}

// All four steps cleared: throw the player a proper "you passed" moment
// before handing them a real Level 1 board.
function level0Celebrate() {
    level0Finish({ keepPaused: true });
    hapticNotification("Success");
    audio.playLevelUp();
    const overlay = document.getElementById("level0-complete-overlay");
    if (overlay) {
        overlay.classList.remove("hidden");
    } else {
        // No overlay in the DOM (older shell) -- just start playing.
        selectLevel(1);
    }
}

// Dismiss the celebration and drop the player into a fresh Level 1.
function level0StartLevel1() {
    const overlay = document.getElementById("level0-complete-overlay");
    if (overlay) overlay.classList.add("hidden");
    isDailyMode = false;
    level = 1;
    startGame();
    if (levelValEl) levelValEl.textContent = level;
    showWordClearPopup("GOOD LUCK!", { el: boardEl });
}

// Tear down all guided state. `keepPaused` leaves the rise stopped, used
// when the celebration overlay is about to take over the screen.
function level0Finish({ keepPaused = false } = {}) {
    if (!isLevel0) return;
    localStorage.setItem("wordrop_level0_done", "1");
    isLevel0 = false;
    level0Step = LEVEL_0_STEPS.length;
    level0ClearSpotlights();
    level0SpotlightShuffle(false);
    level0UnlockAllControls();
    hideLevel0Hint();
    if (levelValEl) levelValEl.textContent = level;
    if (!keepPaused && !riseTimerInterval) startRiseTimer();
}

/* --- Level 0 board staging helpers --- */

// Overwrite an existing tile's letter in place (keeps its element, so the
// spotlight class and DOM position survive), or spawn one if the cell is
// empty after gravity.
function level0SetLetter(x, y, letter) {
    const existing = grid[y] && grid[y][x];
    if (!existing) {
        spawnTile(x, y, letter);
        return grid[y][x];
    }
    if (existing.glow) return existing; // never clobber the ⚡ tile
    const value = TILE_VALUES[letter];
    existing.letter = letter;
    existing.value = value;
    existing.el.className = `tile ${getRarityClass(value)}`;
    const letterSpan = existing.el.querySelector(".tile-letter");
    const valueSpan = existing.el.querySelector(".tile-value");
    if (letterSpan) letterSpan.textContent = letter;
    if (valueSpan) valueSpan.textContent = value;
    return existing;
}

// Write `word` starting at (x, y) going right, optionally spotlighting it.
function level0PlaceWord(x, y, word, spotlight = false) {
    const placed = [];
    word.split("").forEach((ch, i) => {
        const tile = level0SetLetter(x + i, y, ch);
        if (tile) placed.push(tile);
    });
    if (spotlight) level0Spotlight(placed);
    return placed;
}

// Spotlight a real, currently-valid pair of adjacent tiles the player can
// drag in direction (dx, dy) -- e.g. (-1, 0) for "move a tile left". Only a
// suggestion: the gate accepts ANY swap in the right direction, so the
// player can practise wherever they like on the board.
function level0SpotlightSwapPair(dx, dy) {
    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx < 0 || tx >= GRID_COLS || ty < 0 || ty >= GRID_ROWS) continue;
            const from = grid[y][x];
            const to = grid[ty][tx];
            if (from && to) {
                level0Spotlight([from, to]);
                return;
            }
        }
    }
    level0ClearSpotlights();
}

/* --- Level 0 spotlight + control gating --- */

function level0Spotlight(tiles) {
    level0ClearSpotlights();
    level0TargetIds = [];
    (tiles || []).forEach(t => {
        if (!t || !t.el) return;
        t.el.classList.add("level0-target");
        level0TargetIds.push(t.id);
    });
}

function level0ClearSpotlights() {
    level0TargetIds = [];
    if (!boardEl) return;
    const container = getTileMatrixContainer() || boardEl;
    container.querySelectorAll(".tile.level0-target")
        .forEach(el => el.classList.remove("level0-target"));
}

function level0SpotlightShuffle(on) {
    if (!btnShuffle) return;
    btnShuffle.classList.toggle("level0-target-btn", !!on);
}

// Only the button the current step is teaching stays live. Everything else
// is disabled so a brand-new player cannot wander off-script or waste
// points on HINT/VORTEX before they know what those do.
function level0UpdateControls() {
    const step = level0CurrentStep();
    const key = step ? step.key : null;
    // The final "rise" step hands the game back to the player, so it must
    // unlock everything rather than keep the training wheels on.
    if (!step || key === "rise") {
        level0UnlockAllControls();
        return;
    }
    if (btnShuffle) btnShuffle.disabled = key !== "shuffle";
    if (btnHint) btnHint.disabled = true;
    if (btnVortex) btnVortex.disabled = true;
}

function level0UnlockAllControls() {
    if (btnShuffle) btnShuffle.disabled = false;
    if (btnHint) btnHint.disabled = false;
    if (btnVortex) btnVortex.disabled = false;
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

    // Start Game (Level 0 if never tutorialized before, else Level 1)
    if (!localStorage.getItem("wordrop_level0_done")) {
        startLevel0();
    } else {
        startGame();
    }
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

    // Tier-1 retention features (daily / share / level0)
    const btnDaily = document.getElementById("btn-daily");
    if (btnDaily) btnDaily.addEventListener("click", () => {
        audio.playClick();
        closeLevelSelectModal();
        startDailyChallenge();
    });
    const btnShare = document.getElementById("btn-share");
    if (btnShare) btnShare.addEventListener("click", () => {
        audio.playClick();
        shareResultCard();
    });
    const btnLevel0 = document.getElementById("btn-level0");
    if (btnLevel0) btnLevel0.addEventListener("click", () => {
        audio.playClick();
        closeLevelSelectModal();
        startLevel0();
    });
    const btnLevel0Start = document.getElementById("btn-level0-start");
    if (btnLevel0Start) btnLevel0Start.addEventListener("click", () => {
        audio.playClick();
        level0StartLevel1();
    });

    // Level goal flow
    const btnNextLevel = document.getElementById("btn-next-level");
    if (btnNextLevel) btnNextLevel.addEventListener("click", () => {
        audio.playClick();
        advanceToNextLevel();
    });
    const btnRetryLevel = document.getElementById("btn-retry-level");
    if (btnRetryLevel) btnRetryLevel.addEventListener("click", () => {
        audio.playClick();
        retryLevel();
    });
    const btnQuitRun = document.getElementById("btn-quit-run");
    if (btnQuitRun) btnQuitRun.addEventListener("click", () => {
        audio.playClick();
        const failed = document.getElementById("level-failed-overlay");
        if (failed) failed.classList.add("hidden");
        openLevelSelectModal();
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
    // Refresh the Daily Challenge status line every time the modal opens.
    const statusEl = document.getElementById("daily-status");
    if (statusEl) {
        const streak = getDailyStreak();
        const parts = [];
        if (streak > 0) parts.push(`🔥 Streak: ${streak} day${streak === 1 ? "" : "s"}`);
        parts.push(hasPlayedDailyToday()
            ? `Today's best: ${getDailyBestToday().toLocaleString()}`
            : "Not played today yet!");
        statusEl.textContent = parts.join(" · ");
    }
    if (levelSelectOverlay) levelSelectOverlay.classList.remove("hidden");
}

function closeLevelSelectModal() {
    audio.playClick();
    if (levelSelectOverlay) levelSelectOverlay.classList.add("hidden");
}

function selectLevel(targetLvl) {
    isDailyMode = false; // picking a manual level always exits daily mode
    // Picking a level mid-tutorial abandons Level 0 cleanly (spotlights off,
    // controls re-enabled) rather than leaving the guided state half-applied.
    if (isLevel0) level0Finish();
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

    // Each level is its own board with its own target now, so jumping to a
    // level deals that level fresh rather than re-speeding the current board.
    score = 0;
    startLevelBoard();
    showWordClearPopup(`LEVEL ${level} · ${getLevelTarget(level)} PTS`, { el: boardEl });

    riseProgress = 0;
    if (timerBarEl) timerBarEl.style.width = "0%";
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

// keepScore: used when moving between levels of the same run (level
// complete / retry), where the running total must survive the new board.
function startGame({ keepScore = false } = {}) {
    // Daily Challenge: re-seed the PRNG at the top of EVERY daily run
    // (not just the first) so replaying today's daily always deals the
    // identical board. Non-daily runs leave dailyRng untouched/unused.
    if (isDailyMode) {
        dailyRng = mulberry32(dailySeedForDate(localDateKey()));
    }

    // Reset scores & states
    if (!keepScore) {
        score = 0;
        scoreAtLevelStart = 0;
        // Level 0 sets level before calling startGame; don't override it
        if (!isLevel0) {
            level = isDailyMode ? DAILY_START_LEVEL : 1;
        }
    }
    // Level-scoped progress always restarts with the board.
    levelScore = 0;
    levelWords = 0;
    levelCompletePending = false;
    wordsClearedCount = keepScore ? wordsClearedCount : 0;
    longestWordSpelled = "—";
    isPlaying = true;
    isPaused = false;
    forceUnlockBoard();
    riseProgress = 0;
    riseDeferredSince = 0;
    tileIdCounter = 0;
    shuffleCooldownActive = false;
    swipePath = [];
    isSwipingPath = false;
    activeMatches = [];
    resizeSwipeCanvas();

    if (scoreValEl) scoreValEl.textContent = formatScore(score);
    if (levelValEl) levelValEl.textContent = isDailyMode ? `${level}🔥` : level;
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
    const lcOverlay = document.getElementById("level-complete-overlay");
    if (lcOverlay) lcOverlay.classList.add("hidden");
    const lfOverlay = document.getElementById("level-failed-overlay");
    if (lfOverlay) lfOverlay.classList.add("hidden");
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

    // Level 0 stages its scripted tiles AFTER resolveInitialMatches(), which
    // would otherwise re-roll the very words the tutorial just placed.
    if (isLevel0) {
        level0EnterStep();
    } else {
        hideLevel0Hint();
        level0UnlockAllControls();
    }

    renderGoalHUD();

    // Start Rise Timer. Level 0 keeps the board completely still until the
    // player reaches the final step, so nothing can kill them mid-lesson.
    if (!isLevel0) {
        startRiseTimer();
    }

    // Soft looping water/wind/forest ambience -- see audio.js. Started
    // here (a real user gesture already happened to reach startGame(),
    // so the AudioContext is free to init) rather than at page load.
    audio.startAmbience();
}

function spawnTile(x, y, forcedLetter = null, isGlow = false, burstValue = null) {
    const parentContainer = getTileMatrixContainer();
    if (!parentContainer) return;

    const letter = forcedLetter || getRandomLetter();
    const value = TILE_VALUES[letter];

    // Determine rarity class (see RARITY_TIERS above)
    const rarityClass = getRarityClass(value);

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
    // gameRand() so daily-mode glow spawns are part of the seeded stream.
    return gameRand() < GLOW_TILE_SPAWN_CHANCE;
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

// Rebalanced 2026-07-31: the original 5-10 range (5 + random(0-5) +
// level/3) meant even a real word only met the threshold ~55% of the time
// AT BEST (when it happened to land in the glow tile's row/column at all),
// which reads as "broken" rather than "a bit lucky" -- confirmed via Monte
// Carlo simulation against calculateWordScore() with common 3-4 letter
// words. A striped/special tile should behave like Candy Crush's striped
// candy: near-guaranteed to do its big thing once matched, not a coin
// flip. New formula is deterministic and low enough that virtually any
// real 3+ letter word clears it at low levels (100% in simulation at
// level 1), with a small, gentle bump at higher levels so it isn't
// completely trivial forever.
function rollGlowThreshold() {
    return 3 + Math.floor(level / 4);
}

function getRandomLetter() {
    // gameRand(), not Math.random -- in Daily Challenge mode this draws
    // from the date-seeded PRNG so everyone gets the same letters.
    const index = Math.floor(gameRand() * WEIGHTED_LETTERS.length);
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
                    
                    // Rebuild inner HTML and classes (see RARITY_TIERS above)
                    const rarityClass = getRarityClass(tile.value);

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

// Abandon an in-progress swipe without scoring it, leaving the board in a
// clean state. Used when a deferred rise has to fire while a finger is
// still down (see startRiseTimer) -- resolving a half-traced path across a
// board shift would score a word the player never actually drew.
function cancelActiveSwipe() {
    if (!isSwipingPath && swipePath.length === 0) return;
    isSwipingPath = false;
    swipePath = [];
    if (boardEl) {
        boardEl.querySelectorAll(".tile.selected").forEach(el => el.classList.remove("selected"));
    }
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    // Direction of the drag, captured before the coordinates are mutated
    // below. Level 0 teaches left/right/down using this. Note y=0 is the
    // FLOOR, so dy = -1 means the player dragged downward on screen.
    const swapDx = targetCol - tileA.x;
    const swapDy = targetRow - tileA.y;
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

        // Level 0: a real 2-tile swap is the gate for the movement steps.
        // Checked after cascades so the gate reads the settled board.
        level0Notify("swap", { dx: swapDx, dy: swapDy });
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
    hapticImpact("Heavy"); // the big payoff moment deserves the big thump

    // Level 0 hears about every meaningful player action, even ones no
    // current step gates on, so steps can be re-ordered without rewiring.
    level0Notify("glowBurst");
}

async function sliceClearWord(match) {
    setBoardLock(true);

    // Snapshot before this word's own tiles are removed below — the glow
    // tile being searched for may be one of the tiles in `match` itself.
    const glowTile = findGlowTileInLine(match);

    // Play sounds: blade slash whoosh + acoustic burst pop + chime
    audio.playSlash();
    audio.playBurstPop();
    // Tactile thump on every word clear -- bigger words hit harder.
    hapticImpact(match.word.length >= 5 ? "Medium" : "Light");

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
    wordsClearedCount++;
    levelWords++; // counted before updateScore, so stars judge this word too
    updateScore(scoreResult.score);

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

    // Level 0: a real word clear is the gate for the swipe/spell steps.
    level0Notify("wordCleared");

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
// actually cleared (a legendary gold tile bursts gold, not a generic cyan).
function getRarityColor(value) {
    return getRarityTier(value).color;
}

function spawnTileSparks(tile) {
    const parentRect = boardEl.getBoundingClientRect();
    const rect = tile.el.getBoundingClientRect();
    const cx = rect.left - parentRect.left + rect.width / 2;
    const cy = rect.top - parentRect.top + rect.height / 2;
    // Glow-tile bursts use the same burning-orange color as the tile's own
    // palette (style.css .tile-glow / --epic-border) so a row/column
    // detonation always reads visually as "that tile's power."
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
    return getRarityTier(value).cssClass;
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

    // Real bug fix (2026-08-02): getLevelMultiplier() existed but was never
    // called anywhere, so the "1.5x ... 5.5x Pts" advertised on every level
    // button -- and "+50% more points per word" in HOW TO PLAY -- did
    // nothing. Picking a harder level bought you a faster board for exactly
    // the same score, which quietly removed the entire risk/reward reason to
    // level up. The level targets below are calibrated assuming this applies.
    const levelMult = getLevelMultiplier(level);

    const finalScore = Math.round(baseScore * lengthMult * directionMult * comboMult * levelMult);
    
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

    // Vaporising the bottom row drops every column, so an in-flight swipe
    // would resolve against shifted tiles. See triggerShuffle()/startRiseTimer().
    cancelActiveSwipe();

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

        const duration = LEVEL_SPEEDS[level] || MAX_RISE_SPEED;
        // Increment progress (ticks every 100ms)
        riseProgress += (100 / (duration * 10));

        if (riseProgress >= 100) {
            // Real bug fix (2026-08-02): never shift the board while the
            // player has a finger down. pushGridUp() moves every tile up one
            // row, but a swipe is assembled by mapping each touchmove
            // coordinate to whatever tile currently occupies that cell -- so
            // a rise landing mid-swipe silently swaps the letters out from
            // under the finger and the player's carefully traced word
            // becomes garbage. That's most visible at high levels, where the
            // rise interval (1.5s at level 10) is shorter than a deliberate
            // 5-6 letter swipe. Hold the rise until the finger lifts.
            if (isSwipingPath) {
                if (riseDeferredSince === 0) riseDeferredSince = Date.now();

                if (Date.now() - riseDeferredSince < MAX_RISE_DEFER_MS) {
                    // Park the bar at full: the rise is genuinely due and
                    // the player can see it's about to land.
                    riseProgress = 100;
                } else {
                    // Finger has been down too long to keep stalling the
                    // game. Drop the in-progress swipe first so the player
                    // never gets a word built from pre- and post-shift
                    // tiles, then rise.
                    cancelActiveSwipe();
                    riseDeferredSince = 0;
                    riseProgress = 0;
                    pushGridUp();
                }
            } else {
                riseDeferredSince = 0;
                riseProgress = 0;
                pushGridUp();
            }
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
                // Overflow now fails the LEVEL, not the whole run: the
                // player retries this level rather than restarting at 1.
                // Daily Challenge keeps the classic single-run game over so
                // the shared daily score stays comparable between players.
                if (isDailyMode) triggerGameOver();
                else failLevel();
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

    // Shuffle relocates every tile, so an in-flight swipe would finish
    // against letters the player never traced. Reachable via multi-touch
    // (one finger dragging the board, another tapping this button). Same
    // hazard the rise defers for -- see startRiseTimer().
    cancelActiveSwipe();

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

        // Activate cooldown (skipped during the Level 0 lesson so the button
        // the tutorial just told them to press doesn't immediately grey out)
        if (!isLevel0) startShuffleCooldown();

        // Check for words created by shuffle
        await resolveBoardCascades();

        // See the note on the glowBurst notify: reported for completeness.
        level0Notify("shuffle");
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
    levelScore += amount;
    scoreValEl.textContent = formatScore(score);

    // Save High Score
    if (score > highScore) {
        highScore = score;
        highScoreValEl.textContent = formatScore(highScore);
        localStorage.setItem("wordrop_high_score", highScore);
    }

    renderGoalHUD();
    checkLevelProgression();
}

// Called after every score change. A level now ends the moment its stated
// target is met, rather than drifting upward on hidden thresholds.
function checkLevelProgression() {
    if (isLevel0 || levelCompletePending) return;
    if (levelScore < getLevelTarget(level)) return;
    completeLevel();
}

function completeLevel() {
    levelCompletePending = true;
    isPaused = true;
    if (riseTimerInterval) { clearInterval(riseTimerInterval); riseTimerInterval = null; }

    const stars = starsForLevel(level, levelWords);
    const bestStars = recordLevelStars(level, stars);
    const isNewBest = stars >= bestStars && stars > 0;

    if (level + 1 > getBestLevelReached()) {
        localStorage.setItem("wordrop_best_level", String(level + 1));
    }

    audio.playLevelUp();
    hapticNotification("Success");
    triggerScreenShake();

    if (level >= 5) gcUnlockOnce("wordrop_ach_level5_done", GC_ACH_LEVEL_5);
    if (level >= 10) gcUnlockOnce("wordrop_ach_level10_done", GC_ACH_LEVEL_10);
    gcSubmitScore(score);

    showLevelCompleteOverlay(stars, isNewBest);
}

// Dismissing the celebration deals a fresh board for the next level. Each
// level being its own board is what makes "retry this level" coherent.
function advanceToNextLevel() {
    const overlay = document.getElementById("level-complete-overlay");
    if (overlay) overlay.classList.add("hidden");
    levelCompletePending = false;
    level++;
    startLevelBoard();
    showWordClearPopup(`LEVEL ${level}!`, { el: boardEl });
}

// Fresh board for the current level, preserving the running total score.
function startLevelBoard() {
    scoreAtLevelStart = score;
    startGame({ keepScore: true });
}

// Overflow before the target was met: the level is failed, not the run.
function failLevel() {
    isPlaying = false;
    if (riseTimerInterval) { clearInterval(riseTimerInterval); riseTimerInterval = null; }
    audio.playGameOver();
    hapticNotification("Error");
    audio.stopAmbience();
    if (boardEl) boardEl.classList.remove("danger");
    showLevelFailedOverlay();
}

// Retry rolls the total score back to where this level began, so repeated
// attempts can't be farmed for points.
function retryLevel() {
    const overlay = document.getElementById("level-failed-overlay");
    if (overlay) overlay.classList.add("hidden");
    score = scoreAtLevelStart;
    if (scoreValEl) scoreValEl.textContent = formatScore(score);
    startLevelBoard();
    showWordClearPopup(`LEVEL ${level} — GO!`, { el: boardEl });
}

function formatScore(val) {
    return String(val).padStart(6, "0");
}

/* --- Goal HUD ---
 * The single most important addition: the player can always see what they
 * are working toward and how close they are. Previously levels arrived as a
 * surprise popup driven by thresholds nothing on screen ever mentioned.
 */
function renderGoalHUD() {
    const bar = document.getElementById("goal-bar");
    const label = document.getElementById("goal-label");
    const value = document.getElementById("goal-value");
    const wrap = document.getElementById("goal-container");
    if (!wrap) return;

    if (isLevel0) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");

    const target = getLevelTarget(level);
    const pct = Math.max(0, Math.min(100, (levelScore / target) * 100));
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = `LEVEL ${level} GOAL`;
    if (value) value.textContent = `${Math.min(levelScore, target)} / ${target}`;

    // Visibly "hot" as the player closes in on the target.
    if (wrap.classList) wrap.classList.toggle("near-goal", pct >= 75 && pct < 100);
}

function starMarkup(stars) {
    return [0, 1, 2].map(i =>
        `<span class="star ${i < stars ? "earned" : "empty"}" style="--i:${i}">${i < stars ? "★" : "☆"}</span>`
    ).join("");
}

function showLevelCompleteOverlay(stars, isNewBest) {
    const overlay = document.getElementById("level-complete-overlay");
    if (!overlay) { advanceToNextLevel(); return; }

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("lc-title", `LEVEL ${level} COMPLETE!`);
    set("lc-score", levelScore.toLocaleString());
    set("lc-words", String(levelWords));
    set("lc-par", `${levelWords} / ${getLevelPar(level)}`);
    set("lc-total-stars", `${getTotalStars()} ★`);
    set("lc-next-target", `Next up: ${getLevelTarget(level + 1).toLocaleString()} pts`);

    const starsEl = document.getElementById("lc-stars");
    if (starsEl) starsEl.innerHTML = starMarkup(stars);

    const praiseEl = document.getElementById("lc-praise");
    if (praiseEl) {
        praiseEl.textContent = stars === 3
            ? "Flawless — you found the big words."
            : stars === 2
                ? "Strong clear. Fewer, longer words for 3 stars."
                : "Level cleared! Longer words score far more.";
    }

    const bestEl = document.getElementById("lc-new-best");
    if (bestEl) bestEl.classList.toggle("hidden", !isNewBest || stars < 3);

    overlay.classList.remove("hidden");
}

function showLevelFailedOverlay() {
    const overlay = document.getElementById("level-failed-overlay");
    if (!overlay) { gameOverOverlay.classList.remove("hidden"); return; }

    const target = getLevelTarget(level);
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("lf-title", `LEVEL ${level} FAILED`);
    set("lf-progress", `${levelScore} / ${target}`);
    set("lf-short-by", `${Math.max(0, target - levelScore)} points short`);

    const bar = document.getElementById("lf-bar");
    if (bar) bar.style.width = `${Math.min(100, (levelScore / target) * 100)}%`;

    set("lf-retry-btn-label", `RETRY LEVEL ${level}`);
    const retryBtn = document.getElementById("btn-retry-level");
    if (retryBtn) retryBtn.textContent = `RETRY LEVEL ${level}`;

    overlay.classList.remove("hidden");
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
        audio.duckAmbience();
    } else {
        pauseOverlay.classList.add("hidden");
        btnPause.textContent = "⏸️";
        audio.unduckAmbience();
    }
}

function triggerGameOver() {
    isPlaying = false;
    if (riseTimerInterval) clearInterval(riseTimerInterval);

    audio.playGameOver();
    hapticNotification("Error");
    audio.stopAmbience();
    boardEl.classList.remove("danger");

    // Level 0: a game over ends the lesson (can't normally happen, since the
    // rise is disabled until the final step, but never trap the player).
    if (isLevel0) level0Finish();

    // Display overlay stats
    finalScoreEl.textContent = score.toLocaleString();
    finalLevelEl.textContent = level;
    finalWordsCountEl.textContent = wordsClearedCount;

    // Daily Challenge: record the finished run (streak counts once/day,
    // best score updates on replays) and surface it on the overlay.
    const dailyLine = document.getElementById("daily-result-line");
    if (dailyLine) {
        if (isDailyMode) {
            const daily = recordDailyRunFinished(score);
            dailyLine.textContent = `🔥 Daily streak: ${daily.streak} day${daily.streak === 1 ? "" : "s"} · Today's best: ${daily.best.toLocaleString()}`;
            dailyLine.classList.remove("hidden");
        } else {
            dailyLine.classList.add("hidden");
        }
    }

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
