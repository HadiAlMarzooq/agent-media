export type MediaKind = 'video' | 'audio' | 'image' | 'unknown';

export interface VideoStreamMetadata {
  width: number;
  height: number;
  aspectRatio: string;
  fps?: number;
  codec?: string;
  rotationDegrees?: number;
}

export interface AudioStreamMetadata {
  present: boolean;
  codec?: string;
  sampleRate?: number;
  channels?: number;
}

/** A normalized, backend-independent description of a media source. */
export interface MediaMetadata {
  path: string;
  kind: MediaKind;
  durationSeconds?: number;
  container?: string;
  sizeBytes: number;
  video?: VideoStreamMetadata;
  audio: AudioStreamMetadata;
}

export interface FfmpegCapabilities {
  ffmpegVersion: string;
  encoders: { h264: boolean; hevc: boolean; av1: boolean; aac: boolean };
  hardwareAcceleration: string[];
  filters: { scale: boolean; crop: boolean; concat: boolean; subtitles: boolean };
}
