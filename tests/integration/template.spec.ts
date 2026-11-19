import { expect, test, type Page } from '@playwright/test';

type Clip = {
  id: string;
  kind: string;
  start: number;
  duration: number;
  trackId: string;
  sourceInUs?: number;
  beatsUs?: number[];
  index?: number;
  templateSlot?: number;
};
type ProjectLike = {
  clips: Clip[];
  tracks: { id: string; name: string; kind: string }[];
  sequence: { width: number; height: number };
};

const project = (page: Page) =>
  page.evaluate(async () => {
    const s = await import(/* @vite-ignore */ '/src/state/store.ts');
    return JSON.parse(JSON.stringify(s.useEditor.getState().project)) as unknown;
  }) as Promise<ProjectLike>;

const setPlayhead = (page: Page, frame: number) =>
  page.evaluate(async (f) => {
    const s = await import(/* @vite-ignore */ '/src/state/store.ts');
    s.setPlayhead(f);
  }, frame);

test('beat template: detect beats, cut a template, drop a clip in, slip it, export', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /create project/i }).waitFor();
  await page.evaluate(async () => {
    const h = await import(/* @vite-ignore */ '/src/testing/harness.ts');
    await h.openTemplateDemo();
  });

  // 1. Detect beats on the click track (120 BPM: clicks at 0.25 s + k × 0.5 s).
  const music = (await project(page)).clips.find((c) => c.kind === 'audio')!;
  await page.locator(`[data-clip-id="${music.id}"]`).click({ position: { x: 4, y: 30 } });
  await page.getByRole('button', { name: 'Detect beats' }).click();
  await expect(page.getByText(/8 markers on this clip/)).toBeVisible();
  const beats = (await project(page)).clips.find((c) => c.id === music.id)!.beatsUs!;
  expect(beats).toHaveLength(8);
  beats.forEach((us, i) => expect(Math.abs(us / 1e6 - (0.25 + i * 0.5))).toBeLessThan(0.02));
  await expect(page.locator(`[data-clip-id="${music.id}"] [data-beat]`)).toHaveCount(8);

  // 2. Tap a beat with B, then remove a marker with click + Delete (both undoable).
  await setPlayhead(page, 100);
  await page.keyboard.press('b');
  await expect
    .poll(async () => (await project(page)).clips.find((c) => c.id === music.id)!.beatsUs!.length)
    .toBe(9);
  await page.keyboard.press('Control+z');
  await page.locator(`[data-clip-id="${music.id}"] [data-beat]`).first().click();
  await page.keyboard.press('Delete');
  await expect
    .poll(async () => (await project(page)).clips.find((c) => c.id === music.id)!.beatsUs!.length)
    .toBe(7);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await project(page)).clips.find((c) => c.id === music.id)!.beatsUs!.length)
    .toBe(8);

  // 3. Template: cut every 2 markers → 0, 0.25, 1.25, 2.25, 3.25, 4.0 → 5 slots.
  await page.locator(`[data-clip-id="${music.id}"]`).click({ position: { x: 4, y: 30 } });
  await page.getByRole('radio', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: /Create template · 5 slots/ }).click();
  let p = await project(page);
  const slots = p.clips.filter((c) => c.kind === 'slot').sort((a, b) => a.start - b.start);
  expect(slots.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
  expect(p.tracks.find((t) => t.id === slots[0]!.trackId)!.name).toBe('Template');
  const slot2 = slots[1]!;
  expect(slot2.start).toBe(8); // 0.25 s at 30 fps, nearest frame
  expect(slot2.duration).toBe(30);
  await expect(page.getByText('5 empty template slots', { exact: false })).toBeVisible();

  // 4. Drag the video from the library onto slot #2: it fills exactly that slot.
  await page
    .locator('[draggable="true"]', { hasText: 'test-rgb.mp4' })
    .dragTo(page.locator(`[data-clip-id="${slot2.id}"]`));
  await expect
    .poll(async () => (await project(page)).clips.find((c) => c.id === slot2.id)!.kind)
    .toBe('video');
  p = await project(page);
  const filled = p.clips.find((c) => c.id === slot2.id)!;
  expect(filled).toMatchObject({ start: 8, duration: 30, sourceInUs: 0, templateSlot: 2 });
  expect(p.sequence).toMatchObject({ width: 640, height: 360 }); // first fill sets the frame size

  // 5. Choose which part shows: slide the clip window by 30 frames (3 × Shift+→ = 1 s).
  const strip = page.getByRole('slider', { name: 'Which part of the source plays' });
  await strip.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => (await project(page)).clips.find((c) => c.id === slot2.id)!.sourceInUs!)
    .toBeGreaterThan(999_000);
  p = await project(page);
  expect(p.clips.find((c) => c.id === slot2.id)).toMatchObject({ start: 8, duration: 30 });

  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/template.png' });

  // 6. Export: the slot shows the slipped (green) second exactly; empty slots stay black.
  const px = await page.evaluate(async () => {
    const h = await import(/* @vite-ignore */ '/src/testing/harness.ts');
    return h.exportEditorProject({
      inSlot: { t: 0.75, x: 320, y: 180 },
      emptyBefore: { t: 0.1, x: 320, y: 180 },
      emptyAfter: { t: 2.0, x: 320, y: 180 },
    });
  });
  const [r, g, b] = px.inSlot!;
  expect(g).toBeGreaterThan(180);
  expect(r + b).toBeLessThan(160);
  expect(Math.max(...px.emptyBefore!)).toBeLessThan(40);
  expect(Math.max(...px.emptyAfter!)).toBeLessThan(40);
  expect(errors).toEqual([]);
});
