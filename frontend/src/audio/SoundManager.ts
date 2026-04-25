/**
 * Sound system for GoForKids.
 * Web Audio API for procedural sounds.
 * Active sound pack is selected via the settings store's themeId.
 */

import { useSettingsStore, densityMultiplier } from '../store/settingsStore';
import { getTheme } from '../theme/themes';

let audioCtx: AudioContext | null = null;
let masterGainNode: GainNode | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Single output node every sound goes through, so density / mute can be
 * applied in one place. Connected to ctx.destination once at first use.
 * Updated reactively whenever the settings store changes density.
 */
function getMasterGain(): GainNode {
  const ctx = getContext();
  if (!masterGainNode) {
    masterGainNode = ctx.createGain();
    masterGainNode.gain.setValueAtTime(
      densityMultiplier(useSettingsStore.getState().density),
      ctx.currentTime,
    );
    masterGainNode.connect(ctx.destination);
    // React to density changes without restart.
    useSettingsStore.subscribe((s, prev) => {
      if (s.density === prev.density) return;
      const node = masterGainNode;
      if (!node) return;
      node.gain.setTargetAtTime(densityMultiplier(s.density), ctx.currentTime, 0.05);
    });
  }
  return masterGainNode;
}

// ---------- Sample playback for classic pack ----------

const SAMPLE_PATHS = {
  place: '/assets/placement.m4a',
  capture: '/assets/capture.m4a',
} as const;

type SampleKey = keyof typeof SAMPLE_PATHS;

const sampleBuffers: Partial<Record<SampleKey, AudioBuffer>> = {};
const sampleLoading: Partial<Record<SampleKey, Promise<AudioBuffer | null>>> = {};

async function loadSample(key: SampleKey): Promise<AudioBuffer | null> {
  if (sampleBuffers[key]) return sampleBuffers[key]!;
  if (sampleLoading[key]) return sampleLoading[key]!;

  const ctx = getContext();
  const promise = fetch(SAMPLE_PATHS[key])
    .then((r) => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      sampleBuffers[key] = decoded;
      return decoded;
    })
    .catch((e) => {
      console.warn(`Failed to load sound sample ${key}:`, e);
      return null;
    });

  sampleLoading[key] = promise;
  return promise;
}

function playSample(key: SampleKey, volume = 1): boolean {
  const buf = sampleBuffers[key];
  if (!buf) {
    // Fire-and-forget load for next time
    loadSample(key);
    return false;
  }
  const ctx = getContext();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  src.connect(gain);
  gain.connect(getMasterGain());
  src.start();
  return true;
}

// Preload on module init so the first placement has the sample ready
loadSample('place');
loadSample('capture');

function activePack(): 'cosmic' | 'classic' {
  return getTheme(useSettingsStore.getState().themeId).soundPack;
}

export function resumeAudio() {
  const ctx = getContext();
  if (ctx.state === 'suspended') ctx.resume();
}

// ============================================================
// COSMIC PACK — resonant chimes, layered capture impact
// ============================================================

function cosmicPlace(row: number, col: number) {
  const ctx = getContext();
  const now = ctx.currentTime;

  const positionFactor = (row + col) / 36;
  const baseFreq = 600 + positionFactor * 200;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseFreq, now);
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, now + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(getMasterGain());
  osc.start(now);
  osc.stop(now + 0.3);

  const click = ctx.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(2000, now);
  click.frequency.exponentialRampToValueAtTime(200, now + 0.02);

  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.05, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

  click.connect(clickGain);
  clickGain.connect(getMasterGain());
  click.start(now);
  click.stop(now + 0.03);
}

function cosmicCapture(captureCount: number) {
  const ctx = getContext();
  const now = ctx.currentTime;

  const intensity = Math.min(captureCount / 4, 1);
  const isBig = captureCount >= 3;

  // Impact thud
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120 + intensity * 40, now);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.15);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.25 + intensity * 0.15, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  thud.connect(thudGain); thudGain.connect(getMasterGain());
  thud.start(now); thud.stop(now + 0.2);

  // Bright crack
  const crack = ctx.createOscillator();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(3000 + intensity * 1000, now);
  crack.frequency.exponentialRampToValueAtTime(300, now + 0.06);
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.08 + intensity * 0.05, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  crack.connect(crackGain); crackGain.connect(getMasterGain());
  crack.start(now); crack.stop(now + 0.08);

  // Descending swoosh
  const swoosh = ctx.createOscillator();
  swoosh.type = 'sine';
  const swooshDur = 0.4 + intensity * 0.3;
  swoosh.frequency.setValueAtTime(500 + intensity * 300, now + 0.05);
  swoosh.frequency.exponentialRampToValueAtTime(60, now + 0.05 + swooshDur);
  const swooshGain = ctx.createGain();
  swooshGain.gain.setValueAtTime(0.001, now);
  swooshGain.gain.linearRampToValueAtTime(0.12 + intensity * 0.08, now + 0.08);
  swooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05 + swooshDur);
  swoosh.connect(swooshGain); swooshGain.connect(getMasterGain());
  swoosh.start(now); swoosh.stop(now + 0.05 + swooshDur);

  // Noise burst
  const bufferSize = Math.floor(ctx.sampleRate * 0.15);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08 * (1 + intensity), now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1200 + intensity * 800, now);
  filter.Q.setValueAtTime(1.5, now);
  noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(getMasterGain());
  noise.start(now);

  if (isBig) {
    const bell = ctx.createOscillator();
    bell.type = 'sine';
    bell.frequency.setValueAtTime(880, now + 0.1);
    const bellGain = ctx.createGain();
    bellGain.gain.setValueAtTime(0.001, now);
    bellGain.gain.linearRampToValueAtTime(0.08, now + 0.15);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    bell.connect(bellGain); bellGain.connect(getMasterGain());
    bell.start(now + 0.1); bell.stop(now + 0.8);

    const bell2 = ctx.createOscillator();
    bell2.type = 'sine';
    bell2.frequency.setValueAtTime(1320, now + 0.12);
    const bell2Gain = ctx.createGain();
    bell2Gain.gain.setValueAtTime(0.001, now);
    bell2Gain.gain.linearRampToValueAtTime(0.04, now + 0.17);
    bell2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    bell2.connect(bell2Gain); bell2Gain.connect(getMasterGain());
    bell2.start(now + 0.12); bell2.stop(now + 0.7);
  }
}

function cosmicPass() {
  const ctx = getContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(330, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(gain); gain.connect(getMasterGain());
  osc.start(now); osc.stop(now + 0.2);
}

function cosmicGameEnd() {
  const ctx = getContext();
  const now = ctx.currentTime;
  const freqs = [264, 330, 396];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    osc.connect(gain); gain.connect(getMasterGain());
    osc.start(now); osc.stop(now + 1.5);
  }
}

// ============================================================
// CLASSIC PACK — wooden tock, minimal capture
// ============================================================

/** Classic placement — use the real recorded clack, fall back to synth on load failure. */
function classicPlace(_row: number, _col: number) {
  if (playSample('place', 1)) return;
  classicPlaceSynth();
}

/** Procedural fallback if the sample fails to load. */
function classicPlaceSynth() {
  const ctx = getContext();
  const now = ctx.currentTime;

  // Layer 1 — brittle "crack" (the stone's contact surface)
  // Short highpassed noise burst gives the sharp porcelain/slate transient
  const bufSize = Math.floor(ctx.sampleRate * 0.025);
  const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(2000, now);
  const crack = ctx.createBiquadFilter();
  crack.type = 'bandpass';
  crack.frequency.setValueAtTime(3200, now);
  crack.Q.setValueAtTime(4, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
  noise.connect(hp); hp.connect(crack); crack.connect(noiseGain); noiseGain.connect(getMasterGain());
  noise.start(now);

  // Layer 2 — wooden "knock" (the board resonance)
  // Mid-range damped sine, very short, gives the "hitting hardwood" body
  const knock = ctx.createOscillator();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime(780, now);
  knock.frequency.exponentialRampToValueAtTime(420, now + 0.05);
  const knockGain = ctx.createGain();
  knockGain.gain.setValueAtTime(0.001, now);
  knockGain.gain.linearRampToValueAtTime(0.25, now + 0.003);
  knockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  knock.connect(knockGain); knockGain.connect(getMasterGain());
  knock.start(now); knock.stop(now + 0.08);

  // Layer 3 — brief harmonic of the knock for wood grain character
  const grain = ctx.createOscillator();
  grain.type = 'sine';
  grain.frequency.setValueAtTime(1560, now);
  grain.frequency.exponentialRampToValueAtTime(900, now + 0.04);
  const grainGain = ctx.createGain();
  grainGain.gain.setValueAtTime(0.001, now);
  grainGain.gain.linearRampToValueAtTime(0.08, now + 0.002);
  grainGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  grain.connect(grainGain); grainGain.connect(getMasterGain());
  grain.start(now); grain.stop(now + 0.05);
}

/** Classic capture — use the real recorded sound, fall back to synth on load failure. */
function classicCapture(captureCount: number) {
  if (playSample('capture', 1)) return;
  classicCaptureSynth(captureCount);
}

/** Procedural fallback if the sample fails to load. */
function classicCaptureSynth(captureCount: number) {
  const ctx = getContext();
  const now = ctx.currentTime;
  const intensity = Math.min(captureCount / 4, 1);

  // Slightly deeper tock
  const bufSize = Math.floor(ctx.sampleRate * 0.06);
  const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1400, now);
  filter.Q.setValueAtTime(4, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.35 + intensity * 0.15, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(getMasterGain());
  noise.start(now);

  // Body thump
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(130, now);
  body.frequency.exponentialRampToValueAtTime(90, now + 0.15);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.22 + intensity * 0.12, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  body.connect(bodyGain); bodyGain.connect(getMasterGain());
  body.start(now); body.stop(now + 0.18);
}

function classicPass() {
  // A single low wooden tap
  const ctx = getContext();
  const now = ctx.currentTime;
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(160, now);
  body.frequency.exponentialRampToValueAtTime(120, now + 0.08);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.1, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  body.connect(bodyGain); bodyGain.connect(getMasterGain());
  body.start(now); body.stop(now + 0.1);
}

function classicGameEnd() {
  // Two soft taps in succession
  const ctx = getContext();
  const now = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const start = now + i * 0.18;
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(180 - i * 30, start);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.12, start);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    body.connect(bodyGain); bodyGain.connect(getMasterGain());
    body.start(start); body.stop(start + 0.15);
  }
}

// ============================================================
// Public API — route to the active pack
// ============================================================

export function playPlaceSound(row: number, col: number) {
  if (activePack() === 'classic') classicPlace(row, col);
  else cosmicPlace(row, col);
}

export function playCaptureSound(captureCount: number) {
  if (activePack() === 'classic') classicCapture(captureCount);
  else cosmicCapture(captureCount);
}

export function playPassSound() {
  if (activePack() === 'classic') classicPass();
  else cosmicPass();
}

export function playGameEndSound() {
  if (activePack() === 'classic') classicGameEnd();
  else cosmicGameEnd();
}
