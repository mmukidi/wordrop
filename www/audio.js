/**
 * audio.js
 * Synthesizes retro-arcade sound effects using Web Audio API.
 * Requires user gesture to unlock the AudioContext.
 */

/* Music and sound effects are INDEPENDENT channels (2026-08-02).
 * They serve different needs: plenty of players want the satisfying
 * word-clear thwack while listening to their own music, and others want
 * the ambience but silence in a quiet room. A single mute forced an
 * all-or-nothing choice. Both preferences persist across sessions.
 */
const SFX_PREF_KEY = "wordrop_sfx_enabled";
const MUSIC_PREF_KEY = "wordrop_music_enabled";

function loadPref(key) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? true : v === "1"; // default ON for a fresh install
    } catch { return true; }
}

function savePref(key, on) {
    try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* private mode */ }
}

class GameAudio {
    constructor() {
        this.ctx = null;
        this.sfxEnabled = loadPref(SFX_PREF_KEY);
        this.musicEnabled = loadPref(MUSIC_PREF_KEY);
        this.ambienceNodes = null;   // set once startAmbience() builds the graph
        this.ambienceDucked = false; // true while paused
    }

    init() {
        if (this.ctx) return;
        // Create audio context on first user click/touch
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            this.ctx = new AudioContextClass();
        }
    }

    _resumeIfSuspended() {
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    }

    // One-shot sound effects only. Music is unaffected.
    toggleSfx() {
        this.sfxEnabled = !this.sfxEnabled;
        savePref(SFX_PREF_KEY, this.sfxEnabled);
        if (this.sfxEnabled) this._resumeIfSuspended();
        return this.sfxEnabled;
    }

    // Ambient soundtrack only. Sound effects are unaffected. Muting ramps
    // the ambience's own master gain rather than tearing down and
    // rebuilding the node graph, so unmuting resumes instantly with no
    // click and without restarting the track.
    toggleMusic() {
        this.musicEnabled = !this.musicEnabled;
        savePref(MUSIC_PREF_KEY, this.musicEnabled);
        if (this.musicEnabled) this._resumeIfSuspended();
        if (this.ambienceNodes) {
            this._setAmbienceTargetGain(this._ambienceTargetLevel(), 0.4);
        }
        return this.musicEnabled;
    }

    // Kept so any older caller still works: flips BOTH channels together,
    // driven by whether anything is currently audible.
    toggle() {
        const turningOn = !(this.sfxEnabled || this.musicEnabled);
        this.sfxEnabled = turningOn;
        this.musicEnabled = turningOn;
        savePref(SFX_PREF_KEY, this.sfxEnabled);
        savePref(MUSIC_PREF_KEY, this.musicEnabled);
        if (turningOn) this._resumeIfSuspended();
        if (this.ambienceNodes) {
            this._setAmbienceTargetGain(this._ambienceTargetLevel(), 0.4);
        }
        return turningOn;
    }

    // Short tactile tick/click for tile select
    playClick() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = "sine";
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
            
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Quick swoosh/slide sound for swaps
    playSwap() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = "triangle";
            osc.frequency.setValueAtTime(350, now);
            osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
            
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(now);
            osc.stop(now + 0.12);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Ascending arpeggio chime when words form
    playWordClear(wordLength = 2) {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            
            // Lush Major Add9 / Pentatonic notes: C5, D5, E5, G5, A5, C6, D6, E6
            const notes = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
            // Ensure minimum notes is 3, maximum is note list length
            const numNotes = Math.max(3, Math.min(wordLength, notes.length));
            
            for (let i = 0; i < numNotes; i++) {
                const noteTime = now + (i * 0.08); // 80ms spacing
                const freq = notes[i];
                
                // 1. Primary oscillator (Triangle for warm body)
                const osc1 = this.ctx.createOscillator();
                const gain1 = this.ctx.createGain();
                
                osc1.type = "triangle";
                osc1.frequency.setValueAtTime(freq, noteTime);
                
                // Soft fade in, smooth release
                gain1.gain.setValueAtTime(0.001, noteTime);
                gain1.gain.linearRampToValueAtTime(0.08, noteTime + 0.02);
                gain1.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.5);
                
                // Low-pass filter to keep it warm and soothing
                const filter = this.ctx.createBiquadFilter();
                filter.type = "lowpass";
                filter.frequency.setValueAtTime(1000, noteTime);
                filter.frequency.exponentialRampToValueAtTime(400, noteTime + 0.5);
                
                osc1.connect(filter);
                filter.connect(gain1);
                gain1.connect(this.ctx.destination);
                
                osc1.start(noteTime);
                osc1.stop(noteTime + 0.55);

                // 2. Harmonic oscillator (Sine 1 octave up for sparkling brightness)
                const osc2 = this.ctx.createOscillator();
                const gain2 = this.ctx.createGain();
                
                osc2.type = "sine";
                osc2.frequency.setValueAtTime(freq * 2, noteTime);
                
                gain2.gain.setValueAtTime(0.001, noteTime);
                gain2.gain.linearRampToValueAtTime(0.04, noteTime + 0.03);
                gain2.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);
                
                osc2.connect(gain2);
                gain2.connect(this.ctx.destination);
                
                osc2.start(noteTime);
                osc2.stop(noteTime + 0.65);
            }
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Exploding noise explosion with a bass drop for combos
    playCombo(streak = 2) {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            
            // 1. Chime base (high pitch arpeggio)
            const oscChime = this.ctx.createOscillator();
            const gainChime = this.ctx.createGain();
            
            oscChime.type = "sine";
            // Scale frequency up with combo streak
            const baseFreq = 880 + (streak * 110);
            oscChime.frequency.setValueAtTime(baseFreq, now);
            oscChime.frequency.exponentialRampToValueAtTime(baseFreq * 2, now + 0.2);
            
            gainChime.gain.setValueAtTime(0.1, now);
            gainChime.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            
            oscChime.connect(gainChime);
            gainChime.connect(this.ctx.destination);
            
            oscChime.start(now);
            oscChime.stop(now + 0.25);

            // 2. Low Frequency Bass Rumble (sub impact)
            const oscBass = this.ctx.createOscillator();
            const gainBass = this.ctx.createGain();
            
            oscBass.type = "triangle";
            oscBass.frequency.setValueAtTime(120, now);
            oscBass.frequency.linearRampToValueAtTime(40, now + 0.4);
            
            gainBass.gain.setValueAtTime(0.2, now);
            gainBass.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            
            oscBass.connect(gainBass);
            gainBass.connect(this.ctx.destination);
            
            oscBass.start(now);
            oscBass.stop(now + 0.4);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Alarm beep for high danger row warning
    playDangerWarning() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = "sawtooth"; // buzz sound
            osc.frequency.setValueAtTime(180, now);
            
            gain.gain.setValueAtTime(0.04, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
            
            // Filter to make it a muffled warning alarm
            const filter = this.ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(400, now);
            
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(now);
            osc.stop(now + 0.3);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Satisfying sword slash sound (blade whoosh)
    playSlash() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            
            // Create a short 0.2-second buffer of white noise
            const bufferSize = this.ctx.sampleRate * 0.2;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            
            // Noise source node
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            
            // Bandpass filter to sweep frequency down (Blade whoosh sound)
            const filter = this.ctx.createBiquadFilter();
            filter.type = "bandpass";
            filter.Q.setValueAtTime(3.0, now);
            filter.frequency.setValueAtTime(3000, now);
            filter.frequency.exponentialRampToValueAtTime(800, now + 0.18);
            
            // Gain envelope
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            
            noise.start(now);
            noise.stop(now + 0.2);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Soft acoustic burst pop for word explosions
    playBurstPop() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = "sine";
            osc.frequency.setValueAtTime(280, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);

            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.09);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Gentle bell chime for Hint powerup
    playHint() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 bell chime
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const startTime = now + idx * 0.06;

                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(0.08, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(startTime);
                osc.stop(startTime + 0.36);
            });
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Multi-pitch ascending chime for continuous swiping
    playSwipeStep(stepIndex = 0) {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const pentatonicScale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25]; // C4, D4, E4, G4, A4, C5, D5, E5
            const freq = pentatonicScale[Math.min(stepIndex, pentatonicScale.length - 1)];

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now);

            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.13);
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Triumphant Level Up Fanfare
    playLevelUp() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 triumphant chime
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const startTime = now + idx * 0.08;

                osc.type = "triangle";
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(0.12, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(startTime);
                osc.stop(startTime + 0.46);
            });
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // Descending sad chord for game over
    playGameOver() {
        if (!this.sfxEnabled) return;
        this.init();
        if (!this.ctx) return;
        
        try {
            const now = this.ctx.currentTime;
            const baseFreqs = [220, 165, 110]; // A Minor chord notes A3, E3, A2
            
            baseFreqs.forEach((freq, index) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                
                osc.type = "triangle";
                osc.frequency.setValueAtTime(freq, now);
                osc.frequency.linearRampToValueAtTime(freq * 0.5, now + 0.8);
                
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8 + (index * 0.1));
                
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                
                osc.start(now);
                osc.stop(now + 1.0);
            });
        } catch (e) {
            console.error("Audio error:", e);
        }
    }

    // ====================================================================
    // Ambient background music -- real produced tracks (bundled audio
    // files), not synthesis. Layers cleanly under the SFX above using the
    // same Web Audio graph (a single master GainNode). Independent
    // play/pause/stop lifecycle from the one-shot SFX methods, but shares
    // the same enabled/mute toggle (see toggle() above) and the game's
    // own pause state (see duckAmbience()/unduckAmbience(), called from
    // togglePause() in game.js).
    //
    // Design history (kept because the failure modes are informative):
    // v1 layered a synthesized wind bed (noise with its filter cutoff
    // swept by an LFO) and a static 3-tone pad drone -- sweeping a
    // resonant filter on noise is what tuning an AM radio dial sounds
    // like, and a pure tone under continuous noise reads as a carrier
    // signal in static. Removed for sounding like "radio noise". v2
    // replaced it with synthesized WHITE noise through a bandpass filter
    // for "rain hiss" -- but white noise (flat energy across all
    // frequencies) is *literally* what dead-channel/TV static is made
    // of, so of course it read as "television no channel frequency
    // sound". v3 used synthesized PINK noise instead (soft, rolled-off
    // spectrum) with scattered noise-burst droplets and a generative
    // piano layer -- an improvement, but still procedurally synthesized
    // and not what the user actually wanted. v4 made the water drops
    // rhythmic and pitched rather than randomly scattered. v5 (this
    // version) drops the synthesis approach entirely in favor of real
    // produced music: two original AI-generated (Suno) tracks the user
    // made from a "soothing water + piano" prompt, bundled as local
    // assets and alternated between plays for variety across a longer
    // session -- see AMBIENCE_TRACKS below.
    // ====================================================================

    // Local, bundled tracks (see assets/audio/) -- both are original
    // AI-generated (Suno) compositions the user produced themselves for
    // this game, not third-party copyrighted material. One is picked at
    // random each time a track starts, and a new one is picked again
    // each time the current one finishes, so a long session hears both
    // in a random order rather than one track looping in isolation.
    static AMBIENCE_TRACKS = [
        "assets/audio/rainstone-loop-1.mp3",
        "assets/audio/rainstone-loop-2.mp3"
    ];

    // The volume ambience should be sitting at right now, given mute and
    // pause state -- single source of truth so toggle()/duck/unduck don't
    // have to duplicate this logic.
    _ambienceTargetLevel() {
        if (!this.musicEnabled) return 0;
        return this.ambienceDucked ? 0.12 : 1.0;
    }

    _setAmbienceTargetGain(level, rampSeconds) {
        if (!this.ambienceNodes || !this.ctx) return;
        const now = this.ctx.currentTime;
        const g = this.ambienceNodes.master.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(level, now + rampSeconds);
    }

    // Fetches + decodes a track once and caches the decoded AudioBuffer
    // (decodeAudioData is the slow part -- fetch is a fast local asset
    // read, but decoding a multi-minute mp3 isn't instant) so replays
    // later in the session don't re-decode.
    async _loadTrackBuffer(url) {
        if (!this._trackBufferCache) this._trackBufferCache = {};
        if (this._trackBufferCache[url]) return this._trackBufferCache[url];
        const res = await fetch(url);
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
        this._trackBufferCache[url] = audioBuf;
        return audioBuf;
    }

    // Picks a random track, loads it, and plays it once through the
    // ambience master gain -- then, when it naturally finishes, picks
    // another random track and repeats, so playback continues
    // indefinitely alternating between the two. This is async (fetch +
    // decode take real time), so it always re-checks that this.ambienceNodes
    // is still the SAME graph it started with before touching anything --
    // stopAmbience() or a fresh startAmbience() may have run while a
    // track was loading, in which case this bails out rather than
    // starting playback into a stale/torn-down graph.
    async _playNextAmbienceTrack() {
        if (!this.ambienceNodes || !this.ctx) return;
        const nodes = this.ambienceNodes;
        try {
            const url = GameAudio.AMBIENCE_TRACKS[Math.floor(Math.random() * GameAudio.AMBIENCE_TRACKS.length)];
            const buffer = await this._loadTrackBuffer(url);
            if (this.ambienceNodes !== nodes) return; // stale -- stopped/restarted while loading
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(nodes.master);
            source.onended = () => {
                // Fires both on natural end-of-track AND on an explicit
                // stop() call -- only chain into the next track for the
                // former (checked via the same staleness guard above).
                if (this.ambienceNodes === nodes) this._playNextAmbienceTrack();
            };
            source.start();
            nodes.sources = [source];
        } catch (e) {
            console.error("Ambience audio error:", e);
        }
    }

    startAmbience() {
        if (this.ambienceNodes) return; // already running -- idempotent
        this.init();
        if (!this.ctx) return;

        try {
            const ctx = this.ctx;
            const master = ctx.createGain();
            master.gain.setValueAtTime(0.0, ctx.currentTime);
            master.connect(ctx.destination);

            this.ambienceNodes = { master, sources: [] };
            this.ambienceDucked = false;
            this._setAmbienceTargetGain(this._ambienceTargetLevel(), 3.0); // slow fade-in
            this._playNextAmbienceTrack(); // kick off track playback (async: fetch + decode)
        } catch (e) {
            console.error("Ambience audio error:", e);
        }
    }

    stopAmbience() {
        if (!this.ambienceNodes || !this.ctx) return;
        const nodes = this.ambienceNodes;
        this.ambienceNodes = null; // idempotent immediately, even before the fade finishes -- also what _playNextAmbienceTrack() checks to stop chaining
        try {
            const now = this.ctx.currentTime;
            nodes.master.gain.cancelScheduledValues(now);
            nodes.master.gain.setValueAtTime(nodes.master.gain.value, now);
            nodes.master.gain.linearRampToValueAtTime(0.0, now + 1.2);
            setTimeout(() => {
                nodes.sources.forEach(n => { try { n.stop(); } catch (e) { /* already stopped, or hadn't started loading yet */ } });
            }, 1300);
        } catch (e) {
            console.error("Ambience stop error:", e);
        }
    }

    // Called when the game is paused/resumed (see togglePause() in
    // game.js) -- ducks the ambience to a faint background level rather
    // than stopping it outright, so resuming feels seamless.
    duckAmbience() {
        this.ambienceDucked = true;
        this._setAmbienceTargetGain(this._ambienceTargetLevel(), 0.6);
    }

    unduckAmbience() {
        this.ambienceDucked = false;
        this._setAmbienceTargetGain(this._ambienceTargetLevel(), 0.6);
    }
}

export const audio = new GameAudio();
