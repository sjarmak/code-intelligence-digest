/**
 * Per-user podcast audio list: link user to generated_podcast_audio for list/delete
 */

import { getDbClient } from "./driver";
import { LEGACY_USER_ID } from "./constants";
import type { PodcastAudioRecord } from "./podcast-audio";

export async function addUserPodcastAudio(
  userId: string,
  audioId: string
): Promise<void> {
  const uid = userId || LEGACY_USER_ID;
  const now = Math.floor(Date.now() / 1000);

  const client = await getDbClient();
  await client.run(
    `INSERT INTO user_podcast_audio (user_id, audio_id, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, audio_id) DO UPDATE SET created_at = EXCLUDED.created_at`,
    [uid, audioId, now]
  );
}

export interface UserPodcastAudioItem extends PodcastAudioRecord {
  createdAt: number;
}

export async function listUserPodcastAudio(
  userId: string = LEGACY_USER_ID,
  limit = 50
): Promise<UserPodcastAudioItem[]> {
  const uid = userId || LEGACY_USER_ID;

  const client = await getDbClient();
  const result = await client.query(
    `SELECT a.id, a.podcast_id, a.title, a.transcript_hash, a.provider, a.voice, a.format,
            a.duration, a.duration_seconds, a.audio_url, a.segment_audio, a.bytes, a.generated_at, a.created_at,
            u.created_at AS user_created_at
     FROM user_podcast_audio u
     JOIN "generated_podcast_audio" a ON a.id = u.audio_id
     WHERE u.user_id = $1
     ORDER BY u.created_at DESC
     LIMIT $2`,
    [uid, limit]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    podcastId: (r.podcast_id as string) || undefined,
    title: (r.title as string) || undefined,
    transcriptHash: r.transcript_hash as string,
    provider: r.provider as string,
    voice: (r.voice as string) || undefined,
    format: r.format as string,
    duration: (r.duration as string) || undefined,
    durationSeconds: (r.duration_seconds as number) ?? undefined,
    audioUrl: r.audio_url as string,
    segmentAudio: r.segment_audio
      ? (JSON.parse(r.segment_audio as string) as PodcastAudioRecord["segmentAudio"])
      : undefined,
    bytes: r.bytes as number,
    createdAt: (r.user_created_at as number) ?? (r.created_at as number),
  }));
}

export async function deleteUserPodcastAudio(
  userId: string,
  audioId: string
): Promise<boolean> {
  const uid = userId || LEGACY_USER_ID;

  const client = await getDbClient();
  const result = await client.run(`DELETE FROM user_podcast_audio WHERE user_id = $1 AND audio_id = $2`, [
    uid,
    audioId,
  ]);
  return result.changes > 0;
}
