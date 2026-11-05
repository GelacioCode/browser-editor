import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { secondsToUs, type MediaItem, type MediaKind } from '@viditor/project-core';

export type ProbeResult = Omit<MediaItem, 'id' | 'label' | 'relativePath'>;

export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

/** Read technical metadata. Never assumes a codec or frame rate: everything is probed. */
export async function probeFile(file: File): Promise<ProbeResult> {
  const base = { name: file.name, sizeBytes: file.size, lastModified: file.lastModified };

  if (isImage(file)) {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new UnsupportedMediaError(
        `${file.name}: this image format can't be decoded by the browser`,
      );
    }
    const r: ProbeResult = {
      ...base,
      kind: 'image',
      durationUs: 0,
      width: bmp.width,
      height: bmp.height,
      fps: null,
      hasVideo: true,
      hasAudio: false,
      sampleRate: null,
      channels: null,
      rotation: 0,
    };
    bmp.close();
    return r;
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) {
      throw new UnsupportedMediaError(`${file.name}: unsupported container format`);
    }
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const videoOk = video ? await video.canDecode() : false;
    const audioOk = audio ? await audio.canDecode() : false;

    if (video && !videoOk) {
      const codec = await video.getCodec();
      throw new UnsupportedMediaError(
        `${file.name}: video codec "${codec ?? 'unknown'}" can't be decoded by this browser`,
      );
    }
    if (!video && !audioOk) {
      throw new UnsupportedMediaError(`${file.name}: no decodable audio or video track`);
    }

    const durationS = await input.computeDuration();
    let kind: MediaKind = video ? 'video' : 'audio';
    let fps: number | null = null;
    let width = 0;
    let height = 0;
    let rotation: 0 | 90 | 180 | 270 = 0;
    if (video) {
      const stats = await video.computePacketStats(120);
      fps = Number.isFinite(stats.averagePacketRate)
        ? Math.round(stats.averagePacketRate * 1000) / 1000
        : null;
      width = await video.getDisplayWidth();
      height = await video.getDisplayHeight();
      rotation = (await video.getRotation()) as 0 | 90 | 180 | 270;
      // Single still frame inside a video container (rare): treat as video anyway.
      kind = 'video';
    }

    return {
      ...base,
      kind,
      durationUs: secondsToUs(durationS),
      width,
      height,
      fps,
      hasVideo: !!video,
      hasAudio: !!audio && audioOk,
      sampleRate: audio && audioOk ? await audio.getSampleRate() : null,
      channels: audio && audioOk ? await audio.getNumberOfChannels() : null,
      rotation,
    };
  } finally {
    input.dispose();
  }
}
