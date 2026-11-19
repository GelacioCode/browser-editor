import { describe, expect, it } from 'vitest';
import { ProjectEngine, createProject, type MediaItem } from '@viditor/project-core';
import { TOOLS, runTool, type ToolContext, type ToolOutcome } from './index.ts';

const video: MediaItem = {
  id: 'm1',
  kind: 'video',
  name: 'holiday-secret.mp4',
  label: 'Video 1',
  durationUs: 10_000_000,
  width: 1080,
  height: 1920,
  fps: 29.97,
  hasVideo: true,
  hasAudio: true,
  sampleRate: 48000,
  channels: 2,
  rotation: 0,
  sizeBytes: 1,
  lastModified: 0,
  relativePath: 'footage/holiday-secret.mp4',
};

function setup() {
  const engine = new ProjectEngine(createProject({ projectId: 'p1' }));
  engine.apply({ ops: [{ type: 'addMedia', media: video }] });
  let playhead = 0;
  let selected: string[] = [];
  const ctx: ToolContext = {
    engine,
    getPlayhead: () => playhead,
    setPlayhead: (f) => (playhead = f),
    select: (ids) => (selected = ids),
  };
  const call = (name: string, args: unknown = {}) => runTool(name, args, ctx) as ToolOutcome;
  return { engine, ctx, call, selected: () => selected, playhead: () => playhead };
}

describe('assistant tools', () => {
  it('every tool has a unique name, title and description', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(20);
  });

  it('get_project hides file names and paths by default', () => {
    const { call } = setup();
    const r = call('get_project');
    expect(r.ok).toBe(true);
    const json = JSON.stringify(r.data);
    expect(json).not.toContain('holiday-secret');
    expect(json).not.toContain('footage/');
    expect(json).toContain('Video 1');
  });

  it('add_media_to_timeline matches the sequence to the first clip and selects it', () => {
    const { call, engine, selected } = setup();
    const r = call('add_media_to_timeline', { mediaId: 'm1', startSeconds: 0 });
    expect(r.ok).toBe(true);
    expect(engine.project.sequence).toMatchObject({
      width: 1080,
      height: 1920,
      fps: { num: 30000, den: 1001 },
    });
    expect(engine.project.clips).toHaveLength(1);
    expect(selected()).toEqual([engine.project.clips[0]!.id]);
    expect((r.data as { notice?: string }).notice).toMatch(/1080×1920/);
  });

  it('splits, trims, sets audio and speed using seconds', () => {
    const { call, engine } = setup();
    call('add_media_to_timeline', { mediaId: 'm1', startSeconds: 0 });
    const id = engine.project.clips[0]!.id;
    expect(call('split_clip', { atSeconds: 4 }).ok).toBe(true);
    expect(engine.project.clips).toHaveLength(2);
    expect(call('trim_clip', { clipId: id, edge: 'end', toSeconds: 3 }).ok).toBe(true);
    expect(call('set_audio', { clipId: id, volumeDb: -6, fadeOutSeconds: 1 }).ok).toBe(true);
    const c = engine.project.clips.find((x) => x.id === id)!;
    if (c.kind !== 'video') throw new Error('expected video');
    expect(c.audio.gain).toBeCloseTo(0.501, 2);
    expect(c.audio.fadeOut).toBe(30);
    expect(call('set_speed', { clipId: id, speed: 2 }).ok).toBe(true);
  });

  it('labels assistant edits and undoes each call as one step', () => {
    const { call, engine } = setup();
    call('add_title', { text: 'Hello', startSeconds: 0, durationSeconds: 2, preset: 'poster' });
    expect(engine.undoLabel).toBe('AI: Add title');
    const title = engine.project.clips.find((c) => c.kind === 'text')!;
    if (title.kind !== 'text') throw new Error();
    expect(title.style.fontFamily).toBe('Bebas Neue');
    const u = call('undo');
    expect(u.ok).toBe(true);
    expect(u.message).toBe('Undid "AI: Add title"');
    expect(engine.project.clips).toHaveLength(0);
  });

  it('places overlapping captions on separate caption tracks in one transaction', () => {
    const { call, engine } = setup();
    const r = call('add_captions', {
      captions: [
        { text: 'One', startSeconds: 0, endSeconds: 2 },
        { text: 'Two', startSeconds: 1, endSeconds: 3 },
        { text: 'Three', startSeconds: 3, endSeconds: 4 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(engine.project.tracks.filter((t) => t.kind === 'caption')).toHaveLength(2);
    engine.undo();
    expect(engine.project.clips).toHaveLength(0);
  });

  it('rejects stale revisions, wrong projects and bad arguments with codes', () => {
    const { call, engine } = setup();
    const stale = engine.revision - 1;
    expect(
      call('add_title', {
        text: 'x',
        startSeconds: 0,
        durationSeconds: 1,
        expectedRevision: stale,
      }),
    ).toMatchObject({
      ok: false,
      errorCode: 'STALE_REVISION',
    });
    expect(
      call('add_title', { text: 'x', startSeconds: 0, durationSeconds: 1, projectId: 'other' }),
    ).toMatchObject({
      ok: false,
      errorCode: 'PROJECT_CHANGED',
    });
    expect(call('set_speed', { clipId: 'c', speed: 99 })).toMatchObject({
      ok: false,
      errorCode: 'VALIDATION',
    });
    expect(call('nope')).toMatchObject({ ok: false, errorCode: 'UNKNOWN_TOOL' });
  });

  it('does not apply the same opId twice', () => {
    const { call, engine } = setup();
    const args = { text: 'Once', startSeconds: 0, durationSeconds: 1, opId: 'abc' };
    expect(call('add_title', args).ok).toBe(true);
    const again = call('add_title', args);
    expect(again.ok).toBe(true);
    expect(again.message).toMatch(/already applied/);
    expect(engine.project.clips).toHaveLength(1);
  });

  it('hides title text unless sharing is enabled', () => {
    const { call, engine } = setup();
    call('add_title', { text: 'Secret words', startSeconds: 0, durationSeconds: 1 });
    expect(JSON.stringify(call('get_timeline').data)).not.toContain('Secret words');
    engine.apply({ ops: [{ type: 'setPrivacy', settings: { shareTextContent: true } }] });
    expect(JSON.stringify(call('get_timeline').data)).toContain('Secret words');
  });

  it('apply_operations is atomic and cannot touch media or privacy', () => {
    const { call, engine } = setup();
    const r = call('apply_operations', {
      operations: [
        { type: 'addTitle', start: 0, duration: 30, text: 'ok' },
        { type: 'deleteClip', clipId: 'missing' },
      ],
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'NOT_FOUND' });
    expect(engine.project.clips).toHaveLength(0);
    expect(
      call('apply_operations', {
        operations: [{ type: 'setPrivacy', settings: { shareFileNames: true } }],
      }),
    ).toMatchObject({
      ok: false,
      errorCode: 'UNSUPPORTED',
    });
  });

  it('beat template flow: detect beats, cut a template, fill it, slip a clip', async () => {
    const { call, engine, ctx } = setup();
    const song: MediaItem = {
      ...video,
      id: 'song',
      kind: 'audio',
      label: 'Audio 1',
      hasVideo: false,
      width: 0,
      height: 0,
      fps: null,
      durationUs: 8_000_000,
    };
    engine.apply({ ops: [{ type: 'addMedia', media: song }] });
    expect(call('add_media_to_timeline', { mediaId: 'song', startSeconds: 0 }).ok).toBe(true);
    const music = engine.project.clips.find((c) => c.kind === 'audio')!;
    // 120 BPM: a beat every 0.5 s starting at 0.5 s.
    ctx.detectBeats = async (mediaId, mode) => {
      expect([mediaId, mode]).toEqual(['song', 'bass']);
      return { bpm: 120, beatsUs: Array.from({ length: 15 }, (_, i) => 500_000 * (i + 1)) };
    };
    const d = await runTool('detect_beats', { clipId: music.id, mode: 'bass' }, ctx);
    expect(d).toMatchObject({ ok: true, data: { bpm: 120, markerCount: 15 } });
    expect((d.data as { markerSeconds: number[] }).markerSeconds.slice(0, 3)).toEqual([
      0.5, 1, 1.5,
    ]);

    const t = call('create_beat_template', { clipId: music.id, everyNBeats: 2 });
    expect(t.ok).toBe(true);
    const slots = (t.data as { slots: { slotId: string; startSeconds: number }[] }).slots;
    // Cuts at 0.5, 1.5, 2.5 … 7.5 → 0–0.5, then 1 s slots, then 7.5–8.
    expect(slots.map((s) => s.startSeconds)).toEqual([0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
    expect(engine.project.tracks[0]).toMatchObject({ kind: 'video', name: 'Template' });

    const f = call('fill_slots', { autoFillWith: ['m1'] });
    expect(f.ok).toBe(true);
    const filled = engine.project.clips.filter((c) => c.kind === 'video');
    expect(filled).toHaveLength(9);
    // Reusing one video continues through it rather than repeating its opening.
    const ins = filled
      .sort((a, b) => a.start - b.start)
      .map((c) => (c.kind === 'video' ? c.sourceInUs : -1));
    expect(ins[1]).toBeGreaterThan(ins[0]!);

    const target = filled[2]!;
    expect(call('slip_clip', { clipId: target.id, sourceInSeconds: 6 }).ok).toBe(true);
    const slipped = engine.project.clips.find((c) => c.id === target.id)!;
    expect(slipped).toMatchObject({
      start: target.start,
      duration: target.duration,
      sourceInUs: 6_000_000,
    });
    expect(JSON.stringify(call('get_timeline').data)).toContain('slotNumber');
  });

  it('show_in_editor moves the playhead without changing the project', () => {
    const { call, engine, playhead } = setup();
    const rev = engine.revision;
    expect(call('show_in_editor', { seconds: 2 }).ok).toBe(true);
    expect(playhead()).toBe(60);
    expect(engine.revision).toBe(rev);
  });
});
