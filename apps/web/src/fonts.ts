import { loadFonts, type FontFile } from '@viditor/composition';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import mont400 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff2?url';
import mont700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url';
import play400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url';
import play700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url';
import bebas400 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import mono400 from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2?url';
import mono700 from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff2?url';

const abs = (u: string) => new URL(u, location.href).href;

/** Absolute URLs so the export worker can load the same font files. */
export const FONT_FILES: FontFile[] = [
  { family: 'Inter', weight: 400, url: inter400 },
  { family: 'Inter', weight: 700, url: inter700 },
  { family: 'Montserrat', weight: 400, url: mont400 },
  { family: 'Montserrat', weight: 700, url: mont700 },
  { family: 'Playfair Display', weight: 400, url: play400 },
  { family: 'Playfair Display', weight: 700, url: play700 },
  { family: 'Bebas Neue', weight: 400, url: bebas400 },
  { family: 'Roboto Mono', weight: 400, url: mono400 },
  { family: 'Roboto Mono', weight: 700, url: mono700 },
].map((f) => ({ ...f, url: abs(f.url) }));

let loaded: Promise<void> | null = null;

export function ensureFontsLoaded(): Promise<void> {
  loaded ??= loadFonts(document.fonts, FONT_FILES).catch((e) =>
    console.error('Font load failed', e),
  );
  return loaded;
}
