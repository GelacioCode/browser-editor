import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, DEFAULT_TRANSFORM, type VideoClip } from '@viditor/project-core';
import { clipGainAt, fadeEnvelope, gainAutomation } from './audio.ts';
import { mediaLayerBox, boxContains } from './layout.ts';

const clip: VideoClip = {
  id: 'c',
  kind: 'video',
  trackId: 't',
  mediaId: 'm',
  start: 100,
  duration: 100,
  sourceInUs: 0,
  speed: 1,
  transform: DEFAULT_TRANSFORM,
  audio: { ...DEFAULT_AUDIO, gain: 0.5, fadeIn: 10, fadeOut: 20 },
  beatsUs: [],
};

describe('audio envelope', () => {
  it('ramps in and out linearly', () => {
    expect(fadeEnvelope(clip, 100)).toBe(0);
    expect(fadeEnvelope(clip, 105)).toBeCloseTo(0.5);
    expect(fadeEnvelope(clip, 150)).toBe(1);
    expect(fadeEnvelope(clip, 190)).toBeCloseTo(0.5);
    expect(clipGainAt(clip, 150)).toBe(0.5);
  });

  it('produces automation points that match the envelope', () => {
    const fps = { num: 25, den: 1 };
    const pts = gainAutomation(clip, fps);
    expect(pts).toEqual([
      { time: 4, value: 0 },
      { time: 4.4, value: 0.5 },
      { time: 7.2, value: 0.5 },
      { time: 8, value: 0 },
    ]);
  });
});

describe('layout', () => {
  it('fits media into the sequence and hit-tests rotated boxes', () => {
    const seq = { width: 1920, height: 1080, fps: { num: 30, den: 1 }, background: '#000000' };
    const box = mediaLayerBox(seq, 1080, 1920, DEFAULT_TRANSFORM); // portrait source
    expect(box.height).toBeCloseTo(1080);
    expect(box.width).toBeCloseTo(607.5);
    expect(boxContains(box, 960, 540)).toBe(true);
    expect(boxContains(box, 100, 540)).toBe(false);
  });
});
