/**
 * Local file storage adapter for audio files
 * Stores files in .data/audio and serves via /public/audio
 * For production, swap with S3/GCS/R2 adapter
 */

import fs from "fs";
import path from "path";
import { StorageAdapter } from "../audio/types";
import { logger } from "../logger";

const AUDIO_DIR = path.join(process.cwd(), ".data", "audio");
const API_PATH = "/api/audio"; // Serve via API route instead of static files

/**
 * Ensure audio directory exists
 */
function ensureAudioDir() {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    logger.info("Created audio directory", { path: AUDIO_DIR });
  }
}

/**
 * Local file storage adapter
 */
export class LocalStorageAdapter implements StorageAdapter {
  constructor() {
    ensureAudioDir();
  }

  async putObject(
    key: string,
    bytes: Buffer,
    contentType: string = "audio/mpeg"
  ): Promise<{ url: string; bytes: number }> {
    try {
      const filePath = path.join(AUDIO_DIR, key);

      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(filePath, bytes);

      logger.info("Audio stored", {
        key,
        bytes: bytes.length,
        path: filePath,
      });

      return {
        url: `${API_PATH}/${key}`,
        bytes: bytes.length,
      };
    } catch (error) {
      logger.error("Failed to store audio", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(AUDIO_DIR, key);
    return fs.existsSync(filePath);
  }

  getUrl(key: string): string {
    return `${API_PATH}/${key}`;
  }
}

/**
 * Get local storage adapter instance
 */
export function getLocalStorage(): LocalStorageAdapter {
  return new LocalStorageAdapter();
}
