# Feature status

Legend: ✅ working · 🟡 partial · ⏳ planned

| Area        | Feature                                                                                                                                                              | Status |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Projects    | Create in a chosen folder, reopen, recent projects list                                                                                                              | ✅     |
|             | Autosave (`project.json`) + recovery snapshots + recovery prompt                                                                                                     | ✅     |
|             | Keeps the previous save as `project.prev.json`; falls back to it if `project.json` is damaged                                                                        | ✅     |
|             | Relink missing media                                                                                                                                                 | ✅     |
|             | Portable "collect media into project" copy                                                                                                                           | ⏳     |
| Media       | Import via picker or OS drag-and-drop (video, audio, images)                                                                                                         | ✅     |
|             | Probing (duration, fps, size, rotation, audio) and clear errors for unsupported codecs                                                                               | ✅     |
|             | Background thumbnails + waveforms, cached in OPFS with a cap and a clear-cache action                                                                                | ✅     |
|             | Proxies for heavy footage                                                                                                                                            | ⏳     |
| Timeline    | Video / audio / text / caption tracks; add, hide, mute, lock, delete                                                                                                 | ✅     |
|             | Move (across compatible tracks), trim both edges, split, duplicate, delete                                                                                           | ✅     |
|             | Snapping to clip edges, beat markers and the playhead (toggle; Alt to bypass)                                                                                        | ✅     |
|             | Slip edit: Ctrl+drag a clip, or the Inspector's Clip window, to change which part of the source plays                                                                | ✅     |
|             | Multi-select and group move; zoom (Ctrl+wheel); fit                                                                                                                  | ✅     |
|             | Ripple edit, nested sequences, track reordering by drag                                                                                                              | ⏳     |
| Preview     | Real-time playback, scrubbing, frame stepping, safe-area guides                                                                                                      | ✅     |
|             | Click to select layers; drag to move with centre snapping; corner handle to scale                                                                                    | ✅     |
| Transform   | Position, scale, rotation, opacity, crop                                                                                                                             | ✅     |
|             | Masks, blend modes, keyframes                                                                                                                                        | ⏳     |
| Text        | Titles with 6 original presets; 5 bundled OFL fonts; size, colour, alignment, background box, outline, line height                                                   | ✅     |
|             | Animated text presets                                                                                                                                                | ⏳     |
| Captions    | Manual captions; SRT import/export; styling via the inspector                                                                                                        | ✅     |
|             | Automatic transcription                                                                                                                                              | ⏳     |
| Audio       | Per-clip volume (dB), mute, fade in/out; track mute; waveforms                                                                                                       | ✅     |
|             | Ducking, EQ, denoise                                                                                                                                                 | ⏳     |
| Timing      | Constant speed 0.1×–10× (pitch follows speed)                                                                                                                        | ✅     |
|             | Speed curves, reverse, optical-flow slow motion                                                                                                                      | ⏳     |
| Export      | MP4 (H.264 + AAC), resolution and quality, progress, cancel, ETA                                                                                                     | ✅     |
|             | 4K is offered when the sequence is 4K; untested on low-end hardware                                                                                                  | 🟡     |
| Beat sync   | Local beat / bass-hit detection; tap (B), drag and delete markers; markers stay attached to the music                                                                | ✅     |
|             | Beat templates: numbered slots cut on every 1/2/4/8 markers; drag-to-fill, swap, auto-fill, empty slot                                                               | ✅     |
|             | Save a template and start new projects from it                                                                                                                       | ⏳     |
| Undo        | Unlimited-ish (200 steps) undo/redo; slider drags merge into one step                                                                                                | ✅     |
| Diagnostics | Browser capability checks, encoder checks, storage quota                                                                                                             | ✅     |
| AI / MCP    | Local stdio bridge (`viditor-mcp.mjs`) + AI panel: connect, setup snippets, activity log, privacy switches                                                           | ✅     |
|             | 25 tools: read, add media, split/trim/move/delete/duplicate, titles, captions, transform, audio, speed, tracks, beats and templates, slip, atomic batches, undo/redo | ✅     |
|             | Verified by hand with Claude Code / Claude Desktop (automated tests use the official MCP SDK client)                                                                 | ⏳     |
|             | Remote relay for web-based assistants; frame/transcript sharing for content-aware edits                                                                              | ⏳     |

## Known limitations

- **Browsers:** desktop Chrome/Edge only. Firefox and Safari lack `showDirectoryPicker`.
- **Audio export:** needs the browser's AAC encoder, which Linux Chrome doesn't have.
- **Long projects:** the export mixdown holds the whole project's audio in memory
  (≈23 MB per minute of stereo 48 kHz). Projects of a few minutes are fine; very long ones aren't
  tested yet.
- **Preview sync:** the preview uses `<video>` elements and corrects drift above 0.25 s. Scrubbing
  is frame-accurate after each seek lands. Playback of many simultaneous 4K streams depends on
  hardware.
- **Variable frame rate** phone footage plays and exports, but frames are sampled at the sequence
  rate (no frame blending).
- **File permissions:** after a browser restart, media outside the project folder may need one
  click on "Allow access". Keeping footage inside the project folder avoids this.
- **Canceling an export** deletes the partial file using a Chromium-only API. Elsewhere, an empty
  file may be left behind.
