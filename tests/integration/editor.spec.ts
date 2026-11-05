import { expect, test } from '@playwright/test';

test('app loads, passes diagnostics and shows the welcome screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /create project/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /open project folder/i })).toBeVisible();
  await expect(page.getByText(/never leaves this computer/i)).toBeVisible();
  expect(errors).toEqual([]);
});

test('editor UI: timeline editing with keyboard, undo and autosave', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /create project/i }).waitFor();
  await page.evaluate(async () => {
    const h = await import(/* @vite-ignore */ '/src/testing/harness.ts');
    await h.openDemoProject();
  });

  const clips = page.locator('[data-clip-id]');
  await expect(clips).toHaveCount(2); // video + title
  await expect(page.getByLabel('Project name')).toHaveValue('Demo project');
  // Sequence auto-matched the first clip
  await expect(page.getByRole('button', { name: /640×360 · 30 fps/ })).toBeVisible();

  // Move the playhead to 1 s and split everything under it.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('s');
  await expect(clips).toHaveCount(4);

  await page.keyboard.press('Control+z');
  await expect(clips).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(clips).toHaveCount(4);

  // Select a clip and edit in the inspector.
  await clips.first().click();
  await expect(page.getByText('Transform')).toBeVisible();

  // Autosave writes project.json into the folder.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
  const saved = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('demo-project');
    const text = await (await (await dir.getFileHandle('project.json')).getFile()).text();
    const p = JSON.parse(text);
    return { clips: p.clips.length, media: p.media.length, rel: p.media[0].relativePath };
  });
  expect(saved).toEqual({ clips: 4, media: 1, rel: 'test-rgb.mp4' });

  await page.waitForTimeout(800); // let thumbnails/waveform land for the screenshot
  await page.screenshot({ path: 'test-results/editor.png' });
  expect(errors).toEqual([]);
});

test('import → edit → export pipeline produces a correct MP4', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('/');
  await page.getByRole('button', { name: /create project/i }).waitFor();

  const r = await page.evaluate(async () => {
    const h = await import(/* @vite-ignore */ '/src/testing/harness.ts');
    return h.runE2E();
  });
  if (!r) console.log(logs.join('\n'));

  // Probe of the synthetic source
  expect(r.probe.kind).toBe('video');
  expect(r.probe.width).toBe(640);
  expect(r.probe.height).toBe(360);
  expect(r.probe.hasAudio).toBe(true);
  expect(r.probe.durationUs).toBeGreaterThan(2_900_000);
  expect(Math.round(r.probe.fps ?? 0)).toBe(30);

  // Background analysis
  expect(r.analysis.thumbs).toBeGreaterThan(0);
  expect(r.analysis.peaks).toBeGreaterThan(100);
  expect(r.analysis.maxPeak).toBeGreaterThan(0.3);

  // Undo of a split restores the single clip
  expect(r.undo.clipsAfterSplit).toBe(2);
  expect(r.undo.clipsAfterUndo).toBe(1);

  // Export container/codec/duration (2 s after trimming 1 s)
  expect(r.output.videoCodec).toBe('avc');
  expect(r.output.audioCodec).toBe('aac');
  expect(r.output.width).toBe(640);
  expect(r.output.height).toBe(360);
  expect(r.output.duration).toBeGreaterThan(1.9);
  expect(r.output.duration).toBeLessThan(2.15);

  // Composition: trimmed timing, layering and title visibility
  const [gr, gg, gb] = r.pixels.green_center_0_5;
  expect(gg).toBeGreaterThan(180);
  expect(gr).toBeLessThan(80);
  expect(gb).toBeLessThan(80);
  const [tr, tg, tb] = r.pixels.title_box_0_5;
  expect(Math.min(tr, tg, tb)).toBeGreaterThan(200); // white title box over green
  const [br, bg, bb] = r.pixels.blue_center_1_5;
  expect(bb).toBeGreaterThan(180);
  expect(br + bg).toBeLessThan(160);
  const [nr, ng, nb] = r.pixels.no_title_1_5;
  expect(nb).toBeGreaterThan(180); // title ended at 1 s
  expect(nr + ng).toBeLessThan(160);
});
