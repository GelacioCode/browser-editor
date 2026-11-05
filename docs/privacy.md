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
- The site sets a strict Content-Security-Policy (`connect-src 'self'`), so the page can't send data
  to third-party servers. No analytics, fonts or scripts are loaded from other domains.
- Once loaded, manual editing and export work offline.

## Future AI assistant (MCP) sharing

When assistant support is added, it will default to sharing nothing beyond the minimal timeline
structure the assistant needs to make edits, with generic media labels and no file names or paths.
Sharing file names, title/caption text, frames, audio or transcripts will each need a separate,
visible opt-in in the project's privacy settings (`privacySettings` in `project.json`, all `false`
by default).
