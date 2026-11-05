import type { Rational } from './time.ts';
import { frameToSeconds, secondsToNearestFrame } from './time.ts';

export interface SrtCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const [, h, mi, se, ms] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(se) + Number(ms!.padEnd(3, '0')) / 1000;
}

export function parseSrt(input: string): SrtCue[] {
  const blocks = (input.charCodeAt(0) === 0xfeff ? input.slice(1) : input)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const [a, b] = lines[timingIdx]!.split('-->');
    const start = parseTime(a ?? '');
    const end = parseTime(b ?? '');
    if (start === null || end === null || end <= start) continue;
    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) cues.push({ startSeconds: start, endSeconds: end, text });
  }
  return cues.sort((x, y) => x.startSeconds - y.startSeconds);
}

function fmt(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function formatSrt(cues: SrtCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.startSeconds)} --> ${fmt(c.endSeconds)}\n${c.text}\n`)
    .join('\n');
}

export function cueToFrames(cue: SrtCue, fps: Rational): { start: number; duration: number } {
  const start = secondsToNearestFrame(cue.startSeconds, fps);
  const end = secondsToNearestFrame(cue.endSeconds, fps);
  return { start, duration: Math.max(1, end - start) };
}

export function framesToCue(start: number, duration: number, text: string, fps: Rational): SrtCue {
  return {
    startSeconds: frameToSeconds(start, fps),
    endSeconds: frameToSeconds(start + duration, fps),
    text,
  };
}
