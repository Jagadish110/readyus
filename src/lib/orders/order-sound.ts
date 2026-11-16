/**
 * Sounds for the shop console, made in the browser so no sound file is needed:
 * a ring that loops until it is stopped, and short tones for accept, decline and payment.
 *
 * Browsers only let a page make sound after the person has tapped or typed on it once,
 * so the console calls `unlockSound()` on the first touch and `soundReady()` says whether it worked.
 */

const KEY = 'localty-order-sound';
const CHANGED = 'localty:order-sound';

let context: AudioContext | null = null;
let ringBuffer: AudioBuffer | null = null;
let ringSource: AudioBufferSourceNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  try {
    context ??= new AudioContext();
    return context;
  } catch {
    return null;
  }
}

/** Sound is on unless the owner turned it off on this device. */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered across visits; still applies to this page.
  }
  if (!on) stopRinging();
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: on }));
}

/** Hear about the switch being flipped anywhere on the page. Returns the function that stops listening. */
export function onSoundEnabledChange(listener: (on: boolean) => void): () => void {
  const handle = (event: Event) => listener(Boolean((event as CustomEvent<boolean>).detail));
  window.addEventListener(CHANGED, handle);
  return () => window.removeEventListener(CHANGED, handle);
}

/** True once the browser will actually play sound for this page. */
export function soundReady(): boolean {
  return audio()?.state === 'running';
}

/** Call from a tap or key press: that is the only moment a browser agrees to switch sound on. */
export async function unlockSound(): Promise<boolean> {
  const ctx = audio();
  if (!ctx) return false;
  try {
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    // Still locked; the next tap tries again.
  }
  return ctx.state === 'running';
}

/** One ring cycle: two short double-tone bursts, then a pause. Looped by the browser itself, with no timers. */
function ringCycle(ctx: AudioContext): AudioBuffer {
  if (ringBuffer && ringBuffer.sampleRate === ctx.sampleRate) return ringBuffer;
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.floor(rate * 2.2), rate);
  const samples = buffer.getChannelData(0);
  const burst = 0.42;
  for (const start of [0, 0.55]) {
    const from = Math.floor(start * rate);
    const length = Math.floor(burst * rate);
    for (let i = 0; i < length; i += 1) {
      const t = i / rate;
      // Fade in and out over 15 ms so each burst starts and ends without a click.
      const edge = Math.min(1, t / 0.015, (burst - t) / 0.015);
      samples[from + i] = 0.22 * edge * (Math.sin(2 * Math.PI * 880 * t) + Math.sin(2 * Math.PI * 1175 * t));
    }
  }
  ringBuffer = buffer;
  return buffer;
}

export function isRinging(): boolean {
  return ringSource !== null;
}

/** Start the ring and keep it going until `stopRinging()`. Returns false if the browser has not allowed sound yet. */
export function startRinging(): boolean {
  if (ringSource) return true;
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return false;
  try {
    const source = ctx.createBufferSource();
    source.buffer = ringCycle(ctx);
    source.loop = true;
    source.connect(ctx.destination);
    source.start();
    ringSource = source;
    return true;
  } catch {
    return false;
  }
}

export function stopRinging() {
  const source = ringSource;
  ringSource = null;
  if (!source) return;
  try {
    source.stop();
    source.disconnect();
  } catch {
    // Already stopped.
  }
}

/**
 * A few notes in a row, each fading out. Silent if the browser has not allowed sound yet, or if the shop
 * muted its console (`always` is for the customer's side, which that switch does not cover).
 */
function notes(frequencies: number[], gap: number, length: number, type: OscillatorType = 'sine', always = false) {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running' || (!always && !soundEnabled())) return;
  try {
    frequencies.forEach((frequency, index) => {
      const at = ctx.currentTime + index * gap;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + length + 0.05);
    });
  } catch {
    // No sound this time; the screen still shows what happened.
  }
}

/** Order accepted: three quick rising notes. */
export const playAccepted = () => notes([659, 880, 1319], 0.11, 0.3);

/** Order declined: two low falling notes. */
export const playDeclined = () => notes([440, 294], 0.2, 0.4, 'triangle');

/** A short two-tone chime, for a payment that has just arrived or to confirm sound is on. */
export const chime = () => notes([880, 1175], 0.18, 0.4);

/** Customer side, order placed: a bright four-note rise. */
export const playOrderPlaced = () => notes([523, 659, 784, 1047], 0.1, 0.35, 'sine', true);
