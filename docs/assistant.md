# AI assistant (MCP)

Viditor can be edited by an AI assistant through the [Model Context Protocol](https://modelcontextprotocol.io).
The assistant works on the project open in your browser, through the same engine as your own
edits. Its changes appear live, are validated, and each tool call is one undo step (Ctrl+Z).

```
 Claude Desktop / Claude Code            your computer                         browser tab
 ┌───────────────────────────┐  stdio  ┌──────────────────────┐  127.0.0.1  ┌─────────────────────┐
 │ MCP host (the assistant)  │ ──────▶ │ viditor-mcp.mjs      │ ◀── SSE ──▶ │ Viditor (AI panel)  │
 └───────────────────────────┘         │ local bridge (Node)  │    + POST   │ ProjectEngine       │
                                       └──────────────────────┘             └─────────────────────┘
```

The bridge only relays tool calls. All edits run inside the tab. The VPS never sees any of it.

## Setup

1. Install **Node.js 20+** (nodejs.org).
2. In Viditor, open the **AI** tab in the left sidebar → **Show setup steps** → download
   `viditor-mcp.mjs` and save it somewhere permanent (e.g. `Documents\Viditor\`).
3. Type the saved path into the panel. It then shows the exact config for your assistant:
   - **Claude Code:** `claude mcp add --scope user viditor -- node "C:\path\to\viditor-mcp.mjs"`
   - **Claude Desktop:** Settings → Developer → Edit Config, add:
     ```json
     {
       "mcpServers": { "viditor": { "command": "node", "args": ["C:\\path\\to\\viditor-mcp.mjs"] } }
     }
     ```
4. Restart the assistant, open a project in Viditor, click **Connect** in the AI panel. If Chrome
   or Edge asks whether the site may access apps on this device, allow it. That's how the page
   reaches the bridge on 127.0.0.1.
5. Ask for edits, e.g. _"Trim the first 2 seconds of the first clip, add the title 'Day one' as a
   lower third at the start, and fade the music out over the last 3 seconds."_

Once connected, the editor reconnects on its own the next time you open a project. Use
**Disconnect** to stop it.

### Options (environment variables for the bridge)

| Variable                  | Default                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `VIDITOR_BRIDGE_PORT`     | `47821` (also change "Bridge port" in the AI panel)                            |
| `VIDITOR_ALLOWED_ORIGINS` | `https://viditor.samuelgelacio.io,http://localhost:5173,http://127.0.0.1:5173` |

## Tools

Times are in seconds. Edits accept optional `expectedRevision` (reject if the project changed),
`projectId` (reject if a different project is open) and `opId` (retry-safe idempotency key).

| Tool                    | What it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `get_project`           | Sequence, duration, playhead, tracks, media (IDs + generic labels), revision      |
| `get_timeline`          | Clips with timing, source in-point, speed, audio, transform; filter by time/track |
| `add_media_to_timeline` | Place an imported media item; first video sets the sequence format                |
| `split_clip`            | Split given clips, or everything under a time                                     |
| `trim_clip`             | Move a clip's start or end edge                                                   |
| `move_clip`             | Move a clip in time and/or to another compatible track                            |
| `delete_clips`          | Remove clips (media stays in the project)                                         |
| `duplicate_clip`        | Copy a clip                                                                       |
| `add_title`             | Text overlay with presets, font, size, colour, background, position               |
| `update_text`           | Edit a title/caption's text and style                                             |
| `set_transform`         | Position, scale, rotation, opacity, crop                                          |
| `set_audio`             | Volume (dB), mute, fade in/out                                                    |
| `set_speed`             | Constant speed 0.1×–10×                                                           |
| `add_captions`          | Batch of timed captions                                                           |
| `set_track`             | Mute / hide / lock / rename a track                                               |
| `apply_operations`      | Advanced: atomic batch of raw engine operations (frames)                          |
| `undo` / `redo`         | Undo or redo the last change                                                      |
| `show_in_editor`        | Move the playhead / select clips to point the user at something                   |

The assistant **cannot** import files, export video, read your footage, or touch the file
system. Those stay with you and your browser's file pickers.

## Privacy

By default the assistant sees timeline structure, timings, resolution and generic labels such as
"Video 1". File names and title/caption text are hidden until you switch them on in the AI panel
(they're stored per project in `privacySettings`). Whatever you share goes to your assistant's
provider as part of the conversation. Frames, audio and transcripts are never sent.

## Security model

- The bridge listens on **127.0.0.1 only**. Nothing is exposed to the network.
- It accepts browser requests only from allowed **Origins**, which browsers set and pages can't
  forge, so other websites can't drive or impersonate the editor.
- It checks the **Host** header against its own loopback address, which defeats DNS rebinding.
- Each Connect gets a fresh 256-bit **session token**. Only one tab is connected at a time; a newly
  connected tab replaces the old one.
- The connection is **opt-in per browser** (the Connect button) and visible: a status pill in the
  top bar and an activity log of every call.
- The site's Content-Security-Policy allows connections only to its own origin and to loopback.

## Compatibility

| Host                      | Transport | Tools tested                                                                                                                                   | Status                                       |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| MCP TypeScript SDK client | stdio     | All read tools, add_title, split_clip, undo, show_in_editor, privacy filter, stale revision (automated, `tests/integration/assistant.spec.ts`) | ✅ Passing in CI                             |
| Claude Code               | stdio     | —                                                                                                                                              | Expected to work. Not yet verified by hand   |
| Claude Desktop            | stdio     | —                                                                                                                                              | Expected to work. Not yet verified by hand   |
| Remote / web assistants   | —         | —                                                                                                                                              | Not supported. Needs a hosted relay (future) |

## Troubleshooting

- **"Waiting for the bridge…"**: the assistant isn't running the bridge. Check the config path and
  restart the assistant. In Claude Code, `claude mcp list` should show `viditor` as connected.
- **"Port 47821 is already in use"**: two assistants started a bridge. Close one, or give one of
  them `VIDITOR_BRIDGE_PORT` and set the same port in the AI panel.
- **Browser blocked the connection**: allow the site's "apps on this device" / local network
  permission in the site settings (padlock icon), then click Connect again.
