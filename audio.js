/**
 * audio.js
 * Synthesizes retro-arcade sound effects using Web Audio API.
 * Requires user gesture to unlock the AudioContext.
 */

class GameAudio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    init() {
        if (this.ctx) return;
        // Create audio context on first user click/touch
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            this.ctx = new AudioContextClass();
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled && this.ctx && this.ctx.state === "suspended") {
            this.ctx.resume();
        }
        return this.enabled;
    }

    // Short tactile tick/click for tile select
    playClick() {
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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
        if (!this.enabled) return;
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

    // Descending sad chord for game over
    playGameOver() {
        if (!this.enabled) return;
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
}

export const audio = new GameAudio();
