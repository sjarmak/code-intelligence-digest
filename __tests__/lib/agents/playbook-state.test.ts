import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  getPlaybookStatePath,
  loadPlaybookState,
  savePlaybookState,
} from "../../../src/lib/agents/playbook-state";

describe("playbook-state", () => {
  it("loads a default state when no updater artifact exists", () => {
    const state = loadPlaybookState();
    expect(state.playbook_version).toBeTruthy();
    expect(state.primary_beachhead).toBe("Capital Markets");
    expect(state.adjacent_segments.length).toBeGreaterThan(0);
    expect(state.messaging_guardrails.length).toBeGreaterThan(0);
  });

  it("saves and reloads playbook_state with metadata", () => {
    const path = getPlaybookStatePath();
    const existed = fs.existsSync(path);
    const previous = existed ? fs.readFileSync(path, "utf-8") : null;

    try {
      const base = loadPlaybookState();
      const saved = savePlaybookState(
        {
          ...base,
          playbook_version: "2026-02-27-test",
        },
        { updatedBy: "test-runner" },
      );
      expect(saved.playbook_version).toBe("2026-02-27-test");
      expect(saved.updated_by).toBe("test-runner");

      const reloaded = loadPlaybookState();
      expect(reloaded.playbook_version).toBe("2026-02-27-test");
      expect(reloaded.updated_by).toBe("test-runner");
    } finally {
      if (previous != null) {
        fs.writeFileSync(path, previous, "utf-8");
      } else if (fs.existsSync(path)) {
        fs.unlinkSync(path);
      }
    }
  });
});
