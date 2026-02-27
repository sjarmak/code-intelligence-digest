import fs from "fs";
import path from "path";
import { z } from "zod";

export interface PlaybookState {
  playbook_version: string;
  primary_beachhead: string;
  adjacent_segments: string[];
  persona_priority: string[];
  messaging_guardrails: string[];
  channel_priority: string[];
  campaign_themes: string[];
  competitive_rules: Record<string, string>;
  key_risks_to_monitor: string[];
  segment_priority?: string[];
  content_themes_by_quarter?: Record<string, string[]>;
  proof_points?: string[];
  metrics_to_watch?: string[];
  open_unknowns?: string[];
  confidence_flags?: Record<string, "high" | "medium" | "low">;
  updated_at?: string;
  updated_by?: string;
}

export const PlaybookStateSchema = z.object({
  playbook_version: z.string().min(1),
  primary_beachhead: z.string().min(1),
  adjacent_segments: z.array(z.string().min(1)).min(1),
  persona_priority: z.array(z.string().min(1)).min(1),
  messaging_guardrails: z.array(z.string().min(1)).min(1),
  channel_priority: z.array(z.string().min(1)).min(1),
  campaign_themes: z.array(z.string().min(1)).min(1),
  competitive_rules: z.record(z.string(), z.string()),
  key_risks_to_monitor: z.array(z.string().min(1)).min(1),
  segment_priority: z.array(z.string().min(1)).optional(),
  content_themes_by_quarter: z.record(z.string(), z.array(z.string().min(1))).optional(),
  proof_points: z.array(z.string().min(1)).optional(),
  metrics_to_watch: z.array(z.string().min(1)).optional(),
  open_unknowns: z.array(z.string().min(1)).optional(),
  confidence_flags: z.record(z.string(), z.enum(["high", "medium", "low"])).optional(),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
});

export type PlaybookStateInput = z.infer<typeof PlaybookStateSchema>;

export const DEFAULT_PLAYBOOK_STATE: PlaybookState = {
  playbook_version: "2026-02-15",
  primary_beachhead: "Capital Markets",
  adjacent_segments: ["Banks", "Diversified Financial Services", "Insurance"],
  persona_priority: [
    "Head of Developer Platform",
    "VP Engineering",
    "Staff/Principal Engineer",
    "Security/Compliance",
  ],
  messaging_guardrails: [
    "Never compete on AI assistant capabilities",
    "Never position against Cursor or Copilot; position as complementary via MCP",
    "Never say replace GitHub; say augment GitHub with cross-repo intelligence",
    "For FinServ lead with code search, Batch Changes, compliance, BYOK/self-hosted, cross-repo scale",
  ],
  channel_priority: ["Events", "Whitepapers", "Organic Search", "Direct"],
  campaign_themes: [
    "code intelligence for trading systems",
    "cross-repository vulnerability remediation",
    "MCP as context layer for existing AI tools",
    "onboarding for complex proprietary codebases",
  ],
  competitive_rules: {
    github_native_search: "compete directly",
    homegrown_search: "compete directly",
    cursor: "complementary, not direct competition",
    copilot: "complementary, not direct competition",
  },
  key_risks_to_monitor: [
    "competitors closing cross-repo context gap",
    "MCP auth/setup friction",
    "category collapsing into AI assistant framing",
  ],
};

const PLAYBOOK_STATE_PATH = path.resolve(process.cwd(), ".data", "playbook_state.json");
const PLAYBOOK_STATE_HISTORY_DIR = path.resolve(process.cwd(), ".data", "playbook_state_history");
const PLAYBOOK_STATE_SEED_PATH = path.resolve(process.cwd(), "src", "config", "playbook_state.seed.json");

function mergeWithDefaults(parsed: Partial<PlaybookState>): PlaybookState {
  const merged = {
    ...DEFAULT_PLAYBOOK_STATE,
    ...parsed,
    adjacent_segments: parsed.adjacent_segments ?? DEFAULT_PLAYBOOK_STATE.adjacent_segments,
    persona_priority: parsed.persona_priority ?? DEFAULT_PLAYBOOK_STATE.persona_priority,
    messaging_guardrails: parsed.messaging_guardrails ?? DEFAULT_PLAYBOOK_STATE.messaging_guardrails,
    channel_priority: parsed.channel_priority ?? DEFAULT_PLAYBOOK_STATE.channel_priority,
    campaign_themes: parsed.campaign_themes ?? DEFAULT_PLAYBOOK_STATE.campaign_themes,
    competitive_rules: parsed.competitive_rules ?? DEFAULT_PLAYBOOK_STATE.competitive_rules,
    key_risks_to_monitor: parsed.key_risks_to_monitor ?? DEFAULT_PLAYBOOK_STATE.key_risks_to_monitor,
  };
  return PlaybookStateSchema.parse(merged);
}

export function loadPlaybookState(): PlaybookState {
  try {
    if (fs.existsSync(PLAYBOOK_STATE_PATH)) {
      const raw = fs.readFileSync(PLAYBOOK_STATE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PlaybookState>;
      return mergeWithDefaults(parsed);
    }

    if (fs.existsSync(PLAYBOOK_STATE_SEED_PATH)) {
      const seedRaw = fs.readFileSync(PLAYBOOK_STATE_SEED_PATH, "utf-8");
      const seedParsed = JSON.parse(seedRaw) as Partial<PlaybookState>;
      return mergeWithDefaults(seedParsed);
    }

    return DEFAULT_PLAYBOOK_STATE;
  } catch {
    return DEFAULT_PLAYBOOK_STATE;
  }
}

export function getPlaybookStatePath(): string {
  return PLAYBOOK_STATE_PATH;
}

export function savePlaybookState(
  input: PlaybookStateInput,
  options?: { updatedBy?: string },
): PlaybookState {
  const validated = PlaybookStateSchema.parse(input);
  const next: PlaybookState = {
    ...validated,
    updated_at: new Date().toISOString(),
    updated_by: options?.updatedBy ?? validated.updated_by ?? "unknown",
  };

  const dir = path.dirname(PLAYBOOK_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(PLAYBOOK_STATE_PATH)) {
    if (!fs.existsSync(PLAYBOOK_STATE_HISTORY_DIR)) {
      fs.mkdirSync(PLAYBOOK_STATE_HISTORY_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const historyFile = path.join(PLAYBOOK_STATE_HISTORY_DIR, `${stamp}.json`);
    fs.copyFileSync(PLAYBOOK_STATE_PATH, historyFile);
  }

  fs.writeFileSync(PLAYBOOK_STATE_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
