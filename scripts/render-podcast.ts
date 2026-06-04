/**
 * Render a podcast script (markdown) to mp3 audio.
 *
 * Usage:
 *   npx tsx scripts/render-podcast.ts \
 *     --input out/podcast-script-2026-05-07.md \
 *     [--output out/podcast-2026-05-07.mp3] \
 *     [--provider openai|elevenlabs|nemo] \
 *     [--voice alloy] \
 *     [--format mp3|wav]
 *
 * Strips markdown frontmatter, headings, segment markers, and the citations
 * table to produce clean spoken prose, then calls renderAudio() directly
 * (no dev server, no auth, no DB caching).
 */
import * as dotenv from "dotenv";
import path from "node:path";

// Load .env.local from repo root before importing modules that read process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { argv, exit } from "node:process";
import { renderAudio } from "../src/lib/audio/render";
import type { AudioProvider } from "../src/lib/audio/types";

interface Args {
  input: string;
  output?: string;
  provider: AudioProvider;
  voice: string;
  format: "mp3" | "wav";
}

function parseArgs(args: string[]): Args {
  const out: Partial<Args> = { provider: "openai", voice: "alloy", format: "mp3" };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const val = args[i + 1];
    if (!key?.startsWith("--") || val === undefined) {
      throw new Error(`bad arg: ${key}`);
    }
    const name = key.slice(2);
    if (name === "input") out.input = val;
    else if (name === "output") out.output = val;
    else if (name === "provider") {
      if (!["openai", "elevenlabs", "nemo"].includes(val)) {
        throw new Error(`unknown provider: ${val}`);
      }
      out.provider = val as AudioProvider;
    } else if (name === "voice") out.voice = val;
    else if (name === "format") {
      if (!["mp3", "wav"].includes(val)) throw new Error(`unknown format: ${val}`);
      out.format = val as "mp3" | "wav";
    } else {
      throw new Error(`unknown flag: ${key}`);
    }
  }
  if (!out.input) throw new Error("--input required");
  return out as Args;
}

function stripMarkdownToProse(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let inCitations = false;
  let inFooter = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("## Citations")) {
      inCitations = true;
      continue;
    }
    if (line === "---" && inCitations) {
      inFooter = true;
      inCitations = false;
      continue;
    }
    if (inCitations || inFooter) continue;

    if (line === "" || line === "---") {
      if (result.length > 0 && result[result.length - 1] !== "") result.push("");
      continue;
    }

    // Skip frontmatter-style metadata
    if (/^\*\*(Episode date|Coverage window|Data through|Target runtime|Segments|Length|Audience):/i.test(line)) {
      continue;
    }

    // Skip headings
    if (line.startsWith("#")) continue;

    let cleaned = line
      .replace(/^\*\*([^*]+)\*\*:?\s*/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^>\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/\(≈[\d.]+\s*min\)/g, "")
      .replace(/\(~?\d+s\)/g, "")
      .trim();

    if (!cleaned) continue;
    result.push(cleaned);
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function defaultOutputPath(inputPath: string): string {
  // out/podcast-script-2026-05-07.md → out/podcast-2026-05-07.mp3
  const base = basename(inputPath).replace(/^podcast-script-/, "podcast-").replace(/\.md$/, ".mp3");
  return resolve(dirname(inputPath), base);
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output ?? defaultOutputPath(inputPath));

  const md = readFileSync(inputPath, "utf8");
  const prose = stripMarkdownToProse(md);
  const wordCount = prose.split(/\s+/).length;
  const estMinutes = (wordCount / 150).toFixed(1);

  console.error(`[render-podcast] input: ${inputPath}`);
  console.error(`[render-podcast] words: ${wordCount} (~${estMinutes} min spoken)`);
  console.error(`[render-podcast] provider=${args.provider} voice=${args.voice} format=${args.format}`);
  console.error(`[render-podcast] rendering...`);

  const startedAt = Date.now();
  const result = await renderAudio(prose, args.provider, args.voice, args.format);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, result.bytes);

  console.error(`[render-podcast] done in ${elapsedSec}s`);
  console.error(`[render-podcast] bytes: ${result.bytes.length}`);
  if (result.durationSeconds) {
    const m = Math.floor(result.durationSeconds / 60);
    const s = Math.floor(result.durationSeconds % 60);
    console.error(`[render-podcast] duration: ${m}:${s.toString().padStart(2, "0")}`);
  }
  console.log(outputPath);
}

main().catch((err) => {
  console.error(`[render-podcast] error: ${err instanceof Error ? err.message : String(err)}`);
  exit(1);
});
