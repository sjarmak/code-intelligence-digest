/**
 * Audio rendering types for podcast generation
 */

export type AudioProvider = "openai" | "elevenlabs" | "nemo";
export type AudioFormat = "mp3" | "wav";
export type SegmentsMode = "single" | "per-segment";

export interface RenderAudioRequest {
  transcript: string;
  provider: AudioProvider;
  format: AudioFormat;
  voice?: string;
  sampleRate?: number;
}

export interface RenderAudioResult {
  bytes: Buffer;
  durationSeconds?: number;
}

export interface SegmentAudioMetadata {
  segmentIndex: number;
  title: string;
  startTime: string;
  endTime: string;
  audioUrl: string;
  durationSeconds?: number;
}

export interface RenderAudioEndpointRequest {
  // One of podcastId or transcript must be provided
  podcastId?: string;
  transcript?: string;

  provider: AudioProvider;
  format?: AudioFormat;
  voice?: string;
  sampleRate?: number;
  segmentsMode?: SegmentsMode;
  music?: {
    intro?: boolean;
    outro?: boolean;
  };
}

export interface RenderAudioEndpointResponse {
  id: string;
  podcastId?: string;
  generatedAt: string;
  provider: AudioProvider;
  format: AudioFormat;
  voice: string;
  duration: string;
  audioUrl: string;
  segmentAudio?: SegmentAudioMetadata[];
  generationMetadata: {
    providerLatency: string;
    bytes: number;
    transcriptHash: string;
    cached: boolean;
    multiVoice?: boolean;
  };
}

export interface TtsProvider {
  /**
   * Render transcript to audio
   */
  render(req: RenderAudioRequest): Promise<RenderAudioResult>;

  /**
   * Get provider name for logging/monitoring
   */
  getName(): string;
}

export interface StorageAdapter {
  /**
   * Store audio bytes and return public/signed URL
   */
  putObject(
    key: string,
    bytes: Buffer,
    contentType?: string
  ): Promise<{ url: string; bytes: number }>;

  /**
   * Check if object exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get object URL (may be signed)
   */
  getUrl(key: string): string;
}
