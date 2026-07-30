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

/* --- Initialization --- */

async function initGame() {
    initDOMElements();
    highScore = parseInt(localStorage.getItem("wordrop_high_score")) || 0;
    if (highScoreValEl) highScoreValEl.textContent = formatScore(highScore);

    // Sync Gamer Tag with input & Sentry context
    if (gamerTagInput) gamerTagInput.value = gamerTag;
    if (window.Sentry && typeof Sentry.setUser === "function") {
        Sentry.setUser({ username: gamerTag, id: gamerTag });
    }

    // Initialize Swipe Canvas
    canvas = document.getElementById("swipe-canvas");
    if (canvas) {
        ctx = canvas.getContext("2d");
        resizeSwipeCanvas();
    }

    // Initialize Dictionary async
    validator.init().catch(err => console.warn("Dictionary async init fallback:", err));

    // Attach Event Listeners
    setupEventListeners();

    // Start Game
    startGame();
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initGame);
} else {
    initGame();
}

function resizeSwipeCanvas() {
    if (canvas) {
        canvas.width = boardEl.clientWidth;
        canvas.height = boardEl.clientHeight;
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
            if (window.Sentry && typeof Sentry.setUser === "function") {
                Sentry.setUser({ username: gamerTag, id: gamerTag });
            }
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

    // Board Touch/Mouse Swipe Interaction
    boardEl.addEventListener("pointerdown", onPointerDown);
    boardEl.addEventListener("pointermove", onPointerMove);
    boardEl.addEventListener("pointerup", onPointerUp);
    boardEl.addEventListener("pointercancel", onPointerUp);
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

function spawnTile(x, y, forcedLetter = null) {
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
    tileEl.className = `tile ${rarityClass}`;
    tileEl.style.setProperty("--col", x);
    tileEl.style.setProperty("--row", y);
    
    const id = tileIdCounter++;
    tileEl.dataset.id = id;

    // Create interior layout
    tileEl.innerHTML = `
        <div class="tile-inner">
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
        el: tileEl
    };
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

/* --- Drag & Swap / Path Word Tracing System --- */

function onPointerDown(e) {
    if (!isPlaying || isPaused || isBoardLocked) return;

    // Clear any previous visual selections
    boardEl.querySelectorAll(".tile.selected").forEach(el => el.classList.remove("selected"));
    swipePath = [];

    const tileEl = e.target.closest(".tile");
    // Unmute/resume AudioContext on first interact
    audio.init();

    if (tileEl) {
        const id = parseInt(tileEl.dataset.id);
        const tile = getTileById(id);
        if (!tile) return;

        isSwipingPath = true;
        swipePath.push(tile);
        tile.el.classList.add("selected");
        audio.playClick();

        // Lock pointer capture to active canvas to follow dragging
        canvas.setPointerCapture(e.pointerId);
        drawSwipePath();
    }
}

function onPointerMove(e) {
    if (!isSwipingPath) return;

    // Find active element under pointer coordinates
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    const tileEl = el.closest(".tile");
    if (!tileEl) return;

    const id = parseInt(tileEl.dataset.id);
    const tile = getTileById(id);
    if (!tile) return;

    const lastTile = swipePath[swipePath.length - 1];
    if (tile.id === lastTile.id) return; // Pointer still hovering over the last tile in path

    // 1. Backtrack detection: Allow players to reverse their path
    if (swipePath.length >= 2 && tile.id === swipePath[swipePath.length - 2].id) {
        const removedTile = swipePath.pop();
        removedTile.el.classList.remove("selected");
        audio.playClick();
        drawSwipePath();
        return;
    }

    // 2. Prevent self-intersection loops
    if (swipePath.some(t => t.id === tile.id)) return;

    // 3. Grid Adjacency check (must be right next to each other, no diagonals)
    const dx = Math.abs(tile.x - lastTile.x);
    const dy = Math.abs(tile.y - lastTile.y);
    const isAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
    if (!isAdjacent) return;

    // 4. Straight-line constraint (lock path to vertical or horizontal)
    if (swipePath.length >= 2) {
        const firstTile = swipePath[0];
        const isHorizontal = firstTile.y === lastTile.y;
        if (isHorizontal) {
            // Must stay on same row
            if (tile.y !== firstTile.y) return;
        } else {
            // Must stay on same column
            if (tile.x !== firstTile.x) return;
        }
    }

    // Accept tile into path
    swipePath.push(tile);
    tile.el.classList.add("selected");
    audio.playSwipeStep(swipePath.length);
    drawSwipePath();
}

function onPointerUp(e) {
    if (!isSwipingPath) return;
    
    isSwipingPath = false;
    boardEl.querySelectorAll(".tile.selected").forEach(el => el.classList.remove("selected"));

    const path = [...swipePath];
    swipePath = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (path.length === 2) {
        // CASE A: User swiped exactly 2 adjacent tiles -> SWAP them
        const tileA = path[0];
        const tileB = path[1];
        executeSwap(tileA, tileB.x, tileB.y);
    } 
    else if (path.length >= 3) {
        // CASE B: User swiped 3+ tiles in a line -> Validate Word
        const wordStr = path.map(t => t.letter).join("").toLowerCase();
        
        if (validator.isValidWord(wordStr)) {
            // Successful word spelled! Clear it
            sliceClearWord({ word: wordStr, tiles: path });
        } else {
            // Word not valid in dictionary: flash trail neon red
            drawErrorPath(path);
            audio.playClick(); // short warning/dud feedback click
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

async function sliceClearWord(match) {
    setBoardLock(true);
    
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

function spawnWordBurstRing(tiles) {
    if (!tiles || tiles.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    tiles.forEach(t => {
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
    });

    const ring = document.createElement("div");
    ring.className = "word-burst-ring";
    
    const leftPct = (minX / GRID_COLS) * 100;
    const bottomPct = (minY / GRID_ROWS) * 100;
    const widthPct = ((maxX - minX + 1) / GRID_COLS) * 100;
    const heightPct = ((maxY - minY + 1) / GRID_ROWS) * 100;

    ring.style.left = `calc(${leftPct}% - 4px)`;
    ring.style.bottom = `calc(${bottomPct}% - 4px)`;
    ring.style.width = `calc(${widthPct}% + 8px)`;
    ring.style.height = `calc(${heightPct}% + 8px)`;

    boardEl.appendChild(ring);

    setTimeout(() => ring.remove(), 450);
}

function spawnTileSparks(tile) {
    const parentRect = boardEl.getBoundingClientRect();
    const rect = tile.el.getBoundingClientRect();
    const cx = rect.left - parentRect.left + rect.width / 2;
    const cy = rect.top - parentRect.top + rect.height / 2;

    for (let i = 0; i < 4; i++) {
        const p = document.createElement("div");
        p.className = "burst-particle";
        p.style.left = `${cx}px`;
        p.style.top = `${cy}px`;

        const angle = (Math.PI * 2 * i) / 4 + (Math.random() * 0.4 - 0.2);
        const dist = 25 + Math.random() * 25;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;

        p.style.setProperty("--dx", `${dx}px`);
        p.style.setProperty("--dy", `${dy}px`);

        boardEl.appendChild(p);
        setTimeout(() => p.remove(), 500);
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

        // 3. Spawn new row at bottom (Row 0)
        for (let x = 0; x < GRID_COLS; x++) {
            spawnTile(x, 0);
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
        
        // Gather all active tiles on the board
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

    // 2. Floating score popup over cleared tiles
    if (anchorTile) {
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
