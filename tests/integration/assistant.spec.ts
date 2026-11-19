import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Full assistant loop: an MCP client (standing in for Claude Desktop / Claude Code) launches the
 * bundled viditor-mcp.mjs over stdio; the real editor UI connects to it from the browser; tool
 * calls edit the open project live and are undoable from the editor.
 */
const PORT = 47999;

type Payload = {
  ok: boolean;
  message: string;
  errorCode?: string;
  revision?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reads arbitrary tool payloads
  data?: any;
};

async function startBridge() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['apps/web/public/downloads/viditor-mcp.mjs'],
    env: {
      ...process.env,
      VIDITOR_BRIDGE_PORT: String(PORT),
      VIDITOR_ALLOWED_ORIGINS: 'http://localhost:5179',
    } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'viditor-e2e', version: '1.0.0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Payload> => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    return JSON.parse(text) as Payload;
  };
  return { client, call };
}

test('an MCP client edits the open project live through the bridge', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { client, call } = await startBridge();
  try {
    // Before the editor connects, tools explain how to connect.
    const early = await call('get_project');
    expect(early).toMatchObject({ ok: false, errorCode: 'NOT_CONNECTED' });

    await page.addInitScript(
      (port) => localStorage.setItem('vd.assistant.port', String(port)),
      PORT,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: /create project/i }).waitFor();
    await page.evaluate(async () => {
      const h = await import(/* @vite-ignore */ '/src/testing/harness.ts');
      await h.openDemoProject();
    });
    const clips = page.locator('[data-clip-id]');
    await expect(clips).toHaveCount(2);

    await page.getByRole('tab', { name: 'AI' }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText('AI connected')).toBeVisible();

    // Read
    const proj = await call('get_project');
    expect(proj.ok).toBe(true);
    expect(proj.data.media).toHaveLength(1);
    expect(JSON.stringify(proj.data)).not.toContain('test-rgb.mp4'); // file names hidden by default
    const tl = await call('get_timeline');
    const video = tl.data.clips.find((c: { kind: string }) => c.kind === 'video');
    expect(video.durationSeconds).toBeCloseTo(3, 1);

    // Write: a title appears in the timeline immediately
    const add = await call('add_title', {
      text: 'From the assistant',
      startSeconds: 1,
      durationSeconds: 1.5,
      preset: 'lower-third',
      expectedRevision: tl.revision,
    });
    expect(add.ok).toBe(true);
    await expect(clips).toHaveCount(3);
    await expect(page.getByText('Add title', { exact: true })).toBeVisible(); // activity log

    // Stale revision is rejected
    const stale = await call('split_clip', { atSeconds: 2, expectedRevision: tl.revision });
    expect(stale).toMatchObject({ ok: false, errorCode: 'STALE_REVISION' });

    // Split everything at 2 s, then undo it from the editor with Ctrl+Z
    const split = await call('split_clip', { atSeconds: 2 });
    expect(split.ok).toBe(true);
    await expect(clips).toHaveCount(6); // video, demo title and AI title each split in two
    await page.locator('body').click({ position: { x: 700, y: 300 } });
    await page.keyboard.press('Control+z');
    await expect(clips).toHaveCount(3);

    // Undo through the tool removes the title
    const undo = await call('undo');
    expect(undo).toMatchObject({ ok: true, message: 'Undid "AI: Add title"' });
    await expect(clips).toHaveCount(2);

    // Pointing the user at something moves the playhead
    expect((await call('show_in_editor', { seconds: 1 })).ok).toBe(true);
    await expect(page.getByText('00:00:01:00')).toBeVisible();

    // Privacy toggle is respected immediately
    const share = page.getByRole('switch', { name: 'Share file names' });
    await share.click();
    await expect(share).toHaveAttribute('aria-checked', 'true');
    expect(JSON.stringify((await call('get_project')).data)).toContain('test-rgb.mp4');

    await page.screenshot({ path: 'test-results/assistant.png' });

    // Disconnect: tools go back to explaining how to connect
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect.poll(async () => (await call('get_project')).errorCode).toBe('NOT_CONNECTED');
    expect(errors).toEqual([]);
  } finally {
    await client.close();
  }
});
