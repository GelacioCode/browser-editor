import { describe, expect, it } from 'vitest';
import {
  ProjectEngine,
  createProject,
  clipEnd,
  findClip,
  framesToSourceUs,
  frameToUs,
  secondsToFrame,
  sourceUsToFrames,
  parseSrt,
  formatSrt,
  parseProjectDocument,
  serializeProject,
  visualLayersAt,
  beatFrames,
  snapPoints,
  type Clip,
  type MediaItem,
  type Project,
  type VideoClip,
} from './index.ts';

const media = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  kind: 'video',
  name: 'clip.mp4',
  label: 'Video 1',
  durationUs: 10_000_000, // 10 s
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  sampleRate: 48000,
  channels: 2,
  rotation: 0,
  sizeBytes: 1000,
  lastModified: 0,
  relativePath: null,
  ...over,
});

function setup(): {
  engine: ProjectEngine;
  p: () => Project;
  videoTrack: string;
  audioTrack: string;
} {
  const project = createProject({ projectId: 'p_test', now: new Date(0) });
  const engine = new ProjectEngine(project, { now: () => 0 });
  const videoTrack = project.tracks[0]!.id;
  const audioTrack = project.tracks[1]!.id;
  const r = engine.apply({
    ops: [
      { type: 'addMedia', media: media() },
      {
        type: 'addClip',
        clip: {
          id: 'c1',
          kind: 'video',
          trackId: videoTrack,
          mediaId: 'm1',
          start: 0,
          duration: 150,
        },
      },
    ],
  });
  expect(r.ok).toBe(true);
  return { engine, p: () => engine.project, videoTrack, audioTrack };
}

const video = (p: Project, id: string) => findClip(p, id) as VideoClip;

describe('time', () => {
  it('handles NTSC rational rates without drift', () => {
    const fps = { num: 30000, den: 1001 };
    expect(frameToUs(30000, fps)).toBe(1001 * 1_000_000);
    expect(secondsToFrame(1001, fps)).toBe(30000);
    const us = framesToSourceUs(299, fps, 1);
    expect(sourceUsToFrames(us, fps, 1)).toBe(299);
  });
});

describe('ProjectEngine', () => {
  it('splits a clip into two contiguous clips with correct source in-points', () => {
    const { engine, p } = setup();
    const r = engine.apply({
      ops: [{ type: 'splitClip', clipId: 'c1', frame: 60, newClipId: 'c2' }],
    });
    expect(r.ok).toBe(true);
    const a = video(p(), 'c1');
    const b = video(p(), 'c2');
    expect(a.duration).toBe(60);
    expect(b.start).toBe(60);
    expect(b.duration).toBe(90);
    expect(b.sourceInUs).toBe(2_000_000);
  });

  it('rejects split points on clip boundaries', () => {
    const { engine } = setup();
    const r = engine.apply({ ops: [{ type: 'splitClip', clipId: 'c1', frame: 0 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_RANGE');
  });

  it('trims start and end, adjusting source in-point', () => {
    const { engine, p } = setup();
    expect(
      engine.apply({ ops: [{ type: 'trimClip', clipId: 'c1', edge: 'start', frame: 30 }] }).ok,
    ).toBe(true);
    expect(video(p(), 'c1')).toMatchObject({ start: 30, duration: 120, sourceInUs: 1_000_000 });
    expect(
      engine.apply({ ops: [{ type: 'trimClip', clipId: 'c1', edge: 'end', frame: 100 }] }).ok,
    ).toBe(true);
    expect(video(p(), 'c1')).toMatchObject({ start: 30, duration: 70 });
  });

  it('refuses to extend a clip past the end of its media', () => {
    const { engine } = setup();
    const r = engine.apply({ ops: [{ type: 'trimClip', clipId: 'c1', edge: 'end', frame: 400 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_RANGE');
  });

  it('prevents overlapping clips on one track', () => {
    const { engine, videoTrack } = setup();
    const r = engine.apply({
      ops: [
        {
          type: 'addClip',
          clip: { kind: 'video', trackId: videoTrack, mediaId: 'm1', start: 100, duration: 30 },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OVERLAP');
  });

  it('rejects clips on incompatible tracks', () => {
    const { engine, audioTrack } = setup();
    const r = engine.apply({
      ops: [
        {
          type: 'addClip',
          clip: { kind: 'video', trackId: audioTrack, mediaId: 'm1', start: 0, duration: 30 },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TRACK_MISMATCH');
  });

  it('applies a batch atomically: one failing op rolls back the whole batch', () => {
    const { engine, p } = setup();
    const before = p();
    const r = engine.apply({
      ops: [
        { type: 'moveClip', clipId: 'c1', start: 10 },
        { type: 'deleteClip', clipId: 'missing' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
      expect(r.error.opIndex).toBe(1);
    }
    expect(p()).toBe(before);
  });

  it('undoes and redoes a batch as a single step', () => {
    const { engine, p } = setup();
    engine.apply({
      ops: [
        { type: 'splitClip', clipId: 'c1', frame: 50, newClipId: 'c2' },
        { type: 'deleteClip', clipId: 'c1' },
        { type: 'addTitle', start: 0, duration: 30, text: 'Hello', clipId: 't1' },
      ],
    });
    expect(
      p()
        .clips.map((c) => c.id)
        .sort(),
    ).toEqual(['c2', 't1']);
    engine.undo();
    expect(p().clips.map((c) => c.id)).toEqual(['c1']);
    expect(video(p(), 'c1').duration).toBe(150);
    engine.redo();
    expect(
      p()
        .clips.map((c) => c.id)
        .sort(),
    ).toEqual(['c2', 't1']);
  });

  it('increments revision on every commit, including undo', () => {
    const { engine } = setup();
    const r0 = engine.revision;
    engine.apply({ ops: [{ type: 'moveClip', clipId: 'c1', start: 5 }] });
    expect(engine.revision).toBe(r0 + 1);
    engine.undo();
    expect(engine.revision).toBe(r0 + 2);
  });

  it('rejects stale revisions', () => {
    const { engine } = setup();
    const stale = engine.revision - 1;
    const r = engine.apply({
      expectedRevision: stale,
      ops: [{ type: 'moveClip', clipId: 'c1', start: 5 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('STALE_REVISION');
  });

  it('is idempotent for repeated opIds', () => {
    const { engine, p } = setup();
    const tx = { opId: 'op-1', ops: [{ type: 'duplicateClip' as const, clipId: 'c1' }] };
    const a = engine.apply(tx);
    const b = engine.apply(tx);
    expect(a.ok && b.ok).toBe(true);
    if (b.ok) expect(b.duplicate).toBe(true);
    expect(p().clips).toHaveLength(2);
  });

  it('coalesces repeated slider edits into one undo step', () => {
    const { engine, p } = setup();
    for (const opacity of [0.9, 0.8, 0.7]) {
      engine.apply({
        coalesceKey: 'opacity:c1',
        ops: [{ type: 'setTransform', clipId: 'c1', transform: { opacity } }],
      });
    }
    expect(video(p(), 'c1').transform.opacity).toBe(0.7);
    engine.undo();
    expect(video(p(), 'c1').transform.opacity).toBe(1);
  });

  it('changes speed and scales duration', () => {
    const { engine, p } = setup();
    expect(engine.apply({ ops: [{ type: 'setSpeed', clipId: 'c1', speed: 2 }] }).ok).toBe(true);
    expect(video(p(), 'c1').duration).toBe(75);
    // Slowing to 0.5x would need 10 s * 2 = 600 frames; media allows that from sourceIn 0.
    expect(engine.apply({ ops: [{ type: 'setSpeed', clipId: 'c1', speed: 0.5 }] }).ok).toBe(true);
    expect(video(p(), 'c1').duration).toBe(300);
  });

  it('validates operation payloads', () => {
    const { engine } = setup();
    const r = engine.apply({
      ops: [{ type: 'setTransform', clipId: 'c1', transform: { opacity: 5 } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION');
  });

  it('auto-creates text and caption tracks on top', () => {
    const { engine, p } = setup();
    engine.apply({ ops: [{ type: 'addCaption', start: 0, duration: 30, text: 'Hi' }] });
    expect(p().tracks[0]!.kind).toBe('caption');
    const layers = visualLayersAt(p(), 10);
    expect(layers.map((c) => c.kind)).toEqual(['video', 'caption']);
  });

  it('moves a clip between tracks of the same kind', () => {
    const { engine, p } = setup();
    const add = engine.apply({ ops: [{ type: 'addTrack', kind: 'video', index: 0, id: 't_top' }] });
    expect(add.ok).toBe(true);
    expect(
      engine.apply({ ops: [{ type: 'moveClip', clipId: 'c1', start: 15, trackId: 't_top' }] }).ok,
    ).toBe(true);
    const c = video(p(), 'c1');
    expect(c.trackId).toBe('t_top');
    expect(clipEnd(c)).toBe(165);
  });

  it('round-trips through serialization', () => {
    const { p } = setup();
    const again = parseProjectDocument(serializeProject(p()));
    expect(again).toEqual(p());
  });
});

describe('beats and templates', () => {
  const withMusic = () => {
    const s = setup();
    const r = s.engine.apply({
      ops: [
        { type: 'addMedia', media: media({ id: 'song', kind: 'audio', hasVideo: false }) },
        { type: 'addMedia', media: media({ id: 'short', durationUs: 1_000_000 }) },
        { type: 'addMedia', media: media({ id: 'pic', kind: 'image', durationUs: 0 }) },
        {
          type: 'addClip',
          clip: {
            id: 'music',
            kind: 'audio',
            trackId: s.audioTrack,
            mediaId: 'song',
            start: 0,
            duration: 300,
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    return s;
  };
  const clip = (p: Project, id: string) => findClip(p, id) as Clip;

  it('normalises beat markers: sorted, de-duplicated, clamped to the media', () => {
    const { engine, p } = withMusic();
    const r = engine.apply({
      ops: [
        {
          type: 'setBeats',
          clipId: 'music',
          beatsUs: [1_000_000, 500_000, 510_000, 500_000, 20_000_000],
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(clip(p(), 'music')).toMatchObject({ beatsUs: [500_000, 1_000_000] });
  });

  it('keeps beats on the music when the clip is moved, trimmed or split', () => {
    const { engine, p } = withMusic();
    const fps = p().sequence.fps;
    engine.apply({
      ops: [{ type: 'setBeats', clipId: 'music', beatsUs: [500_000, 1_000_000, 1_500_000] }],
    });
    expect(beatFrames(clip(p(), 'music'), fps)).toEqual([15, 30, 45]);
    engine.apply({ ops: [{ type: 'moveClip', clipId: 'music', start: 10 }] });
    expect(beatFrames(clip(p(), 'music'), fps)).toEqual([25, 40, 55]);
    engine.apply({ ops: [{ type: 'trimClip', clipId: 'music', edge: 'start', frame: 30 }] });
    expect(beatFrames(clip(p(), 'music'), fps)).toEqual([40, 55]);
    engine.apply({ ops: [{ type: 'splitClip', clipId: 'music', frame: 50, newClipId: 'm2' }] });
    expect(beatFrames(clip(p(), 'music'), fps)).toEqual([40]);
    expect(beatFrames(clip(p(), 'm2'), fps)).toEqual([55]);
    expect(snapPoints(p())).toEqual(expect.arrayContaining([40, 55]));
  });

  it('fills a slot with a video, keeping its timing; undo restores the slot', () => {
    const { engine, p, videoTrack } = withMusic();
    engine.apply({ ops: [{ type: 'deleteClip', clipId: 'c1' }] });
    engine.apply({
      ops: [
        {
          type: 'addClip',
          clip: { id: 's1', kind: 'slot', trackId: videoTrack, start: 15, duration: 30, index: 1 },
        },
      ],
    });
    expect(visualLayersAt(p(), 20)).toEqual([]); // empty slots are transparent
    const r = engine.apply({
      ops: [{ type: 'replaceClipMedia', clipId: 's1', mediaId: 'm1', sourceInUs: 2_000_000 }],
    });
    expect(r.ok).toBe(true);
    expect(clip(p(), 's1')).toMatchObject({
      kind: 'video',
      start: 15,
      duration: 30,
      sourceInUs: 2_000_000,
      templateSlot: 1,
    });
    // Swap in an image, then back to an empty slot.
    engine.apply({ ops: [{ type: 'replaceClipMedia', clipId: 's1', mediaId: 'pic' }] });
    expect(clip(p(), 's1')).toMatchObject({ kind: 'image', start: 15, duration: 30 });
    engine.apply({ ops: [{ type: 'clearSlot', clipId: 's1' }] });
    expect(clip(p(), 's1')).toMatchObject({ kind: 'slot', index: 1, start: 15, duration: 30 });
    engine.undo();
    engine.undo();
    engine.undo();
    expect(clip(p(), 's1').kind).toBe('slot');
  });

  it('refuses media shorter than the slot, with a readable message', () => {
    const { engine, videoTrack } = withMusic();
    engine.apply({ ops: [{ type: 'deleteClip', clipId: 'c1' }] });
    engine.apply({
      ops: [
        {
          type: 'addClip',
          clip: { id: 's1', kind: 'slot', trackId: videoTrack, start: 0, duration: 60, index: 1 },
        },
      ],
    });
    const r = engine.apply({ ops: [{ type: 'replaceClipMedia', clipId: 's1', mediaId: 'short' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_RANGE');
      expect(r.error.message).toContain('1.0 s');
      expect(r.error.message).toContain('2.0 s');
    }
  });

  it('clamps a requested in-point so the video fits the slot', () => {
    const { engine, p } = withMusic();
    // c1 is 150 frames (5 s) of a 10 s video; ask for an in-point at 9 s.
    engine.apply({
      ops: [{ type: 'replaceClipMedia', clipId: 'c1', mediaId: 'm1', sourceInUs: 9_000_000 }],
    });
    expect(video(p(), 'c1').sourceInUs).toBe(5_000_000);
  });

  it('slips the source without moving the clip, within the media bounds', () => {
    const { engine, p } = setup();
    expect(
      engine.apply({ ops: [{ type: 'slipClip', clipId: 'c1', sourceInUs: 3_000_000 }] }).ok,
    ).toBe(true);
    expect(video(p(), 'c1')).toMatchObject({ start: 0, duration: 150, sourceInUs: 3_000_000 });
    const r = engine.apply({ ops: [{ type: 'slipClip', clipId: 'c1', sourceInUs: 5_000_001 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_RANGE');
  });

  it('migrates schema v1 projects', () => {
    const { p } = setup();
    const v1 = JSON.parse(serializeProject(p())) as Record<string, unknown> & {
      clips: Record<string, unknown>[];
    };
    v1.schemaVersion = 1;
    for (const c of v1.clips) delete c.beatsUs;
    const loaded = parseProjectDocument(JSON.stringify(v1));
    expect(loaded.schemaVersion).toBe(2);
    expect(video(loaded, 'c1').beatsUs).toEqual([]);
  });
});

describe('srt', () => {
  it('parses and formats cues', () => {
    const src =
      '1\n00:00:01,000 --> 00:00:02,500\nHello <i>world</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nLine two\n';
    const cues = parseSrt(src);
    expect(cues).toEqual([
      { startSeconds: 1, endSeconds: 2.5, text: 'Hello world' },
      { startSeconds: 3, endSeconds: 4, text: 'Line two' },
    ]);
    expect(parseSrt(formatSrt(cues))).toEqual(cues);
  });
});
