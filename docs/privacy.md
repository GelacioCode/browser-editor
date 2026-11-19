# Privacy

Viditor runs entirely in your browser.

- **Footage, audio, thumbnails, file names and paths are never uploaded.** The server at
  `viditor.samuelgelacio.io` only serves the app's static files. It has no upload, media or API
  endpoints.
- Project files (`project.json`, recovery snapshots) are written to the folder you choose.
- Thumbnails and waveforms are cached in the browser's private storage for this site, and can be
  cleared from **Settings → Cache**.
- The browser remembers which files and folders you granted access to (IndexedDB) so projects can
  reopen. Removing a project from "Recent projects" or clearing site data removes these.
- The site sets a strict Content-Security-Policy: the page can only connect to its own origin and
  to your own computer's loopback address (for the optional assistant bridge), so it can't send data
  to third-party servers. No analytics, fonts or scripts are loaded from other domains.
- Once loaded, manual editing and export work offline.

## AI assistant (MCP)

The assistant connection is off until you click **Connect** in the AI panel. Even then, the editor
talks only to the `viditor-mcp` bridge on your own computer (127.0.0.1). The assistant then sees:

- **Always:** timeline structure and timings, track layout, resolution, frame rate, and generic media
  labels ("Video 1"). This goes to your assistant's provider as part of the conversation.
- **Only if you switch it on (per project):** original file names; title and caption text.
- **Never:** footage, audio, frames, thumbnails, transcripts or file paths.

Every assistant action is listed in the AI panel's activity log and can be undone. Details:
[assistant.md](assistant.md).
