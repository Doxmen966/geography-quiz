// Sound effects, synthesized with the Web Audio API so no audio files are
// needed. Browsers only allow audio after a user gesture; every sound here is
// triggered by a tap, which also unlocks the AudioContext on iOS.

const STORAGE_KEY = 'soundMuted';

let ctx = null;
let muted = false;
try { muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* private mode */ }

function audio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  ctx ??= new AudioContext();
  // iOS suspends ("interrupted") the context e.g. after a phone call.
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

// One note with a short attack and exponential decay.
function tone(ac, { freq, start = 0, duration = 0.15, type = 'sine', volume = 0.25, slideTo }) {
  const t = ac.currentTime + start;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

const SOUNDS = {
  // Bright rising two-note "ding" (E5 → A5).
  correct(ac) {
    tone(ac, { freq: 659.25, duration: 0.12, type: 'triangle', volume: 0.3 });
    tone(ac, { freq: 880, start: 0.09, duration: 0.25, type: 'triangle', volume: 0.3 });
  },
  // Low falling buzz.
  wrong(ac) {
    tone(ac, { freq: 220, duration: 0.35, type: 'sawtooth', volume: 0.12, slideTo: 110 });
    tone(ac, { freq: 233, duration: 0.35, type: 'square', volume: 0.06, slideTo: 116 });
  },
  // Short fanfare: C major arpeggio ending on a held chord.
  record(ac) {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => tone(ac, { freq, start: i * 0.11, duration: 0.14, type: 'triangle', volume: 0.25 }));
    for (const freq of [523.25, 659.25, 783.99, 1046.5]) {
      tone(ac, { freq, start: 0.36, duration: 0.7, type: 'triangle', volume: 0.12 });
    }
  },
};

export function play(name) {
  if (muted) return;
  const ac = audio();
  if (ac) SOUNDS[name](ac);
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* private mode */ }
}
