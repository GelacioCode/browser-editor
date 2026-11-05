# Local Video Editor with MCP — Project Setup and Build Guide

Version: 1.0  
Prepared for: Samuel  
Date: 2026-11-03  
Status: Implementation specification. No application, installer, or deployment is included with this document.

## 1. Project goal

Build a video editor with a familiar CapCut-style workflow: import footage, arrange clips on a timeline, preview changes, edit manually, optionally ask an AI assistant to perform edits, and export a finished video.

Original footage, project files, caches, and exported videos remain on the user's computer by default. The existing 120 GB VPS does not store customer video libraries.

The AI and the manual interface must operate on the same editable project. AI edits must remain visible, adjustable, and undoable.

CapCut is a workflow reference. Use original branding, interface details, presets, and licensed assets. Full feature parity is a long-term goal, not a first-release promise.

## 2. Decisions and boundaries

| Topic | Initial decision |
| --- | --- |
| Primary platform | Installable Windows desktop application |
| Interface | React and TypeScript inside Electron |
| Media processing | Native FFmpeg and ffprobe on the user's computer |
| Project storage | Versioned JSON plus local media references |
| Database | None required for the personal prototype |
| AI connection | Local MCP server connected to a compatible external assistant |
| AI chat | Initially stays in the external assistant |
| VPS | Website, downloads, release metadata; optional authenticated relay later |
| Original media uploads | Disabled by default; no media-upload endpoint in the first release |
| Initial export target | MP4, H.264 video and AAC audio, 1080p, subject to codec/build validation |
| Other AI providers | Add only after verifying each specific host's MCP support |
| First commercial release | Separate milestone after reliability and customer testing |

These are proposed architecture choices. Dependency versions, distribution requirements, and host-specific integration details must be verified and pinned during implementation.

A browser-only version remains a possible later product. It requires separate validation of file permissions, codecs, memory limits, background execution, and export performance. Electron packaging does not automatically solve playback or codec limitations.

## 3. Expected user experience

1. Install and open the editor.
2. Create a project and choose its local folder.
3. Import local footage, images, and music through a file picker.
4. Drag media onto video and audio tracks.
5. Make manual edits with the timeline and properties panel.
6. Connect a compatible assistant through the generated MCP configuration.
7. Ask for an edit such as: "Trim the opening by three seconds, add this title, and fade the music out."
8. Watch the timeline and preview update after validated operations.
9. Adjust or undo any changes manually.
10. Save the project and export to a chosen local destination.

The first version does not promise an embedded ChatGPT, Claude, Gemini, or Grok login. MCP connects a host to tools; it does not transfer subscriptions or grant access to every model.

## 4. Editor layout

| Region | Content |
| --- | --- |
| Top bar | Project name, save state, undo/redo, format, export |
| Left panel | Media library, titles, transitions, effects, project assets |
| Center | Preview player, playback controls, safe-area guides |
| Right panel | Selected clip's transform, text, audio, speed, effects |
| Bottom | Multitrack timeline, ruler, playhead, snapping, waveform, zoom |
| Connection panel | MCP status, connected client, sharing permissions, activity log |

Avoid decorative controls that do nothing. Features not implemented should be omitted or clearly marked unavailable.

## 5. Feature roadmap

| Feature group | First working release | Later stages |
| --- | --- | --- |
| Projects | Create, save, reopen, autosave recovery, relink missing media | Portable project collection |
| Media | Import common tested formats; probe metadata; thumbnails | Broader codec coverage and optimized proxies |
| Timeline | Multitrack clips; split, trim, move, duplicate, delete; snapping | Nested sequences and advanced ripple modes |
| Preview | Playback, seek, scrub, composited titles, audio mixing | More effects and improved GPU compositing |
| Transform | Position, scale, rotate, crop, opacity | Masks and blend modes |
| Text | Titles, font, color, size, alignment | Animated title presets |
| Audio | Separate tracks, gain, mute, fades, waveforms | Ducking, denoise, equalizer |
| Captions | Manual captions; SRT import/export and styling | Local transcription and word-level animation |
| Timing | Constant speed adjustments | Curves, reverse, optical-flow slow motion |
| Animation | Basic supported property controls | Keyframes and easing |
| Color | Limited tested adjustments | LUTs and advanced grading |
| Export | Local 1080p export with progress and cancellation | 4K and more presets after validation |
| MCP | Inspect project; supported manual edit operations; undo | More tools as features become reliable |
| Vision | None required for precise timeline commands | Opt-in frame sharing or local analysis |
| AI media generation | Outside the initial scope | Optional local or cloud integrations |

Captions generated automatically, background removal, stabilization, tracking, and smooth slow motion are separate engineering tasks. Do not present them as completed because an AI connection exists.

## 6. Architecture

### Desktop components

- Renderer: editing interface and preview compositor.
- Main process: trusted application lifecycle and restricted native operations.
- Preload bridge: a small typed API between interface and trusted services.
- Project engine: authoritative state, validation, transactions, undo/redo.
- Media service: probing, thumbnails, proxies, waveform generation.
- Render worker: export compilation and FFmpeg execution.
- Local connection broker: authenticated communication with the MCP adapter.
- MCP adapter: exposes the supported project operations to an external host.

Both manual actions and AI actions call the project engine. Neither edits project JSON independently behind the engine's back.

### Preview and export consistency

Define a shared composition model for timing, transforms, layering, text, audio, and effects. Implement both preview and export against that model.

A preview player alone is insufficient. It must show the actual edited composition, including overlays, trimmed timing, speed, and audio changes.

Start with a small supported feature set that matches between preview and export. Test it before adding effects. Unsupported operations must fail clearly rather than silently disappear from exports.

### Authoritative state

Keep one active writer for each open project. Serialize mutations. The assistant must not create a second in-memory copy of the same project.

Each transaction increments a revision. A request using an outdated revision returns a conflict so the assistant can inspect current state again.

## 7. Local storage and recovery

Suggested project directory:

- project.json — durable editing instructions and schema version.
- recovery/ — recent autosave snapshots.
- cache/thumbnails/ — disposable previews.
- cache/waveforms/ — disposable audio visualization data.
- cache/proxies/ — optional smaller editing copies.
- exports/ — optional export location selected by the user.
- assets/ — optional collected copies for a portable project.

By default, imported files remain at their original locations. Explain that moving or deleting them requires relinking.

Store relative paths when practical. Keep machine-specific paths out of cloud tool responses. Use media IDs in AI-visible data.

Write project files atomically using a temporary file and replacement. Keep a previous valid snapshot. On launch after a crash, offer recovery without overwriting the saved project.

Cache rules:

- Default suggested cap: 5 GB per device, configurable.
- Show cache usage and a clear-cache action.
- Remove oldest unused entries when the cap is reached.
- Never remove originals or exports as part of cache cleanup.
- Check available disk space before large proxy or export jobs.
- Cancel jobs cleanly and remove their incomplete temporary files.
- Download optional models separately, showing their size and license.
- Keep model storage separate from disposable editing caches.

## 8. Project data contract

Use integer frame counts for timeline positions in a fixed-frame-rate sequence and rational frame rates such as 30000/1001. Store source timing as rational timestamps or source time-base ticks, with explicit conversion rules. Use sample counts for precise audio operations where needed.

Recommended top-level fields:

| Field | Purpose |
| --- | --- |
| schemaVersion | Migration compatibility |
| projectId | Stable project identity |
| revision | Mutation conflict detection |
| sequence | Resolution, frame rate, duration, background |
| media | Media IDs, local references, probe metadata |
| tracks | Ordered video, audio, text, and caption tracks |
| clips | Source in/out, timeline placement, media reference |
| effects | Validated typed parameters |
| captions | Text, timing, styling |
| exportSettings | Format and encoder choices |
| privacySettings | Explicit sharing permissions |

Do not persist provider credentials, temporary connection secrets, or entire AI conversations in the project file.

## 9. MCP connection design

### First target: local assistant host

Use a local stdio MCP adapter for one explicitly tested host.

The adapter connects to the running desktop app using an OS-local channel, or an authenticated loopback connection where needed. It must reach the same project engine used by the interface.

If loopback HTTP is used, bind only to loopback, authenticate connections, restrict origins, validate host headers, and generate short-lived session credentials. Do not expose the editor's native file operations on a public port.

Generate client configuration only after the actual executable path and launch arguments exist. Do not provide guessed installation commands.

### Later target: remote cloud hosts

A cloud host cannot directly reach a user's localhost.

Remote support needs an authenticated public Streamable HTTP MCP endpoint and an outbound connection from the desktop app to a relay. A WebSocket may serve the internal desktop-to-relay link; it is not a replacement for the host-facing MCP transport.

Design pairing, authorization, expiration, revocation, reconnect behavior, and per-session routing before enabling this mode. Use OAuth where required by the selected host and MCP authorization guidance.

For a prototype, relay sessions may be held in memory and invalidated after restart. A paid service may need durable account, billing, or entitlement records, whether in a managed service or a database. "No video database" does not mean "no customer records ever."

Maintain an explicit compatibility matrix:

| Host | Transport | Tools tested | Permissions checked | Status |
| --- | --- | --- | --- | --- |
| Initial selected host | To verify | To verify | To verify | Not tested |
| Other hosts | To verify | To verify | To verify | Not supported until tested |

### Proposed tools

| Tool | Purpose |
| --- | --- |
| get_project | Compact current state, sequence and revision |
| list_media | IDs, duration and technical metadata |
| get_timeline | Clips and tracks in a requested range |
| split_clip | Split at a validated timeline position |
| trim_clip | Change source boundaries and duration |
| move_clip | Move within a track or to another track |
| add_title | Add an editable text clip |
| set_transform | Change supported visual properties |
| set_audio | Change gain, mute, or fades |
| set_speed | Apply a supported speed change |
| add_caption | Add or update timed editable text |
| apply_operations | Apply a validated batch atomically |
| undo_last_action | Undo one project transaction |
| get_job_status | Inspect a long-running operation |

Local UI file pickers approve imports and output destinations. Do not accept unrestricted filesystem paths or arbitrary FFmpeg commands from AI tools.

All mutation tools need:

- Schema validation and bounded values.
- Active project/session authorization.
- Stable target IDs and expected revision.
- Atomic commit and undo entry.
- An operation ID to avoid duplicate edits on retries.
- A state-change event for immediate UI updates.
- Structured errors for missing media, stale revision, unsupported operations, and invalid timing.

Export should use a user-approved destination token. File deletion, overwriting exports, cloud sharing, and costly processing require explicit product controls.

## 10. Privacy modes

| Mode | Data allowed to leave the computer |
| --- | --- |
| Manual/offline | None required for editing and export |
| Command-only cloud AI | Prompts and minimal approved timeline/project information |
| Assisted cloud analysis | Explicitly approved frames, transcripts, or audio excerpts |
| Local AI | Analysis stays local when all models and services run locally |

Even command-only cloud AI may receive clip labels, title text, or timestamps. It is not fully offline.

Default behavior:

1. Do not send footage, audio, thumbnails, transcripts, filenames, or local paths automatically.
2. Use generic labels and media IDs in tool responses.
3. Show what information will be shared before enabling analysis.
4. Require separate opt-in for transcripts, frames, audio, and full media.
5. Make any future cloud-sharing state visible and revocable.
6. Provide an offline manual editing mode.
7. Make error reporting opt-in and remove project content and paths.

A cloud assistant cannot understand unseen footage merely because it has MCP access. It can follow precise commands from metadata; content-aware decisions require approved content or local analysis.

## 11. Suggested repository structure

| Path | Responsibility |
| --- | --- |
| apps/desktop | Electron main process, preload bridge, packaging |
| apps/editor | React editor and preview |
| apps/mcp-adapter | Local MCP tool server |
| apps/relay | Optional later remote-host bridge |
| packages/project-core | Schema, operations, revisions, undo/redo |
| packages/media | Probe, thumbnails, proxies, waveforms |
| packages/render | Composition-to-export compiler and workers |
| packages/contracts | Shared tool and event schemas |
| packages/presets | Original supported presets |
| tests/fixtures | Small synthetic test assets |
| docs | Setup, architecture, privacy, release instructions |

Suggested supporting tools: a workspace package manager, schema validation library, unit test runner, desktop integration test runner, and installer packager. Select maintained versions during implementation, pin them, and commit the lockfile.

## 12. Developer setup sequence

These are implementation tasks, not commands for an existing repository.

1. Create the repository and architecture notes.
2. Install a supported Node.js LTS release and the chosen package manager.
3. Scaffold the Electron, React, and TypeScript workspace.
4. Configure a sandboxed renderer and narrow preload API.
5. Add FFmpeg and ffprobe discovery and a startup diagnostic screen.
6. Build the versioned project schema and operation engine.
7. Implement local project creation, saving, and media import.
8. Implement probing and asynchronous thumbnail/waveform jobs.
9. Build the timeline, selection, snapping, and manual operations.
10. Implement preview and export for the same restricted feature set.
11. Add job cancellation, recovery, and missing-media relinking.
12. Add the MCP adapter and connect the first verified host.
13. Add privacy controls and inspect network behavior.
14. Produce a Windows installer and test on a separate machine.

Required repository scripts to implement and document:

| Script | Intended behavior |
| --- | --- |
| dev | Start the desktop development environment |
| build | Build all application packages |
| typecheck | Check TypeScript contracts |
| test | Run project engine and contract checks |
| test:integration | Run desktop, render, and MCP checks |
| package:win | Produce a Windows installer |
| doctor | Check codecs, processing binaries, paths, and device capability |

The final repository README must contain the actual install, run, build, and packaging commands after they work. Do not claim these scripts already exist.

## 13. VPS deployment plan: 120 GB disk

The local-only prototype does not require a VPS to edit or export.

For distribution:

1. Choose a download domain or subdomain.
2. Serve a static product/download site through an HTTPS reverse proxy.
3. Upload versioned installers, checksums, and release metadata.
4. Keep a small number of releases available and remove old binaries deliberately.
5. Rotate logs and monitor disk usage.
6. Back up configuration, release metadata, and any later account records.
7. Keep media import/export endpoints absent.

Illustrative disk budget; adapt after measuring existing use:

| Use | Planning allowance |
| --- | --- |
| OS, installed services, existing usage | Measure first |
| Website, installers, release assets | Up to 15 GB |
| Logs and service caches | Up to 5 GB with enforced rotation |
| Temporary operational files | Up to 5 GB |
| Free space reserve | At least 20 GB where practical |
| Customer footage and exports | 0 GB by default |

Confirm actual available capacity before allocating anything. A nominal 120 GB disk already includes system use.

For a later relay:

- Run it as an unprivileged supervised service.
- Terminate HTTPS at the reverse proxy.
- Keep internal service ports private.
- Configure authenticated host access and desktop pairing.
- Set request, response, session, and connection limits.
- Bound memory use; expire idle sessions.
- Keep video payloads out of relay messages and logs.
- Revoke sessions on logout and explain restart behavior.
- Never make MCP endpoints anonymous.

The relay routes structured commands and approved metadata. It does not need to render videos.

## 14. Processing and performance

Use local workers so probing and rendering do not block the interface. Bound concurrency and support cancellation.

Probe source media rather than assuming every MP4 uses the same codec or frame rate. Cover variable-frame-rate phone footage, audio sample-rate differences, rotation metadata, and missing audio.

Use optional proxies for large or difficult footage. Preserve originals for final export. Report estimated disk needs before proxy generation.

Detect encoders and test their actual availability. Hardware acceleration is optional; a detected GPU does not guarantee support for every effect or encoder. Provide a software fallback.

Initial target: stable editing and export for short 1080p projects on the tested Windows hardware. Establish measured performance limits before advertising 4K, long projects, or multiple AI effects.

## 15. Validation and release gates

### Manual editing

- Import multiple clips, one image, and music.
- Split and trim clips; move them across tracks.
- Add a title, captions, transforms, and audio fades.
- Save, close, reopen, and verify the result.
- Relink a deliberately moved source file.
- Recover from an interrupted save.

### Preview/export agreement

- Compare representative exported frames with preview compositions.
- Verify text placement, crop, rotation, opacity, layering, and timing.
- Check audio synchronization, fades, and silence.
- Test constant and variable frame-rate sources.
- Inspect exported metadata, duration, and playback in a separate player.
- Test cancellation, disk-full behavior, and missing encoders.

### MCP

- Confirm manual and AI operations reach the same project.
- Verify UI updates immediately after a committed tool action.
- Undo an AI batch as one transaction.
- Reject stale revisions and invalid ranges.
- Retry an operation ID without duplicating edits.
- Disconnect/reconnect without targeting another project.
- Verify tools cannot access unapproved files.

### Privacy

- Inspect outbound network traffic during manual editing and export.
- Verify media does not reach the VPS.
- Inspect MCP responses for paths, filenames, frames, and transcripts.
- Confirm sharing-disabled modes block analysis payloads.
- Confirm logs and crash reports do not contain project content.
- Verify the app works offline for manual operations.

### Distribution

- Install on a clean Windows machine without development tools.
- Verify bundled binary discovery and runtime dependencies.
- Verify installer/update integrity and permissions.
- Keep user projects intact during upgrades and uninstall decisions.

## 16. Development milestones

| Milestone | Deliverable | Exit condition |
| --- | --- | --- |
| 0: Technical proof | Local import, simple timeline, preview, export | Small test video exports correctly |
| 1: Usable manual editor | Core controls, saving, recovery | A complete short video can be made manually |
| 2: MCP co-editing | One verified host and shared engine | AI edits appear live and remain undoable |
| 3: Editing depth | Captions, animation, transitions, selected effects | Preview/export checks pass for each feature |
| 4: Local analysis | Transcription and selected local models | Measured quality, disk, and hardware limits |
| 5: Private beta | Installer, diagnostics, documentation | External users complete real projects |
| 6: Commercial release | Entitlements, support, distribution | Costs, licensing, privacy, and demand validated |

Do not assign fixed completion dates before the technical proof establishes the complexity of preview/export parity.

## 17. Commercial preparation

Possible models include a paid desktop license, paid upgrades, or a subscription for maintained editor features and presets. External assistant subscriptions remain the user's separate arrangement.

Before selling:

- Audit all dependencies, codecs, fonts, models, stock media, and preset licenses.
- Check the specific FFmpeg build and distribution obligations.
- Use original or properly licensed templates and assets.
- Validate provider terms for the exact supported connection.
- Add signing, trusted updates, support, refund terms, and a privacy policy.
- Keep recurring hosting costs separate from any optional AI charges.
- Introduce durable entitlement handling only when commercial requirements justify it.

Revenue is a business goal, not a guaranteed outcome.

## 18. Build brief for a developer or coding assistant

Build a Windows-first local video editor using the architecture in this document. Start with milestone 0 and preserve working behavior as each milestone is added.

Use a familiar timeline-editor arrangement with original branding. Store footage, projects, caches, and exports locally. Do not implement automatic media uploads.

Implement one validated project-operation engine used by both manual controls and MCP tools. Ensure preview and export agree for every advertised feature. Add revisions, atomic batches, idempotency, undo/redo, local recovery, and explicit privacy controls.

Connect one compatible MCP host first. Do not promise generic subscription login or support for untested hosts. Keep native file access and export execution behind narrow validated APIs.

Deliver working code, the actual setup commands, a feature-status table, a Windows build, validation results, and known limitations. Never substitute placeholder buttons, simulated exports, or a decorative timeline for working editing behavior.

## 19. References and verification notes

These sources inform the architecture; proposed design choices above are not guarantees made by the referenced products.

- CapCut feature reference: https://www.capcut.com/resource/how-to-use-capcut
- CapCut keyframe reference: https://www.capcut.com/tools/keyframe-animation
- MCP architecture and transports: https://modelcontextprotocol.io/docs/learn/architecture
- MCP documentation index: https://modelcontextprotocol.io/docs
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- FFmpeg documentation: https://ffmpeg.org/documentation.html
- FFmpeg distribution and license information: https://ffmpeg.org/legal.html
- Exploratory editor reference, not an audited dependency: https://github.com/metiutek/editorvideo-ai

CapCut, MCP, and Electron pages were checked during planning. FFmpeg documentation could not be fetched during this preparation; verify its current build, filter, encoder, and licensing documentation during implementation. Review current host documentation before generating connection instructions.

## 20. Definition of the first successful version

Samuel can import his own clips, edit a complete short video manually, ask a compatible assistant to make supported edits, see those edits in the timeline, undo or adjust them, reopen the saved project, and export locally without uploading his footage to the VPS or a third-party video editor.

Cloud AI content analysis remains optional and clearly separated from this local editing workflow.

