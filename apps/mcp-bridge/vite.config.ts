import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * Bundles the bridge and all its dependencies into ONE file, viditor-mcp.mjs, that runs with plain
 * `node` (no install step). It is written into the web app's public folder so the site serves it
 * at /downloads/viditor-mcp.mjs.
 */
export default defineConfig({
  define: { __BRIDGE_VERSION__: JSON.stringify(pkg.version) },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/main.ts',
    target: 'node20',
    outDir: '../web/public/downloads',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'viditor-mcp.mjs',
        banner: '#!/usr/bin/env node',
        inlineDynamicImports: true,
      },
    },
  },
});
