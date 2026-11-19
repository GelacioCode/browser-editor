import { Dialog } from '../ui/ui.tsx';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['S', 'Split at playhead (selected clips, or all clips under the playhead)'],
  ['Delete / Backspace', 'Delete selected clips'],
  ['Ctrl + D', 'Duplicate selected clips'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z / Ctrl + Y', 'Redo'],
  ['Ctrl + S', 'Save now (autosave is always on)'],
  ['Ctrl + E', 'Export'],
  ['Ctrl + A', 'Select all clips'],
  ['Esc', 'Clear selection'],
  ['← / →', 'Previous / next frame (Shift: 1 second)'],
  ['↑ / ↓', 'Previous / next edit point'],
  ['Home / End', 'Go to start / end'],
  ['+ / −', 'Zoom timeline in / out (or Ctrl + scroll)'],
  ['N', 'Toggle snapping'],
  ['Shift + click', 'Add / remove clip from selection'],
  ['Alt + drag', 'Move clip without snapping'],
  ['Ctrl + drag', 'Slip: change which part of a video plays, keeping the clip in place'],
  ['B', 'Tap a beat marker at the playhead (on the selected music clip)'],
  ['Delete (marker selected)', 'Remove the selected beat marker'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <table className="w-full text-xs">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-4 align-top">
                <kbd className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text">
                  {k}
                </kbd>
              </td>
              <td className="py-1.5 text-muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
