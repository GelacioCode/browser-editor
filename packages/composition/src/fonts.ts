/**
 * Fonts available to titles and captions. They are self-hosted (OFL licensed, via @fontsource)
 * and loaded with the FontFace API in both the main thread (preview) and the export worker, so
 * text renders identically in both.
 */
export interface FontDef {
  family: string;
  weights: readonly number[];
}

export const FONTS: readonly FontDef[] = [
  { family: 'Inter', weights: [400, 700] },
  { family: 'Montserrat', weights: [400, 700] },
  { family: 'Playfair Display', weights: [400, 700] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Roboto Mono', weights: [400, 700] },
];

export interface FontFile {
  family: string;
  weight: number;
  url: string;
}

/** Load font files into a FontFaceSet (document.fonts or self.fonts in a worker). */
export async function loadFonts(set: FontFaceSet, files: readonly FontFile[]): Promise<void> {
  await Promise.all(
    files.map(async (f) => {
      const face = new FontFace(f.family, `url(${JSON.stringify(f.url)})`, {
        weight: String(f.weight),
      });
      await face.load();
      set.add(face);
    }),
  );
}

export function cssFont(family: string, weight: number, sizePx: number): string {
  return `${weight} ${sizePx}px "${family}", sans-serif`;
}
