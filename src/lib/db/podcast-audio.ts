/**
 * Database helpers for podcast audio storage and caching
 */

import { getSqlite } from "./index";
import { getDbClient, detectDriver } from "./driver";
import { SegmentAudioMetadata } from "../audio/types";

export interface PodcastAudioRecord {
  id: string;
  podcastId?: string;
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

/**
 * Save generated audio metadata to database
 */
export async function savePodcastAudio(audio: PodcastAudioRecord): Promise<void> {
  const driver = detectDriver();
  const generatedAt = Math.floor(Date.now() / 1000);

  if (driver === 'postgres') {
    const client = await getDbClient();
    await client.run(`
      INSERT INTO generated_podcast_audio (
        id, podcast_id, transcript_hash, provider, voice, format,
        duration, duration_seconds, audio_url, segment_audio, bytes, generated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      audio.id,
      audio.podcastId || null,
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
  } else {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      INSERT INTO generated_podcast_audio (
        id, podcast_id, transcript_hash, provider, voice, format,
        duration, duration_seconds, audio_url, segment_audio, bytes, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      audio.id,
      audio.podcastId || null,
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
    );
  }
}

/**
 * Get audio by transcript hash (for caching)
 */
export async function getPodcastAudioByHash(
  transcriptHash: string
): Promise<PodcastAudioRecord | null> {
  const driver = detectDriver();

  let row: any;

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(`
      SELECT * FROM generated_podcast_audio
      WHERE transcript_hash = $1
      LIMIT 1
    `, [transcriptHash]);
    row = result.rows[0];
  } else {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      SELECT * FROM generated_podcast_audio
      WHERE transcript_hash = ?
      LIMIT 1
    `);
    row = stmt.get(transcriptHash) as any;
  }

  if (!row) return null;

  return {
    id: row.id,
    podcastId: row.podcast_id || undefined,
    transcriptHash: row.transcript_hash,
    provider: row.provider,
    voice: row.voice || undefined,
    format: row.format,
    duration: row.duration || undefined,
    durationSeconds: row.duration_seconds || undefined,
    audioUrl: row.audio_url,
    segmentAudio: row.segment_audio ? JSON.parse(row.segment_audio) : undefined,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/**
 * Get audio by ID
 */
export async function getPodcastAudioById(id: string): Promise<PodcastAudioRecord | null> {
  const driver = detectDriver();

  let row: any;

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(`
      SELECT * FROM generated_podcast_audio
      WHERE id = $1
      LIMIT 1
    `, [id]);
    row = result.rows[0];
  } else {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      SELECT * FROM generated_podcast_audio
      WHERE id = ?
      LIMIT 1
    `);
    row = stmt.get(id) as any;
  }

  if (!row) return null;

  return {
    id: row.id,
    podcastId: row.podcast_id || undefined,
    transcriptHash: row.transcript_hash,
    provider: row.provider,
    voice: row.voice || undefined,
    format: row.format,
    duration: row.duration || undefined,
    durationSeconds: row.duration_seconds || undefined,
    audioUrl: row.audio_url,
    segmentAudio: row.segment_audio ? JSON.parse(row.segment_audio) : undefined,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/**
 * Check if audio exists for hash
 */
export async function podcastAudioExists(transcriptHash: string): Promise<boolean> {
  const driver = detectDriver();

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(`
      SELECT id FROM generated_podcast_audio
      WHERE transcript_hash = $1
      LIMIT 1
    `, [transcriptHash]);
    return result.rows.length > 0;
  } else {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      SELECT id FROM generated_podcast_audio
      WHERE transcript_hash = ?
      LIMIT 1
    `);
    const row = stmt.get(transcriptHash);
    return !!row;
  }
}

/**
 * List recent audio records
 */
export async function listRecentPodcastAudio(limit: number = 20): Promise<PodcastAudioRecord[]> {
  const driver = detectDriver();

  let rows: any[];

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(`
      SELECT * FROM generated_podcast_audio
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    rows = result.rows;
  } else {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      SELECT * FROM generated_podcast_audio
      ORDER BY created_at DESC
      LIMIT ?
    `);
    rows = stmt.all(limit) as any[];
  }

  return rows.map((record) => ({
    id: record.id,
    podcastId: record.podcast_id || undefined,
    transcriptHash: record.transcript_hash,
    provider: record.provider,
    voice: record.voice || undefined,
    format: record.format,
    duration: record.duration || undefined,
    durationSeconds: record.duration_seconds || undefined,
    audioUrl: record.audio_url,
    segmentAudio: record.segment_audio ? JSON.parse(record.segment_audio) : undefined,
    bytes: record.bytes,
    createdAt: record.created_at,
  }));
}
