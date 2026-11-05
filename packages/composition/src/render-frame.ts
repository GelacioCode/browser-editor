import {
  visualLayersAt,
  type Project,
  type TextLikeClip,
  type VisualClip,
} from '@viditor/project-core';
import {
  croppedLocalRect,
  layoutText,
  mediaLayerBox,
  textLayerBox,
  textWrapWidth,
  type Ctx2D,
  type LayerBox,
} from './layout.ts';
import { cssFont } from './fonts.ts';

/** A decoded, display-oriented (rotation already applied) image for a clip at the current frame. */
export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export type SourceResolver = (clip: Exclude<VisualClip, TextLikeClip>) => FrameSource | null;

export interface RenderOptions {
  /** Output canvas size. The sequence is scaled uniformly to fit it. */
  outWidth: number;
  outHeight: number;
  /** Draw a visible placeholder for media that has no source (preview only). */
  drawMissing?: boolean;
}

/**
 * Composite one timeline frame. This is the single source of truth for what a frame looks like;
 * the preview and the exporter both call it.
 */
export function renderFrame(
  ctx: Ctx2D,
  project: Project,
  frame: number,
  resolve: SourceResolver,
  opts: RenderOptions,
): void {
  const seq = project.sequence;
  const k = Math.min(opts.outWidth / seq.width, opts.outHeight / seq.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, opts.outWidth, opts.outHeight);
  // Centre the sequence in the output (letterbox if aspect ratios differ).
  ctx.translate((opts.outWidth - seq.width * k) / 2, (opts.outHeight - seq.height * k) / 2);
  ctx.scale(k, k);
  ctx.fillStyle = seq.background;
  ctx.fillRect(0, 0, seq.width, seq.height);
  ctx.beginPath();
  ctx.rect(0, 0, seq.width, seq.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const clip of visualLayersAt(project, frame)) {
    if (clip.kind === 'text' || clip.kind === 'caption') {
      drawText(ctx, project, clip);
    } else {
      const src = resolve(clip);
      if (src) drawMedia(ctx, project, clip, src);
      else if (opts.drawMissing) drawMissing(ctx, project, clip);
    }
  }
  ctx.restore();
}

function withLayer(ctx: Ctx2D, box: LayerBox, opacity: number, draw: () => void) {
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(box.rotation);
  ctx.globalAlpha = opacity;
  draw();
  ctx.restore();
}

function drawMedia(
  ctx: Ctx2D,
  project: Project,
  clip: Exclude<VisualClip, TextLikeClip>,
  src: FrameSource,
) {
  const t = clip.transform;
  if (t.opacity <= 0) return;
  const box = mediaLayerBox(project.sequence, src.width, src.height, t);
  const r = croppedLocalRect(box, t);
  const { left, right, top, bottom } = t.crop;
  const sx = left * src.width;
  const sy = top * src.height;
  const sw = src.width * (1 - left - right);
  const sh = src.height * (1 - top - bottom);
  if (sw <= 0 || sh <= 0) return;
  withLayer(ctx, box, t.opacity, () =>
    ctx.drawImage(src.image, sx, sy, sw, sh, r.x, r.y, r.w, r.h),
  );
}

function drawMissing(ctx: Ctx2D, project: Project, clip: Exclude<VisualClip, TextLikeClip>) {
  const seq = project.sequence;
  const box = mediaLayerBox(seq, seq.width, seq.height, clip.transform);
  withLayer(ctx, box, 1, () => {
    ctx.fillStyle = '#2a1a1a';
    ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
    ctx.fillStyle = '#ff8a80';
    ctx.font = cssFont('Inter', 700, Math.max(24, seq.height / 20));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Media offline — relink in the Media panel', 0, 0);
  });
}

export function measureTextClip(ctx: Ctx2D, project: Project, clip: TextLikeClip) {
  const layout = layoutText(ctx, clip.text, clip.style, textWrapWidth(project.sequence));
  return { layout, box: textLayerBox(project.sequence, layout, clip.transform) };
}

function drawText(ctx: Ctx2D, project: Project, clip: TextLikeClip) {
  if (!clip.text.trim() || clip.transform.opacity <= 0) return;
  const { style, transform: t } = clip;
  const { layout, box } = measureTextClip(ctx, project, clip);
  withLayer(ctx, box, t.opacity, () => {
    ctx.scale(t.scale, t.scale);
    const w = layout.width + layout.padding * 2;
    const h = layout.height + layout.padding * 2;
    if (style.background) {
      ctx.fillStyle = style.background;
      roundRect(ctx, -w / 2, -h / 2, w, h, layout.fontSize * 0.18);
      ctx.fill();
    }
    ctx.font = cssFont(style.fontFamily, style.fontWeight, style.fontSize);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const top = -layout.height / 2;
    layout.lines.forEach((line, i) => {
      const lw = layout.lineWidths[i]!;
      const x =
        style.align === 'left'
          ? -layout.width / 2
          : style.align === 'right'
            ? layout.width / 2 - lw
            : -lw / 2;
      const y = top + layout.lineHeightPx * (i + 0.5);
      if (style.strokeColor && style.strokeWidth > 0) {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = style.strokeWidth * 2;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = style.color;
      ctx.fillText(line, x, y);
    });
  });
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
