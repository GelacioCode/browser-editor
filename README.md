# Viditor

A local-first video editor that runs in the browser. Import clips, arrange them on a multitrack
timeline, add titles and captions, adjust transforms and audio, and export an MP4. **Footage never
leaves your computer:** files are read straight from disk, and decoding, compositing and encoding
all happen locally (WebCodecs). The server only hosts static files.

Live (once deployed): https://viditor.samuelgelacio.io

> Status: **MVP / milestone 1** (usable manual editor). AI co-editing over MCP is the next
> milestone. A full visual redesign is planned after the MVP. See
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

| Script                  | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Start the editor dev server (Vite)                                                          |
| `pnpm build`            | Production build of the web app → `apps/web/dist`                                           |
| `pnpm preview`          | Serve the production build locally with the production security headers                     |
| `pnpm typecheck`        | TypeScript checks for every workspace package                                               |
| `pnpm lint`             | ESLint                                                                                      |
| `pnpm test`             | Unit tests (project engine, timing, SRT, audio envelopes, layout)                           |
| `pnpm test:integration` | Builds, then runs Playwright in Edge: UI editing flow, real export pipeline, production CSP |

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
| `packages/contracts`    | Types for the future MCP bridge (privacy-filtered project view)                           |
| `tests/integration`     | Playwright tests                                                                          |
| `deploy`                | Dockerfile, Caddy config, docker-compose for the VPS                                      |
| `docs`                  | Architecture, deployment, feature status, privacy, original project guide                 |

## Deploying

See [docs/deployment.md](docs/deployment.md). In short, on the VPS:

```bash
git clone https://github.com/GelacioCode/browser-editor.git && cd browser-editor
cp deploy/.env.example deploy/.env      # set your proxy network / Traefik names
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

## Docs

- [Architecture](docs/architecture.md)
- [Feature status & known limitations](docs/feature-status.md)
- [Privacy](docs/privacy.md)
- [Deployment](docs/deployment.md)
- [Original project guide](docs/Local_Video_Editor_MCP_Project_Guide.md)
