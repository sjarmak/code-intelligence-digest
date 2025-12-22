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
  /\[NEEDS SUPPORT\]/gi,
  // Segment structure markers
  /cold open:?\s*/gi,
  /lightning round:?\s*/gi,
  /quick hits:?\s*/gi,
  /intro segment:?\s*/gi,
  /outro:?\s*/gi,
  /main segment:?\s*/gi,
];

/**
 * Patterns to strip from transcript before TTS
 */
const MARKUP_PATTERNS = [
  /^##\s*.+$/gm, // Markdown headers like "## Segment Name"
  /^\*\*[A-Z]+:\*\*/gm, // Speaker labels like "**HOST:**"
  /\*\*([^*]+)\*\*/g, // Bold text - keep content
  /\[[\d:]+\]\s*/g, // Timestamps like "[00:00]" or "[01:30]"
  /\(\d+s\)/g, // Duration markers like "(10s)"
  /\(≈\d+s\)/g, // Approximate duration like "(≈125s)"
  /^---+$/gm, // Segment separators
  /\n{3,}/g, // Multiple newlines
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
    keepSpeakerLabels = false, // Default to false - TTS doesn't need "HOST:" labels
    stripAllMarkup = true, // Default to true - strip all formatting for clean TTS
  } = options;

  let result = transcript;

  // Strip all audio cues
  if (stripCues) {
    for (const pattern of CUE_PATTERNS) {
      result = result.replace(pattern, "");
    }
  }

  // Strip markdown and formatting
  if (stripAllMarkup) {
    // Remove markdown headers (## Segment Name)
    result = result.replace(/^##\s*.+$/gm, "");

    // Remove speaker labels like "**HOST:**" or "**COHOST:**"
    result = result.replace(/\*\*[A-Z]+:\*\*\s*/g, "");

    // Remove bold markers but keep content
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");

    // Remove timestamps like "[00:00]" "[01:30]" "[09:50]"
    result = result.replace(/\[[\d:]+\]\s*/g, "");

    // Remove duration markers like "(10s)" or "(≈125s)"
    result = result.replace(/\(≈?\d+s\)/g, "");

    // Remove segment separators
    result = result.replace(/^---+$/gm, "");

    // Remove segment name lines like "Segment 1 — Topic Name"
    result = result.replace(/^Segment \d+\s*[—–-]\s*.+$/gm, "");
  }

  // Optionally keep speaker labels for reference (but TTS will read them)
  if (!keepSpeakerLabels) {
    // Remove any remaining speaker patterns
    result = result.replace(/^[A-Z]+:\s*/gm, "");
  }

  // Clean up whitespace
  result = result.replace(/\n{3,}/g, "\n\n"); // Max 2 newlines
  result = result.replace(/^\s+$/gm, ""); // Empty lines with spaces
  result = result.replace(/\n\s*\n\s*\n/g, "\n\n"); // Normalize paragraph breaks
  result = result.replace(/\s{2,}/g, " "); // Multiple spaces to single

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

/**
 * Speaker turn for multi-voice rendering
 */
export interface SpeakerTurn {
  speaker: "HOST" | "COHOST";
  text: string;
}

/**
 * Parse transcript into speaker turns for multi-voice rendering
 * Handles formats like:
 * - **HOST:** text
 * - **COHOST:** text
 * - HOST: text
 * - COHOST: text
 */
export function parseTranscriptBySpeaker(transcript: string): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];

  // First, sanitize non-spoken elements but KEEP speaker labels
  let sanitized = transcript;

  // Strip audio cues
  for (const pattern of CUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  // Strip markdown headers
  sanitized = sanitized.replace(/^##\s*.+$/gm, "");

  // Strip timestamps
  sanitized = sanitized.replace(/\[[\d:]+\]\s*/g, "");

  // Strip duration markers
  sanitized = sanitized.replace(/\(≈?\d+s\)/g, "");

  // Strip segment separators
  sanitized = sanitized.replace(/^---+$/gm, "");

  // Strip segment name lines
  sanitized = sanitized.replace(/^Segment \d+\s*[—–-]\s*.+$/gm, "");

  // Now split by speaker labels
  // Pattern matches both **HOST:** and HOST: formats
  const speakerPattern = /\*?\*?(HOST|COHOST):?\*?\*?\s*/gi;

  const parts = sanitized.split(speakerPattern);

  let currentSpeaker: "HOST" | "COHOST" = "HOST";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    // Check if this part is a speaker label
    const upperPart = part.toUpperCase();
    if (upperPart === "HOST" || upperPart === "COHOST") {
      currentSpeaker = upperPart as "HOST" | "COHOST";
      continue;
    }

    // This is actual spoken text
    // Clean up any remaining bold markers
    const cleanText = part
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+$/gm, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (cleanText.length > 0) {
      // If same speaker as last turn, merge
      if (turns.length > 0 && turns[turns.length - 1].speaker === currentSpeaker) {
        turns[turns.length - 1].text += " " + cleanText;
      } else {
        turns.push({
          speaker: currentSpeaker,
          text: cleanText,
        });
      }
    }
  }

  // If no speaker labels found, treat entire transcript as HOST
  if (turns.length === 0 && sanitized.trim().length > 0) {
    turns.push({
      speaker: "HOST",
      text: sanitizeTranscriptForTts(transcript),
    });
  }

  return turns;
}

/**
 * Check if transcript has multiple speakers
 */
export function hasMultipleSpeakers(transcript: string): boolean {
  const hasHost = /\*?\*?HOST:?\*?\*?/i.test(transcript);
  const hasCohost = /\*?\*?COHOST:?\*?\*?/i.test(transcript);
  return hasHost && hasCohost;
}
