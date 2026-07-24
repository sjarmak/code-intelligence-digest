/**
 * Local file storage adapter for audio files
 * Stores files in .data/audio and serves via /public/audio
 * For production, swap with S3/GCS/R2 adapter
 */

import fs from "fs";
import path from "path";
import { StorageAdapter, StoredObject } from "../audio/types";
import { logger } from "../logger";

const DEFAULT_AUDIO_DIR = path.join(process.cwd(), ".data", "audio");
const API_PATH = "/api/audio"; // Serve via API route instead of static files

/**
 * Map a stored audio URL back to its storage key.
 *
 * Returns null for URLs this adapter did not produce (remote CDN links, for
 * instance) — those reference no local object. Accepts absolute URLs as well
 * as the relative form we write, since a caller may have qualified the host.
 */
export function audioUrlToKey(url: string): string | null {
  if (!url) return null;

  // putObject writes the key into the URL verbatim, so the relative form round
  // trips as-is. Only the absolute form needs decoding, because the URL parser
  // percent-encodes the pathname on the way in. Decoding the relative form
  // instead would both break keys containing a literal '%' and hand traversal
  // sequences to resolveKey pre-decoded.
  let key: string;
  const prefix = `${API_PATH}/`;

  if (/^https?:\/\//i.test(url)) {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return null;
    }
    if (!pathname.startsWith(prefix)) return null;
    try {
      key = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return null; // malformed percent-encoding
    }
  } else {
    if (!url.startsWith(prefix)) return null;
    key = url.slice(prefix.length);
  }

  return key.length > 0 ? key : null;
}

/**
 * Local file storage adapter
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly audioDir: string;

  constructor(audioDir: string = DEFAULT_AUDIO_DIR) {
    this.audioDir = audioDir;
    this.ensureAudioDir();
  }

  private ensureAudioDir() {
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
      logger.info("Created audio directory", { path: this.audioDir });
    }
  }

  /**
   * Resolve a key to an absolute path, rejecting keys that escape the audio
   * directory. Keys reach delete paths from stored URLs, so this is a trust
   * boundary even though we wrote them.
   */
  private resolveKey(key: string): string {
    const filePath = path.resolve(this.audioDir, key);
    if (filePath !== this.audioDir && !filePath.startsWith(this.audioDir + path.sep)) {
      throw new Error(`Storage key resolves outside the audio directory: ${key}`);
    }
    return filePath;
  }

  async putObject(
    key: string,
    bytes: Buffer,
    _contentType: string = "audio/mpeg"
  ): Promise<{ url: string; bytes: number }> {
    try {
      const filePath = this.resolveKey(key);

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

  async getObject(key: string): Promise<Buffer> {
    const filePath = this.resolveKey(key);
    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      logger.error("Failed to read audio object", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolveKey(key));
  }

  getUrl(key: string): string {
    return `${API_PATH}/${key}`;
  }

  async listObjects(): Promise<StoredObject[]> {
    if (!fs.existsSync(this.audioDir)) return [];

    const objects: StoredObject[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const stat = fs.statSync(full);
        objects.push({
          key: path.relative(this.audioDir, full).split(path.sep).join("/"),
          bytes: stat.size,
          modifiedAtMs: stat.mtimeMs,
        });
      }
    };
    walk(this.audioDir);

    return objects;
  }

  async deleteObject(key: string): Promise<boolean> {
    const filePath = this.resolveKey(key);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }
}

/**
 * Get local storage adapter instance
 */
export function getLocalStorage(): LocalStorageAdapter {
  return new LocalStorageAdapter();
}
