/**
 * Local beat / bass-hit detection. Pure DSP on mono PCM: no DOM, no network, runs in a worker.
 *
 *  1. Coarse onset envelope: spectral flux of a log-magnitude STFT (~11 kHz, 1024/128).
 *     'beat' mode uses 30 Hz–5 kHz; 'bass' mode only 20–150 Hz (kicks and bass notes).
 *  2. Tempo: autocorrelation of the envelope over 60–200 BPM, weighted towards ~120 BPM.
 *  3. Positions:
 *     - 'beat': dynamic-programming beat tracker (Ellis 2007): an evenly spaced grid that sits on
 *       the strongest onsets, continuing through quiet passages.
 *     - 'bass': the bass hits themselves (peak picking), so syncopated kicks are kept.
 *  4. Refinement: each position is snapped to the nearest sharp energy rise in the time domain
 *     (≈1.5 ms resolution), so cuts land on the transient rather than on an STFT frame.
 */

export type BeatMode = 'beat' | 'bass';

export interface BeatAnalysis {
  /** Estimated tempo, or null when the audio has no clear pulse. */
  bpm: number | null;
  /** Marker positions in microseconds from the start of the audio. */
  beatsUs: number[];
  /** Relative onset strength per marker, 0..1. */
  strengths: number[];
}

export const ANALYSIS_RATE = 11025;
const FFT_SIZE = 1024;
const HOP = 128;
/** DP tracker: how strongly beats prefer the estimated period (librosa's default). */
const TIGHTNESS = 100;

const EMPTY: BeatAnalysis = { bpm: null, beatsUs: [], strengths: [] };

/* ------------------------------------------------------------------------------------------------
 * Streaming downmix + decimation (decoder output → ~11 kHz mono)
 * ---------------------------------------------------------------------------------------------- */

export class MonoDownmixer {
  private factor = 0;
  private inRate = 0;
  private acc = 0;
  private accN = 0;
  private buf = new Float32Array(1 << 16);
  private len = 0;

  /** Add `frames` samples of planar audio (one Float32Array per channel). */
  push(planes: readonly Float32Array[], frames: number, sampleRate: number): void {
    if (!this.factor) {
      this.inRate = sampleRate;
      this.factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
    }
    const ch = planes.length;
    if (ch === 0) return;
    const f = this.factor;
    for (let j = 0; j < frames; j++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += planes[c]![j]!;
      this.acc += v / ch;
      if (++this.accN === f) {
        this.append(this.acc / f);
        this.acc = 0;
        this.accN = 0;
      }
    }
  }

  private append(v: number) {
    if (this.len === this.buf.length) {
      const b = new Float32Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    this.buf[this.len++] = v;
  }

  finish(): { samples: Float32Array; rate: number } {
    return {
      samples: this.buf.subarray(0, this.len),
      rate: this.factor ? this.inRate / this.factor : ANALYSIS_RATE,
    };
  }
}

/* ------------------------------------------------------------------------------------------------
 * FFT (iterative radix-2, in place)
 * ---------------------------------------------------------------------------------------------- */

function makeFft(n: number) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step]!;
          const wi = -sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  };
}

/* ------------------------------------------------------------------------------------------------
 * Onset envelope
 * ---------------------------------------------------------------------------------------------- */

/**
 * FFT bin ranges [lo, hi] of log-spaced bands: 30 Hz–5 kHz in 'beat' mode, 20–150 Hz (one band
 * per bin, they are already coarse there) in 'bass' mode.
 */
function makeBands(rate: number, mode: BeatMode): [number, number][] {
  const binHz = rate / FFT_SIZE;
  const toBin = (hz: number) => Math.max(1, Math.min(FFT_SIZE / 2, Math.round(hz / binHz)));
  if (mode === 'bass') {
    const out: [number, number][] = [];
    for (let k = toBin(20); k <= toBin(150); k++) out.push([k, k]);
    return out;
  }
  const count = 24;
  const lo = Math.log(30);
  const hi = Math.log(5000);
  const out: [number, number][] = [];
  let last = 0;
  for (let i = 0; i < count; i++) {
    const a = Math.max(last + 1, toBin(Math.exp(lo + ((hi - lo) * i) / count)));
    const b = Math.max(a, toBin(Math.exp(lo + ((hi - lo) * (i + 1)) / count)) - 1);
    if (a > FFT_SIZE / 2) break;
    out.push([a, Math.min(b, FFT_SIZE / 2)]);
    last = b;
  }
  return out;
}

function spectralFlux(x: Float32Array, rate: number, mode: BeatMode): Float32Array {
  const frames = Math.floor((x.length - FFT_SIZE) / HOP) + 1;
  const out = new Float32Array(Math.max(0, frames));
  if (frames <= 0) return out;
  const fft = makeFft(FFT_SIZE);
  const win = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const bands = makeBands(rate, mode);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  let prev = new Float64Array(bands.length);
  let cur = new Float64Array(bands.length);
  const norm = 2 / FFT_SIZE;
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = x[off + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    // Mean positive change of log band energy. Log-spaced bands weigh bass and treble equally
    // (like a mel spectrogram); per-bin sums would let noisy hi-hats outvote the kick drum.
    let flux = 0;
    for (let b = 0; b < bands.length; b++) {
      const [lo, hi] = bands[b]!;
      let power = 0;
      for (let k = lo; k <= hi; k++) power += (re[k]! * norm) ** 2 + (im[k]! * norm) ** 2;
      const v = Math.log1p(1000 * Math.sqrt(power / (hi - lo + 1)));
      cur[b] = v;
      if (f > 0 && v > prev[b]!) flux += v - prev[b]!;
    }
    out[f] = flux / bands.length;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return out;
}

/** Remove the slowly varying part, half-wave rectify, scale to unit std. Null if flat. */
function normalizeEnvelope(raw: Float32Array, frameRate: number): Float32Array | null {
  const n = raw.length;
  const half = Math.max(1, Math.round(0.2 * frameRate));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + raw[i]!;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    env[i] = Math.max(0, raw[i]! - (prefix[b]! - prefix[a]!) / (b - a));
  }
  let sum = 0;
  let sq = 0;
  for (const v of env) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  if (!(std > 1e-6)) return null;
  for (let i = 0; i < n; i++) env[i] = env[i]! / std;
  return env;
}

/* ------------------------------------------------------------------------------------------------
 * Tempo
 * ---------------------------------------------------------------------------------------------- */

/** Beat period in envelope frames (fractional), or null when there's no periodicity. */
function estimatePeriod(env: Float32Array, frameRate: number): number | null {
  const n = env.length;
  const minLag = Math.max(2, Math.floor((frameRate * 60) / 200));
  const maxLag = Math.min(n - 2, Math.ceil((frameRate * 60) / 60));
  if (maxLag <= minLag + 2) return null;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i]! * env[i + lag]!;
    ac[lag] = s / (n - lag);
  }
  let best = -1;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    const score = ac[lag]! * w;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0) return null;
  // Parabolic interpolation for a fractional period.
  const a = ac[best - 1]!;
  const b = ac[best]!;
  const c = ac[best + 1]!;
  const den = a - 2 * b + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return best + shift;
}

/* ------------------------------------------------------------------------------------------------
 * Positions
 * ---------------------------------------------------------------------------------------------- */

function smooth(env: Float32Array): Float32Array {
  const k = [0.05, 0.25, 0.4, 0.25, 0.05];
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += (env[i + j] ?? 0) * k[j + 2]!;
    out[i] = s;
  }
  return out;
}

/** Ellis-style dynamic programming: an evenly spaced beat grid aligned to strong onsets. */
function trackBeats(env: Float32Array, period: number): number[] {
  const n = env.length;
  const ls = smooth(env);
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.round(period / 2));
  const hi = Math.max(lo + 1, Math.round(period * 2));
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let tau = Math.max(0, t - hi); tau <= t - lo; tau++) {
      const v = score[tau]! - TIGHTNESS * Math.log((t - tau) / period) ** 2;
      if (v > best) {
        best = v;
        arg = tau;
      }
    }
    score[t] = ls[t]! + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  let last = -1;
  let lastScore = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) {
    if (score[t]! > lastScore) {
      lastScore = score[t]!;
      last = t;
    }
  }
  const beats: number[] = [];
  for (let t = last; t >= 0; t = back[t]!) beats.push(t);
  beats.reverse();
  // Trim leading/trailing beats that sit on silence (intro/outro).
  const strengths = beats.map((b) => ls[b]!);
  const rms = Math.sqrt(strengths.reduce((s, v) => s + v * v, 0) / Math.max(1, strengths.length));
  const thr = 0.5 * rms;
  let a = 0;
  let b = beats.length;
  while (a < b && strengths[a]! < thr) a++;
  while (b > a && strengths[b - 1]! < thr) b--;
  return beats.slice(a, b);
}

/** Onset peaks: local maxima clearly above the local average, at least `minGap` apart. */
function pickPeaks(env: Float32Array, frameRate: number, period: number | null): number[] {
  const n = env.length;
  const w = Math.max(2, Math.round(0.03 * frameRate));
  const avgW = Math.max(w, Math.round(0.5 * frameRate));
  const minGap = Math.max(
    1,
    Math.round(Math.max(0.1, period ? (period / frameRate) * 0.25 : 0.1) * frameRate),
  );
  const prefix = new Float64Array(n + 1);
  let max = 0;
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i]! + env[i]!;
    max = Math.max(max, env[i]!);
  }
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = env[i]!;
    if (v < 0.1 * max) continue;
    let isMax = true;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
      if (env[j]! > v || (j < i && env[j]! === v)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - avgW);
    const b = Math.min(n, i + avgW + 1);
    if (v < (prefix[b]! - prefix[a]!) / (b - a) + 1) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minGap) {
      if (v > env[last]!) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

/* ------------------------------------------------------------------------------------------------
 * Time-domain refinement
 * ---------------------------------------------------------------------------------------------- */

/** One-pole low-pass, applied twice (≈12 dB/oct), for bass-mode refinement. */
function lowpass(x: Float32Array, rate: number, cutoff: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoff) / rate);
  const y = new Float32Array(x.length);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    s1 = (1 - a) * x[i]! + a * s1;
    s2 = (1 - a) * s1 + a * s2;
    y[i] = s2;
  }
  return y;
}

class EnergyRise {
  private prefix: Float64Array;
  private readonly frame: number;
  readonly hop: number;
  private readonly lag = 4;

  constructor(
    y: Float32Array,
    private readonly rate: number,
    frameSeconds: number,
  ) {
    this.prefix = new Float64Array(y.length + 1);
    for (let i = 0; i < y.length; i++) this.prefix[i + 1] = this.prefix[i]! + y[i]! * y[i]!;
    this.frame = Math.max(8, Math.round(frameSeconds * rate));
    this.hop = Math.max(1, Math.round(0.00145 * rate));
  }

  /** Log energy of the rectangular frame ending at sample `end`. */
  private logE(end: number): number {
    const b = Math.min(this.prefix.length - 1, Math.max(0, end));
    const a = Math.max(0, b - this.frame);
    return Math.log(1e-10 + (this.prefix[b]! - this.prefix[a]!) / this.frame);
  }

  /**
   * Sharpest energy rise within ±window of `t` (seconds). Returns the onset time, or null when
   * nothing rises clearly (e.g. a grid beat in a quiet passage).
   */
  refine(t: number, window: number): number | null {
    const from = Math.round((t - window) * this.rate);
    const to = Math.round((t + window) * this.rate);
    let best = 0;
    let at = -1;
    const span = this.lag * this.hop;
    for (let end = from; end <= to; end += this.hop) {
      const d = this.logE(end) - this.logE(end - span);
      if (d > best) {
        best = d;
        at = end;
      }
    }
    if (at < 0 || best < 0.5) return null;
    // The rise spans `lag` hops; the onset sits in the middle of it.
    return Math.max(0, (at - span / 2) / this.rate);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------------------------------- */

export function detectBeats(x: Float32Array, rate: number, mode: BeatMode): BeatAnalysis {
  if (x.length < FFT_SIZE * 4) return EMPTY;
  let sq = 0;
  for (let i = 0; i < x.length; i++) sq += x[i]! * x[i]!;
  if (Math.sqrt(sq / x.length) < 1e-4) return EMPTY;

  const frameRate = rate / HOP;
  const env = normalizeEnvelope(spectralFlux(x, rate, mode), frameRate);
  if (!env) return EMPTY;
  const period = estimatePeriod(env, frameRate);
  const bpm = period ? Math.round(((60 * frameRate) / period) * 10) / 10 : null;

  const frames =
    mode === 'beat' && period ? trackBeats(env, period) : pickPeaks(env, frameRate, period);
  if (frames.length === 0) return { bpm, beatsUs: [], strengths: [] };

  const rise = new EnergyRise(
    mode === 'bass' ? lowpass(x, rate, 150) : x,
    rate,
    mode === 'bass' ? 0.03 : 0.02,
  );
  let max = 0;
  for (const f of frames) max = Math.max(max, env[f]!);
  const window = Math.min(0.06, period ? (0.25 * period) / frameRate : 0.06);

  const beatsUs: number[] = [];
  const strengths: number[] = [];
  for (const f of frames) {
    // Flux at frame f compares windows f-1 and f; the change sits near the window centre.
    const coarse = (f * HOP + FFT_SIZE / 2) / rate;
    const t = rise.refine(coarse, window) ?? coarse;
    const us = Math.round(t * 1_000_000);
    if (beatsUs.length && us - beatsUs[beatsUs.length - 1]! < 40_000) continue;
    beatsUs.push(us);
    strengths.push(max > 0 ? Math.min(1, env[f]! / max) : 0);
  }
  return { bpm, beatsUs, strengths };
}
