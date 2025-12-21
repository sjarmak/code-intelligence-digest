/**
 * Transcript sanitization for TTS
 * Removes non-spoken cues and optionally normalizes speaker labels
 */

interface SanitizeOptions {
  stripCues?: boolean;
  keepSpeakerLabels?: boolean;
  stripAllMarkup?: boolean;
}

/**
 * Common TTS cues to strip/convert
 */
const CUE_PATTERNS = [
  /\[INTRO MUSIC\]/gi,
  /\[OUTRO MUSIC\]/gi,
  /\[BACKGROUND MUSIC\]/gi,
  /\[MUSIC\]/gi,
  /\[PAUSE\]/gi,
  /\[SOUND EFFECT\]/gi,
  /\[SFX[^\]]*\]/gi,
  /\[APPLAUSE\]/gi,
  /\[LAUGHTER\]/gi,
  /\[silence[^\]]*\]/gi,
  /\[\s*[A-Z\s]*\s*MUSIC\s*\]/gi,
];

/**
 * Sanitize transcript for TTS rendering
 * Removes cues like [INTRO MUSIC], [PAUSE], etc.
 * Optionally normalizes speaker labels
 */
export function sanitizeTranscriptForTts(
  transcript: string,
  options: SanitizeOptions = {}
): string {
  const {
    stripCues = true,
    keepSpeakerLabels = true,
    stripAllMarkup = false,
  } = options;

  let result = transcript;

  // Strip all cues
  if (stripCues) {
    for (const pattern of CUE_PATTERNS) {
      result = result.replace(pattern, "");
    }
  }

  // Remove extra whitespace created by cue removal
  result = result.replace(/\n\s*\n/g, "\n");
  result = result.replace(/\s{2,}/g, " ");

  // Optionally strip all markup (e.g., timestamps, speaker markers)
  if (stripAllMarkup) {
    // Remove [anything in brackets]
    result = result.replace(/\[.*?\]/g, "");
    // Remove (anything in parens) except inline parentheticals that look natural
    result = result.replace(/\([A-Z]{2,}[^\)]*\)/g, "");
  }

  // Normalize speaker labels if kept
  if (keepSpeakerLabels) {
    // Ensure consistent format: "Speaker:" on its own line
    result = result.replace(/^\s*([A-Za-z\s]+):\s*/gm, "$1: ");
  }

  // Final cleanup
  result = result.trim();

  return result;
}

/**
 * Compute stable hash of sanitized transcript for caching
 * Used to detect duplicate renders
 */
export function computeTranscriptHash(
  transcript: string,
  sanitized: string,
  provider: string,
  voice?: string,
  format?: string
): string {
  // Use Node.js crypto for stable hash
  const crypto = require("crypto");
  const hashInput = [sanitized, provider, voice || "", format || "mp3"].join("|");
  return "sha256:" + crypto.createHash("sha256").update(hashInput).digest("hex");
}

/**
 * Extract text content only (for word count, duration estimation)
 */
export function stripAllFormatting(text: string): string {
  // Remove all formatting marks
  return text
    .replace(/\*\*[^*]+\*\*/g, "") // Bold
    .replace(/\*[^*]+\*/g, "") // Italic
    .replace(/[_`~\[\]()]/g, "") // Various markup
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Estimate duration from transcript (150 words per minute)
 */
export function estimateDurationFromTranscript(transcript: string): number {
  const words = transcript.split(/\s+/).length;
  const minutes = words / 150;
  return Math.ceil(minutes * 60); // Return in seconds
}

/**
 * Format seconds to MM:SS
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
