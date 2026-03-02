/**
 * Agent-specific scoring debug infrastructure.
 * Logs scored candidates to disk for manual inspection and tuning.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface ScoringDebugEntry {
  goal: string;
  docId: string;
  url: string;
  domain: string;
  title: string;
  type?: string; // e.g. "product_move", "landscape_research", "tutorial"
  componentScores: Record<string, number>;
  finalScore: number;
  fate: "executive" | "watch" | "idea_seed" | "dropped";
  gateReason?: string; // why it was dropped
  flags?: string[]; // additional context
}

export class AgentScoringDebugger {
  private entries: ScoringDebugEntry[] = [];
  private goal: string;
  private periodDays: number;

  constructor(goal: string, periodDays: number) {
    this.goal = goal;
    this.periodDays = periodDays;
  }

  log(entry: ScoringDebugEntry) {
    this.entries.push(entry);
  }

  flush() {
    if (this.entries.length === 0) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${this.goal}-${this.periodDays}d-${timestamp}.jsonl`;
    const dirPath = join(process.cwd(), ".data", "agent-debug");
    const filePath = join(dirPath, filename);

    try {
      mkdirSync(dirPath, { recursive: true });
      const lines = this.entries.map((e) => JSON.stringify(e)).join("\n");
      writeFileSync(filePath, lines + "\n");
      console.log(`[DEBUG] Wrote ${this.entries.length} entries to ${filename}`);
    } catch (err) {
      console.error(`Failed to write debug file: ${err}`);
    }
  }

  stats() {
    const byFate = this.entries.reduce(
      (acc, e) => {
        acc[e.fate] = (acc[e.fate] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const byType = this.entries.reduce(
      (acc, e) => {
        if (e.type) {
          acc[e.type] = (acc[e.type] ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const domainCount = this.entries.reduce(
      (acc, e) => {
        if (e.fate !== "dropped") {
          acc[e.domain] = (acc[e.domain] ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    return { byFate, byType, domainCount };
  }
}

export function getDomainFromUrl(url?: string): string {
  if (!url) return "unknown";
  try {
    const u = new URL(url);
    return u.hostname || "unknown";
  } catch {
    return "unknown";
  }
}
