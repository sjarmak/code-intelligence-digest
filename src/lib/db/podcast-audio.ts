/**
 * Database helpers for podcast audio storage and caching
 */

import { getDbClient } from "./driver";
import { SegmentAudioMetadata } from "../audio/types";

export interface PodcastAudioRecord {
  id: string;
  podcastId?: string;
  title?: string;
  transcriptHash: string;
  provider: string;
  voice?: string;
  format: string;
  duration?: string;
  durationSeconds?: number;
  audioUrl: string;
  segmentAudio?: SegmentAudioMetadata[];
  bytes: number;
  createdAt?: number;
}

interface PodcastAudioRow {
  id: string;
  podcast_id: string | null;
  title: string | null;
  transcript_hash: string;
  provider: string;
  voice: string | null;
  format: string;
  duration: string | null;
  duration_seconds: number | null;
  audio_url: string;
  segment_audio: string | null;
  bytes: number;
  created_at?: number;
}

/**
 * Save generated audio metadata to database
 * Uses ON CONFLICT to handle race conditions gracefully
 */
export async function savePodcastAudio(audio: PodcastAudioRecord): Promise<void> {
  const generatedAt = Math.floor(Date.now() / 1000);

  

    const client = await getDbClient();
    // Use ON CONFLICT to handle duplicate transcript_hash (race condition)
    // If conflict occurs, update the existing record with new audio URL/bytes
    // This handles cases where the same transcript is rendered multiple times concurrently
    try {
      await client.run(`
        INSERT INTO "generated_podcast_audio" (
          id, podcast_id, title, transcript_hash, provider, voice, format,
          duration, duration_seconds, audio_url, segment_audio, bytes, generated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (transcript_hash) DO UPDATE SET
          audio_url = EXCLUDED.audio_url,
          bytes = EXCLUDED.bytes,
          duration = EXCLUDED.duration,
          duration_seconds = EXCLUDED.duration_seconds,
          generated_at = EXCLUDED.generated_at,
          title = COALESCE(EXCLUDED.title, "generated_podcast_audio".title)
      `, [
      audio.id,
      audio.podcastId || null,
      audio.title ?? null,
      audio.transcriptHash,
      audio.provider,
      audio.voice || null,
      audio.format,
      audio.duration || null,
      audio.durationSeconds || null,
      audio.audioUrl,
      audio.segmentAudio ? JSON.stringify(audio.segmentAudio) : null,
      audio.bytes,
      generatedAt
    ]);
    } catch (error) {
      // Even with ON CONFLICT, if there's still an error, re-throw it
      // This might happen if the constraint name is different or other DB issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("duplicate key") || errorMessage.includes("UNIQUE constraint")) {
        // Re-throw with consistent error message for route handler
        throw new Error(`duplicate key value violates unique constraint "generated_podcast_audio_transcript_hash_key"`);
      }
      throw error;
    }
  

}

/**
 * Get audio by transcript hash (for caching)
 */
export async function getPodcastAudioByHash(
  transcriptHash: string
): Promise<PodcastAudioRecord | null> {

  const client = await getDbClient();
  const result = await client.query(`
      SELECT * FROM generated_podcast_audio
      WHERE transcript_hash = $1
      LIMIT 1
    `, [transcriptHash]);
  const row = result.rows[0] as unknown as PodcastAudioRow | undefined;


  if (!row) return null;

  return {
    id: row.id,
    podcastId: row.podcast_id || undefined,
    title: row.title || undefined,
    transcriptHash: row.transcript_hash,
    provider: row.provider,
    voice: row.voice || undefined,
    format: row.format,
    duration: row.duration || undefined,
    durationSeconds: row.duration_seconds || undefined,
    audioUrl: row.audio_url,
    segmentAudio: row.segment_audio ? (JSON.parse(row.segment_audio) as SegmentAudioMetadata[]) : undefined,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/**
 * Get audio by ID
 */
export async function getPodcastAudioById(id: string): Promise<PodcastAudioRecord | null> {

  const client = await getDbClient();
  const result = await client.query(`
      SELECT * FROM generated_podcast_audio
      WHERE id = $1
      LIMIT 1
    `, [id]);
  const row = result.rows[0] as unknown as PodcastAudioRow | undefined;


  if (!row) return null;

  return {
    id: row.id,
    podcastId: row.podcast_id || undefined,
    title: row.title || undefined,
    transcriptHash: row.transcript_hash,
    provider: row.provider,
    voice: row.voice || undefined,
    format: row.format,
    duration: row.duration || undefined,
    durationSeconds: row.duration_seconds || undefined,
    audioUrl: row.audio_url,
    segmentAudio: row.segment_audio ? (JSON.parse(row.segment_audio) as SegmentAudioMetadata[]) : undefined,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/**
 * Check if audio exists for hash
 */
export async function podcastAudioExists(transcriptHash: string): Promise<boolean> {

  

    const client = await getDbClient();
    const result = await client.query(`
      SELECT id FROM generated_podcast_audio
      WHERE transcript_hash = $1
      LIMIT 1
    `, [transcriptHash]);
    return result.rows.length > 0;
  

}

/**
 * List recent audio records
 */
export async function listRecentPodcastAudio(limit: number = 20): Promise<PodcastAudioRecord[]> {

  const client = await getDbClient();
  const result = await client.query(`
      SELECT * FROM generated_podcast_audio
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
  const rows = result.rows as unknown as PodcastAudioRow[];


  return rows.map((record) => ({
    id: record.id,
    podcastId: record.podcast_id || undefined,
    title: record.title || undefined,
    transcriptHash: record.transcript_hash,
    provider: record.provider,
    voice: record.voice || undefined,
    format: record.format,
    duration: record.duration || undefined,
    durationSeconds: record.duration_seconds || undefined,
    audioUrl: record.audio_url,
    segmentAudio: record.segment_audio ? (JSON.parse(record.segment_audio) as SegmentAudioMetadata[]) : undefined,
    bytes: record.bytes,
    createdAt: record.created_at,
  }));
}
