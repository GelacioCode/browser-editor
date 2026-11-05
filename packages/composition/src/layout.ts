import type { Sequence, TextStyle, Transform } from '@viditor/project-core';
import { cssFont } from './fonts.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Geometry of a placed layer in sequence pixels. */
export interface LayerBox {
  /** Centre of the full (uncropped) layer. */
  cx: number;
  cy: number;
  /** Full (uncropped) size after fit and scale. */
  width: number;
  height: number;
  /** Radians. */
  rotation: number;
}

/** Fit a source of size w×h into the sequence ("contain"), then apply the transform. */
export function mediaLayerBox(seq: Sequence, srcW: number, srcH: number, t: Transform): LayerBox {
  const base = Math.min(seq.width / Math.max(1, srcW), seq.height / Math.max(1, srcH));
  return {
    cx: seq.width / 2 + t.x * seq.width,
    cy: seq.height / 2 + t.y * seq.height,
    width: srcW * base * t.scale,
    height: srcH * base * t.scale,
    rotation: (t.rotation * Math.PI) / 180,
  };
}

/** The visible (cropped) rectangle of a layer, in layer-local coordinates centred on (0,0). */
export function croppedLocalRect(box: LayerBox, t: Transform) {
  const { left, right, top, bottom } = t.crop;
  return {
    x: -box.width / 2 + left * box.width,
    y: -box.height / 2 + top * box.height,
    w: box.width * (1 - left - right),
    h: box.height * (1 - top - bottom),
  };
}

export interface TextLayout {
  lines: string[];
  lineWidths: number[];
  fontSize: number;
  lineHeightPx: number;
  /** Text block size (without background padding). */
  width: number;
  height: number;
  padding: number;
}

/**
 * Deterministic text layout: explicit newlines + greedy word wrap at `maxWidth` sequence pixels.
 * Must be used by both preview and export.
 */
export function layoutText(
  ctx: Ctx2D,
  text: string,
  style: TextStyle,
  maxWidth: number,
): TextLayout {
  ctx.font = cssFont(style.fontFamily, style.fontWeight, style.fontSize);
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line.trim() !== '' && ctx.measureText(candidate.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  const lineWidths = lines.map((l) => ctx.measureText(l).width);
  const lineHeightPx = style.fontSize * style.lineHeight;
  return {
    lines,
    lineWidths,
    fontSize: style.fontSize,
    lineHeightPx,
    width: Math.max(1, ...lineWidths),
    height: lines.length * lineHeightPx,
    padding: style.background ? style.fontSize * 0.3 : 0,
  };
}

export function textLayerBox(seq: Sequence, layout: TextLayout, t: Transform): LayerBox {
  return {
    cx: seq.width / 2 + t.x * seq.width,
    cy: seq.height / 2 + t.y * seq.height,
    width: (layout.width + layout.padding * 2) * t.scale,
    height: (layout.height + layout.padding * 2) * t.scale,
    rotation: (t.rotation * Math.PI) / 180,
  };
}

/** Max width before titles wrap, in sequence pixels. */
export function textWrapWidth(seq: Sequence): number {
  return seq.width * 0.9;
}

/** Point-in-rotated-box test (sequence pixels), used for preview hit testing. */
export function boxContains(box: LayerBox, px: number, py: number): boolean {
  const dx = px - box.cx;
  const dy = py - box.cy;
  const cos = Math.cos(-box.rotation);
  const sin = Math.sin(-box.rotation);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2;
}
