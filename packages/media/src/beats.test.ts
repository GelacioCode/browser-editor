import { describe, expect, it } from 'vitest';
import { MonoDownmixer, detectBeats } from './beats.ts';

const RATE = 44100;

/** Deterministic noise so tests are stable. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

function render(seconds: number, events: { t: number; kind: 'click' | 'kick' | 'hat' }[]) {
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  const noise = rng(7);
  for (let i = 0; i < n; i++) left[i] = noise() * 0.01; // faint background hiss
  for (const e of events) {
    const start = Math.round(e.t * RATE);
    const len = Math.round((e.kind === 'kick' ? 0.12 : 0.03) * RATE);
    for (let j = 0; j < len && start + j < n; j++) {
      const tt = j / RATE;
      let v: number;
      if (e.kind === 'click') v = 0.8 * Math.sin(2 * Math.PI * 1500 * tt) * Math.exp(-tt / 0.008);
      else if (e.kind === 'kick')
        v =
          0.9 *
          Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-tt / 0.02)) * tt) *
          Math.exp(-tt / 0.05);
      else v = 0.5 * noise() * 2 * Math.exp(-tt / 0.006) * (j % 2 ? 1 : -1);
      left[start + j] = left[start + j]! + v;
    }
  }
  return left;
}

/** Run through the same downmix path the worker uses (stereo 44.1 kHz in). */
function analyse(left: Float32Array, mode: 'beat' | 'bass') {
  const mix = new MonoDownmixer();
  const block = 4096;
  for (let i = 0; i < left.length; i += block) {
    const a = left.subarray(i, i + block);
    mix.push([a, a], a.length, RATE);
  }
  const { samples, rate } = mix.finish();
  return detectBeats(samples, rate, mode);
}

function expectNear(found: number[], expected: number[], tolS: number) {
  for (const e of expected) {
    const hit = found.some((f) => Math.abs(f / 1e6 - e) <= tolS);
    expect(hit, `no marker within ${tolS * 1000} ms of ${e.toFixed(3)} s`).toBe(true);
  }
  for (const f of found) {
    const hit = expected.some((e) => Math.abs(f / 1e6 - e) <= tolS);
    expect(hit, `unexpected marker at ${(f / 1e6).toFixed(3)} s`).toBe(true);
  }
}

describe('beat detection', () => {
  it('finds every beat of a 120 BPM click track to within 15 ms', () => {
    const times = Array.from({ length: 16 }, (_, i) => 0.3 + i * 0.5);
    const r = analyse(
      render(
        8.6,
        times.map((t) => ({ t, kind: 'click' })),
      ),
      'beat',
    );
    expect(r.bpm).not.toBeNull();
    expect(Math.abs(r.bpm! - 120)).toBeLessThan(2);
    expectNear(r.beatsUs, times, 0.015);
    expect(r.strengths.every((s) => s >= 0 && s <= 1)).toBe(true);
  });

  it('handles 90 BPM', () => {
    const times = Array.from({ length: 12 }, (_, i) => 0.4 + (i * 60) / 90);
    const r = analyse(
      render(
        8.4,
        times.map((t) => ({ t, kind: 'click' })),
      ),
      'beat',
    );
    expect(Math.abs(r.bpm! - 90)).toBeLessThan(2);
    expectNear(r.beatsUs, times, 0.015);
  });

  it('bass mode follows syncopated kicks and ignores hi-hats', () => {
    // A 2-second bar of kicks with an off-beat push, repeated; hats on every 8th in between.
    const bar = [0, 0.5, 1.25, 1.5];
    const kicks: number[] = [];
    for (let b = 0; b < 4; b++) for (const k of bar) kicks.push(0.3 + b * 2 + k);
    const hats = Array.from({ length: 32 }, (_, i) => 0.3 + 0.125 + i * 0.25);
    const events = [
      ...kicks.map((t) => ({ t, kind: 'kick' as const })),
      ...hats.map((t) => ({ t, kind: 'hat' as const })),
    ];
    const r = analyse(render(8.6, events), 'bass');
    expectNear(r.beatsUs, kicks, 0.02);
  });

  it('keeps the beat grid in a full mix (kick, snare, hats, chords, noise) at 128 BPM', () => {
    const bpm = 128;
    const beat = 60 / bpm;
    const seconds = 12;
    const beats = Array.from(
      { length: Math.floor((seconds - 0.6) / beat) },
      (_, i) => 0.5 + i * beat,
    );
    const events = [
      ...beats.map((t) => ({ t, kind: 'kick' as const })),
      ...beats.filter((_, i) => i % 2 === 1).map((t) => ({ t, kind: 'click' as const })), // snare-ish
      ...beats.map((t) => ({ t: t + beat / 2, kind: 'hat' as const })),
    ];
    const mix = render(seconds, events);
    // Sustained chords (changing every bar) and broadband noise make onsets less obvious.
    const noise = rng(3);
    const chords = [
      [220, 277.2, 329.6],
      [196, 246.9, 293.7],
    ];
    for (let i = 0; i < mix.length; i++) {
      const t = i / RATE;
      const chord = chords[Math.floor(t / (beat * 4)) % 2]!;
      let pad = 0;
      for (const f of chord) pad += Math.sin(2 * Math.PI * f * t);
      mix[i] = mix[i]! + 0.12 * pad + 0.06 * noise();
    }
    const r = analyse(mix, 'beat');
    expect(Math.abs(r.bpm! - bpm)).toBeLessThan(2);
    expectNear(r.beatsUs, beats, 0.015);
  });

  it('returns nothing for silence', () => {
    const r = detectBeats(new Float32Array(11025 * 5), 11025, 'beat');
    expect(r).toEqual({ bpm: null, beatsUs: [], strengths: [] });
  });
});
