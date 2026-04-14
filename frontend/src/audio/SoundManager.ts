/**
 * Sound system for GoForKids.
 * Uses Web Audio API for procedural sounds (no asset files needed).
 * Per design doc: "Sound design is first-class."
 */

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/** Ensure audio context is resumed (needed after user gesture) */
export function resumeAudio() {
  const ctx = getContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
}

/**
 * Stone placement: soft resonant chime.
 * Varies slightly by board position for subtle spatial feel.
 */
export function playPlaceSound(row: number, col: number) {
  const ctx = getContext();
  const now = ctx.currentTime;

  // Base frequency varies by position (higher near top-right, lower near bottom-left)
  const positionFactor = (row + col) / 36; // 0 to 1
  const baseFreq = 600 + positionFactor * 200; // 600-800 Hz range

  // Main tone
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseFreq, now);
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, now + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);

  // Soft click transient
  const click = ctx.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(2000, now);
  click.frequency.exponentialRampToValueAtTime(200, now + 0.02);

  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.05, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

  click.connect(clickGain);
  clickGain.connect(ctx.destination);
  click.start(now);
  click.stop(now + 0.03);
}

/**
 * Capture sound: punchy impact + shatter + descending whoosh.
 * Bigger captures = bigger, more layered sound.
 */
export function playCaptureSound(captureCount: number) {
  const ctx = getContext();
  const now = ctx.currentTime;

  const intensity = Math.min(captureCount / 4, 1); // Scale up to 4 stones
  const isBig = captureCount >= 3;

  // Layer 1: Impact thud (low punch)
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120 + intensity * 40, now);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.15);

  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.25 + intensity * 0.15, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  thud.connect(thudGain);
  thudGain.connect(ctx.destination);
  thud.start(now);
  thud.stop(now + 0.2);

  // Layer 2: Bright crack/shatter (high transient)
  const crack = ctx.createOscillator();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(3000 + intensity * 1000, now);
  crack.frequency.exponentialRampToValueAtTime(300, now + 0.06);

  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.08 + intensity * 0.05, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  crack.connect(crackGain);
  crackGain.connect(ctx.destination);
  crack.start(now);
  crack.stop(now + 0.08);

  // Layer 3: Descending swoosh (the satisfying "fall")
  const swoosh = ctx.createOscillator();
  swoosh.type = 'sine';
  const swooshDur = 0.4 + intensity * 0.3;
  swoosh.frequency.setValueAtTime(500 + intensity * 300, now + 0.05);
  swoosh.frequency.exponentialRampToValueAtTime(60, now + 0.05 + swooshDur);

  const swooshGain = ctx.createGain();
  swooshGain.gain.setValueAtTime(0.001, now);
  swooshGain.gain.linearRampToValueAtTime(0.12 + intensity * 0.08, now + 0.08);
  swooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05 + swooshDur);

  swoosh.connect(swooshGain);
  swooshGain.connect(ctx.destination);
  swoosh.start(now);
  swoosh.stop(now + 0.05 + swooshDur);

  // Layer 4: Noise burst for texture
  const bufferSize = Math.floor(ctx.sampleRate * 0.15);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08 * (1 + intensity), now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1200 + intensity * 800, now);
  filter.Q.setValueAtTime(1.5, now);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);

  // Layer 5: Resonant ring for big captures (victory bell)
  if (isBig) {
    const bell = ctx.createOscillator();
    bell.type = 'sine';
    bell.frequency.setValueAtTime(880, now + 0.1);

    const bellGain = ctx.createGain();
    bellGain.gain.setValueAtTime(0.001, now);
    bellGain.gain.linearRampToValueAtTime(0.08, now + 0.15);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    bell.connect(bellGain);
    bellGain.connect(ctx.destination);
    bell.start(now + 0.1);
    bell.stop(now + 0.8);

    // Harmonic
    const bell2 = ctx.createOscillator();
    bell2.type = 'sine';
    bell2.frequency.setValueAtTime(1320, now + 0.12);

    const bell2Gain = ctx.createGain();
    bell2Gain.gain.setValueAtTime(0.001, now);
    bell2Gain.gain.linearRampToValueAtTime(0.04, now + 0.17);
    bell2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    bell2.connect(bell2Gain);
    bell2Gain.connect(ctx.destination);
    bell2.start(now + 0.12);
    bell2.stop(now + 0.7);
  }
}

/**
 * Pass sound: quiet neutral tone.
 */
export function playPassSound() {
  const ctx = getContext();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(330, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/**
 * Game end sound: resonant chord.
 */
export function playGameEndSound() {
  const ctx = getContext();
  const now = ctx.currentTime;

  const freqs = [264, 330, 396]; // C major chord
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.5);
  }
}
