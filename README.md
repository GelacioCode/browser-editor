# Viditor

A local-first video editor that runs in the browser. Import clips, arrange them on a multitrack
timeline, add titles and captions, adjust transforms and audio, and export an MP4. **Footage never
leaves your computer:** files are read straight from disk, and decoding, compositing and encoding
all happen locally (WebCodecs). The server only hosts static files.

Live: https://viditor.samuelgelacio.io

> Status: **milestone 2**: a usable manual editor plus **AI co-editing over MCP**. An assistant
> such as Claude can edit the open project live through a local bridge
> ([docs/assistant.md](docs/assistant.md)). A full visual redesign is planned next. See
> [docs/feature-status.md](docs/feature-status.md).

## Browser support

Desktop **Chrome** or **Edge** (current versions). The editor needs the File System Access API,
WebCodecs and OffscreenCanvas. Other browsers get a diagnostics screen that explains what's
missing. Export to MP4 needs the browser's H.264 and AAC encoders. These are available in Chrome/Edge
on Windows and macOS. Linux Chrome lacks AAC, so it can't export projects with audio.

## Quick start

Requirements: Node.js 24+, pnpm (via `corepack enable`).

```bash
corepack enable
pnpm install
pnpm dev            # http://localhost:5173
```

## Scripts

| Script                  | What it does                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Start the editor dev server (Vite)                                                             |
| `pnpm build`            | Builds the MCP bridge bundle, then the web app → `apps/web/dist`                               |
| `pnpm build:bridge`     | Only the bridge → `apps/web/public/downloads/viditor-mcp.mjs`                                  |
| `pnpm preview`          | Serve the production build locally with the production security headers                        |
| `pnpm typecheck`        | TypeScript checks for every workspace package                                                  |
| `pnpm lint`             | ESLint                                                                                         |
| `pnpm test`             | Unit tests (engine, timing, SRT, audio envelopes, layout, assistant tools)                     |
| `pnpm test:integration` | Builds, then runs Playwright in Edge: UI flow, real export, MCP assistant loop, production CSP |

`pnpm test:integration` uses the installed Microsoft Edge (`PW_CHANNEL=chrome` to use Chrome).
The open-source Chromium build lacks the H.264/AAC encoders.

## Repository layout

| Path                    | Responsibility                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web`              | React editor: layout, media library, preview, inspector, timeline, export dialog          |
| `packages/project-core` | Project schema (zod), timing model, operation engine, revisions, undo/redo, SRT           |
| `packages/composition`  | Shared frame compositor + audio envelope used by **both** preview and export              |
| `packages/media`        | File System Access helpers, handle persistence, probing, thumbnail/waveform worker, cache |
| `packages/render`       | Export: audio mixdown + worker that decodes, composites, encodes and muxes MP4            |
| `packages/contracts`    | Assistant tool catalogue (run in the tab), bridge protocol, privacy-filtered views        |
| `apps/mcp-bridge`       | `viditor-mcp`: local stdio MCP server relaying tool calls to the tab over 127.0.0.1       |
| `tests/integration`     | Playwright tests                                                                          |
| `deploy`                | Dockerfile, Caddy config, docker-compose for the VPS                                      |
| `docs`                  | Architecture, deployment, feature status, privacy, original project guide                 |

## Deploying

See [docs/deployment.md](docs/deployment.md). After the one-time setup there, every push to `main`
that passes CI is deployed automatically. First install on the VPS:

```bash
git clone https://github.com/GelacioCode/browser-editor.git /opt/browser-editor && cd /opt/browser-editor
cp deploy/.env.example deploy/.env      # set your proxy network / Traefik names
docker compose -p viditor -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

## Docs

- [Architecture](docs/architecture.md)
- [Feature status & known limitations](docs/feature-status.md)
- [Beat-sync templates](docs/beat-templates.md)
- [AI assistant (MCP)](docs/assistant.md)
- [Privacy](docs/privacy.md)
- [Deployment](docs/deployment.md)
- [Original project guide](docs/Local_Video_Editor_MCP_Project_Guide.md)
