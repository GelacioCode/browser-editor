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
          UI (React)                                   future MCP bridge
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

## MCP (next milestone)

A browser tab can't be launched as a stdio MCP server. The plan:

1. A small local CLI, `viditor-mcp`, is the stdio MCP server the assistant host launches.
2. The editor tab connects to it over an authenticated `127.0.0.1` WebSocket using a pairing token.
3. Tool calls become `Transaction`s against the same `ProjectEngine`, carrying `opId` and
   `expectedRevision`.
4. Responses use `toAssistantView()` from `packages/contracts`, which hides file names, paths and
   text unless the user enables sharing.

A remote Streamable-HTTP relay on the VPS can come later (guide §9).
