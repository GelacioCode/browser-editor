# Architecture

## Deviation from the original guide

[The project guide](Local_Video_Editor_MCP_Project_Guide.md) proposed an Electron desktop app with
native FFmpeg. We chose a **browser-first** build instead, served from
`viditor.samuelgelacio.io`. The guide's principles all still apply. Footage stays local, one
validated engine handles every edit, and preview and export agree. A few mechanisms change:

| Guide (desktop)               | Viditor (browser)                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Native FFmpeg / ffprobe       | WebCodecs via [Mediabunny](https://mediabunny.dev) for demux, decode, encode and MP4 mux |
| Electron file access          | File System Access API; handles persisted in IndexedDB                                   |
| Main process / preload bridge | Not needed. Native-ish operations sit behind small modules in `packages/media`           |
| `doctor` script               | In-app diagnostics screen (`apps/web/src/lib/capabilities.ts`)                           |
| Windows installer             | Static site + Docker image; an Electron wrapper can reuse `apps/web` later               |
| Supported platform            | Desktop Chrome / Edge                                                                    |

## Data flow

```
          UI (React)                                   MCP bridge (via the AI panel)
              │  Operation[]                                  │ Operation[] + opId + expectedRevision
              ▼                                               ▼
      ┌──────────────────────── ProjectEngine (packages/project-core) ───────────────────────┐
      │ zod validation → immer transaction → revision++ → undo entry → change event          │
      └──────────────────────────────────────────────────────────────────────────────────────┘
              │ project snapshot (immutable)
      ┌───────┴─────────────┬──────────────────────────┬──────────────────────────┐
      ▼                     ▼                          ▼                          ▼
  Timeline/Inspector   Preview (PreviewPlayer)     Autosave/Save              Export (packages/render)
                       <video>/<audio> sources      project.json +             mix audio (OfflineAudioContext)
                       + renderFrame()              recovery snapshots         worker: decode → renderFrame()
                                                                               → H.264/AAC → MP4 → file
```

### Single writer

`ProjectEngine` is the only thing that mutates the project. Each `apply()` call:

1. validates every operation against a zod schema with bounded values,
2. checks `expectedRevision` (if given) and returns `STALE_REVISION` on mismatch,
3. applies the whole batch atomically with immer (one failing op rolls back the batch),
4. re-validates the resulting document,
5. increments `revision` and pushes one undo entry (inverse patches),
6. emits a change event.

Retrying the same `opId` returns the original result without re-applying it. Slider drags pass a
`coalesceKey` so a drag becomes one undo step. Undo and redo also bump the revision, so stale
writers are always detected.

### Time model

- Timeline positions and durations are **integer frames** at a rational sequence rate
  (e.g. `30000/1001`).
- Source positions are **integer microseconds**, the WebCodecs time base.
- Conversions live in `packages/project-core/src/time.ts` and are unit-tested for NTSC round-trips.
- Beat markers (`beatsUs` on video/audio clips, schema v2) are stored in **source microseconds**
  of the clip's media, for the whole media. Moving, trimming or splitting a clip therefore keeps
  them on the music; the timeline frame of a marker is derived (`beatFrames`).
- A beat template is a video track of `slot` clips (empty placeholders, transparent when
  rendered). `replaceClipMedia` turns a slot into a video/image clip with the same start and
  duration and remembers the slot number; `slipClip` changes only the source in-point.
  Template planning (`planBeatTemplate`, `planFillSlots`) lives in `packages/contracts` so the UI
  and the assistant tools share it. Beat detection is pure DSP in `packages/media/src/beats.ts`,
  run in the analysis worker and cached per file and mode.

### Preview/export parity

`packages/composition` owns the definition of a frame:

- `renderFrame(ctx, project, frame, resolveSource, size)` handles layering, fit, transform, crop,
  opacity, text layout and the background.
- `gainAutomation` / `clipGainAt` handle audio gain and fades.

The preview feeds `renderFrame` with `<video>` elements synced to a wall clock, and with Web Audio
gain nodes. The exporter feeds it decoded frames (Mediabunny `CanvasSink`) in a worker, and builds
an `OfflineAudioContext` mixdown with the same gain automation. Fonts are self-hosted and loaded
with the FontFace API in both places, so text wraps identically. The integration test samples
exported pixels to check timing, layering and titles.

Speed changes resample audio in both preview (`preservesPitch = false`) and export (`playbackRate`),
so the pitch follows the speed in both.

### Storage

Inside the project folder the user picks:

```
project.json        durable editing instructions (versioned schema)
project.prev.json   previous valid save
recovery/           autosave snapshots (last 5), offered on reopen if newer than project.json
exports/            suggested export location
```

- `createWritable()` writes to a swap file and swaps it in on close, so saves are atomic.
- Autosave writes a recovery snapshot about 1 s after each change and saves `project.json` about
  3 s after.
- Media files stay where they are. The project stores a relative path when the file is inside the
  project folder, and the browser remembers the file handle in IndexedDB. On reopen, media is
  resolved by relative path first, then by the remembered handle (which may ask for permission
  again), and is marked offline if neither works. Offline media can be relinked.
- Thumbnails and waveforms are a disposable cache in the Origin Private File System. The cache is
  capped at 5 GB with oldest-first eviction, and the user can clear it from Settings.

### Workers

| Worker                                  | Job                                                         |
| --------------------------------------- | ----------------------------------------------------------- |
| `packages/media/src/analysis.worker.ts` | Thumbnail strips (JPEG) + waveform peaks, one job at a time |
| `packages/render/src/export.worker.ts`  | Frame decode, composite, encode, mux                        |

Audio mixdown runs on the main thread, because Web Audio isn't available in workers. Its output
is transferred to the export worker. The output file stream is wrapped in a transferable
`WritableStream`, and the main thread waits for the file to commit before reporting success.
Canceling an export, or a failed one, deletes the partial file.

## MCP (milestone 2)

A browser tab can't be launched as a stdio MCP server, so there are two halves:

1. **`apps/mcp-bridge` (`viditor-mcp.mjs`)**: the stdio MCP server the assistant host launches. It
   registers the tool catalogue and relays each call to the tab. It's bundled into one file with
   no install step and served at `/downloads/viditor-mcp.mjs`.
2. **The tab** connects when the user clicks Connect in the AI panel (`apps/web/src/state/assistant.ts`).
   The link uses Server-Sent Events from the bridge to the tab, plus `POST /result` back, on
   `127.0.0.1` only. It needs no WebSocket dependency. The bridge checks Origin and Host and issues
   a per-connection token (see [assistant.md](assistant.md#security-model)).
3. **Tools live in `packages/contracts`** and execute in the tab via `runTool()`. Each mutation is a
   `Transaction` against the same `ProjectEngine` the UI uses, with `origin: 'assistant'`, an
   `AI: …` undo label, optional `expectedRevision` / `projectId` / `opId` guards, and results in
   seconds through privacy-filtered views.
4. UI and tools share edit planning (`planAddMedia`, `TITLE_PRESETS`), so the same request behaves
   the same from either side.

A remote Streamable-HTTP relay on the VPS (for web-based assistants) can come later (guide §9).
