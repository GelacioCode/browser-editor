import { cssFont } from '@viditor/composition';
import { DEFAULT_TITLE_STYLE } from '@viditor/project-core';
import { TITLE_PRESETS, addTitle } from '../state/actions.ts';

export function TextPanel() {
  return (
    <div className="p-3">
      <p className="mb-3 text-[11px] text-faint">
        Click a style to add it at the playhead. Edit text and style in the inspector.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TITLE_PRESETS.map((p) => {
          const s = { ...DEFAULT_TITLE_STYLE, ...p.style };
          return (
            <button
              key={p.id}
              onClick={() => addTitle(p)}
              className="flex aspect-video flex-col items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 px-2 hover:border-accent"
              title={`Add ${p.name}`}
            >
              <span
                className="max-w-full truncate rounded-sm px-1"
                style={{
                  font: cssFont(s.fontFamily, s.fontWeight, 20),
                  color: s.color,
                  background: s.background ?? undefined,
                  WebkitTextStroke: s.strokeWidth ? `1px ${s.strokeColor}` : undefined,
                }}
              >
                {p.text.split('\n')[0]}
              </span>
              <span className="mt-1 text-[10px] text-faint">{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
