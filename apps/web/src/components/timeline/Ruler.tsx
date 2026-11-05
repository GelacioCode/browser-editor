import { useEffect, useRef } from 'react';
import { fpsToNumber, type Rational } from '@viditor/project-core';
import { RULER_H, formatRulerLabel, tickInterval, type Viewport } from './geometry.ts';

/** Canvas ruler; only the visible span is drawn. */
export function Ruler({
  viewport,
  pxPerSecond,
  fps,
  onScrub,
}: {
  viewport: Viewport;
  pxPerSecond: number;
  fps: Rational;
  onScrub: (contentX: number, phase: 'start' | 'move') => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, viewport.width);

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(RULER_H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, RULER_H);
    const styles = getComputedStyle(document.documentElement);
    const faint = styles.getPropertyValue('--vd-text-faint').trim() || '#666';
    const muted = styles.getPropertyValue('--vd-text-muted').trim() || '#999';
    const rate = fpsToNumber(fps);
    const { major, minor } = tickInterval(pxPerSecond, rate);
    const t0 = viewport.scrollLeft / pxPerSecond;
    const t1 = (viewport.scrollLeft + width) / pxPerSecond;
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'top';
    const firstMinor = Math.floor(t0 / minor) * minor;
    for (let t = firstMinor; t <= t1 + minor; t += minor) {
      const x = Math.round(t * pxPerSecond - viewport.scrollLeft) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.strokeStyle = isMajor ? muted : faint;
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? RULER_H - 10 : RULER_H - 5);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = muted;
        ctx.fillText(formatRulerLabel(t + 1e-9, major, rate), x + 3, 4);
      }
    }
  }, [viewport.scrollLeft, width, pxPerSecond, fps]);

  return (
    <canvas
      ref={ref}
      aria-label="Timeline ruler — click or drag to move the playhead"
      className="absolute top-0 cursor-col-resize"
      style={{ left: viewport.scrollLeft, width, height: RULER_H }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onScrub(viewport.scrollLeft + e.nativeEvent.offsetX, 'start');
      }}
      onPointerMove={(e) => {
        if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
          const r = (e.target as HTMLElement).getBoundingClientRect();
          onScrub(viewport.scrollLeft + (e.clientX - r.left), 'move');
        }
      }}
    />
  );
}
