/**
 * Tests for transcript sanitization
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeTranscriptForTts,
  estimateDurationFromTranscript,
  formatDuration,
  computeTranscriptHash,
} from "../../src/lib/audio/sanitize";

describe("Audio Sanitization", () => {
  it("strips cues from transcript", () => {
    const input = "[INTRO MUSIC]\nHost: Hello everyone.\n[PAUSE]\nGuest: Hi there.\n[OUTRO MUSIC]";
    const output = sanitizeTranscriptForTts(input);

    expect(output).not.toContain("[INTRO MUSIC]");
    expect(output).not.toContain("[PAUSE]");
    expect(output).not.toContain("[OUTRO MUSIC]");
    expect(output).toContain("Host: Hello everyone");
    expect(output).toContain("Guest: Hi there");
  });

  it("handles speaker labels", () => {
    const input = "Host: This is a test\nGuest: Great!";
    const output = sanitizeTranscriptForTts(input, { keepSpeakerLabels: true });

    expect(output).toContain("Host:");
    expect(output).toContain("Guest:");
  });

  it("estimates duration correctly", () => {
    // 150 words per minute, so 100 words = 40 seconds
    const words = new Array(100).fill("word").join(" ");
    const seconds = estimateDurationFromTranscript(words);

    expect(seconds).toBe(40);
  });

  it("formats duration correctly", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("computes stable hash", () => {
    const transcript = "This is a test";
    const sanitized = "This is a test";
    const hash1 = computeTranscriptHash(transcript, sanitized, "openai", "alloy", "mp3");
    const hash2 = computeTranscriptHash(transcript, sanitized, "openai", "alloy", "mp3");

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:/);
  });

  it("creates different hashes for different providers", () => {
    const transcript = "Test content";
    const sanitized = "Test content";
    const hash1 = computeTranscriptHash(transcript, sanitized, "openai", "alloy", "mp3");
    const hash2 = computeTranscriptHash(transcript, sanitized, "elevenlabs", "alloy", "mp3");

    expect(hash1).not.toBe(hash2);
  });

  it("removes extra whitespace", () => {
    const input = "Text  with   multiple     spaces\nand  \n\n  newlines";
    const output = sanitizeTranscriptForTts(input);

    expect(output).not.toContain("  ");
    expect(output).not.toContain("\n\n");
  });
});
