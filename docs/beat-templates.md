# Beat-sync templates

Cut videos to the beat of a song without lining up every clip by hand. Mark the beats once, turn
them into a template of empty slots, then drop videos into the slots. Each video plays for exactly
its slot, so every cut lands on a beat.

Everything runs on your computer. The song is analysed in a background worker in the browser,
and nothing is uploaded.

## 1. Mark the beats

1. Import the song and put it on the timeline (an audio file, or a video whose sound you want to
   follow).
2. Select the song clip. In the Inspector, under **Beats**, choose what to mark:
   - **Beat**: the steady pulse of the song.
   - **Bass hits**: kicks and bass notes, including off-beat ones. Use this when you want cuts
     that follow the groove rather than the count.
3. Click **Detect beats**. Markers appear as cyan ticks on the clip, with faint guide lines across
   all tracks.

Fix or add markers by hand:

| Do this                                    | To                                   |
| ------------------------------------------ | ------------------------------------ |
| Play the song and press **B** on each beat | Tap your own markers (one undo step) |
| Drag a marker                              | Move it (snaps to the playhead)      |
| Click a marker, then press **Delete**      | Remove it                            |
| **Clear** in the Beats section             | Remove all markers from the clip     |

Markers belong to the music. If you move, trim or split the song, they stay on the same notes.
Clips you drag around also snap to markers.

## 2. Create the template

In the same Beats section, under **Beat template**, choose **Cut every 1 / 2 / 4 / 8** markers
and click **Create template**. A new **Template** track appears above your other video, filled
with numbered empty slots (#1, #2, …). Slot edges sit exactly on the markers. The stretch before
the first marker and after the last one become slots too.

## 3. Fill the slots

- **Drag a video** from the Media panel onto a slot. It fills exactly that slot. Drop another
  video on it to swap.
- Or select a slot and pick a video from **Fill with…** in the Inspector.
- Or click **Auto-fill slots** in the Media panel to fill every empty slot in order with your
  videos. If there are more slots than videos, the videos repeat, and each repeat continues from
  where the previous one stopped instead of showing the same opening seconds again.

The first video you place sets the frame size, so vertical phone footage gives a vertical
project. A video shorter than its slot is refused with a message saying how long it needs to be.

## 4. Choose which part of each video shows

Select a filled slot. The **Clip window** in the Inspector shows the whole source video with a
white box exactly as long as the slot. Drag the box (or click where you want it, or use the
arrow keys with the strip focused) to choose the moment that plays. The preview updates as you
drag. The slot's position and length never change, so the cut stays on the beat.

On the timeline, **Ctrl + drag** a clip does the same (a "slip" edit).

To take a video out again, click **Empty slot** in the Inspector.

## Export

Empty slots are transparent: they show whatever is on the tracks below (black if nothing). The
Export dialog warns if any slots are still empty.

## With the AI assistant

The assistant can do the same steps: `detect_beats` → `create_beat_template` → `fill_slots` →
`slip_clip`. For example: _"Detect the bass hits in the song, make a template every 2 hits, and
fill it with my clips."_ See [assistant.md](assistant.md).

## How detection works (briefly)

The song is decoded to mono at about 11 kHz. An onset curve is built from how quickly the energy
in 24 log-spaced frequency bands rises (bass mode uses only 20–150 Hz). The tempo comes from the
curve's autocorrelation. Beat mode then fits an evenly spaced grid onto the strongest onsets
(dynamic programming). Bass mode keeps the individual hits. Each marker is finally snapped to
the sharp energy rise in the waveform (about 1.5 ms resolution). On test material, markers land
within about 5 ms of the true beats. Real songs with soft or rubato intros may need a few markers
tapped or dragged by hand.
