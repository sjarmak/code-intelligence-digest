/**
 * Executable guards for the scheduled audio orphan sweep wrapper (bead b1l).
 *
 * The sweep compares LOCAL DISK against DB ROWS and deletes the difference, so
 * the wrapper's two safety properties are the whole point of it existing:
 *   - it refuses to run when the preflight cannot confirm a local DB
 *   - it is dry-run unless explicitly promoted via RECONCILE_AUDIO_APPLY
 *
 * These run the real script with `npx`/`npm` stubbed on PATH, so they exercise
 * the actual control flow rather than a re-description of it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO, "scripts", "reconcile-audio-daily.sh");
const GUARD = path.join(REPO, "scripts", "lib", "assert-local-db.sh");

let tmp: string;

/**
 * PATH shims. `npx` stands in for the preflight (exit code driven by
 * PREFLIGHT_EXIT); `npm` records the script name it was asked to run instead of
 * running it, and echoes USE_LOCAL_DB so we can assert the export happened.
 */
function makeStubs(dir: string) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });

  fs.writeFileSync(
    path.join(bin, "npx"),
    `#!/usr/bin/env bash\nexit \${PREFLIGHT_EXIT:-0}\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, "npm"),
    `#!/usr/bin/env bash\n` +
      `for a in "$@"; do case "$a" in reconcile:*) echo "$a" > "${dir}/invoked";; esac; done\n` +
      `echo "USE_LOCAL_DB=\${USE_LOCAL_DB:-unset}" > "${dir}/env"\n`,
    { mode: 0o755 }
  );
  return bin;
}

function run(env: Record<string, string> = {}) {
  const bin = makeStubs(tmp);
  return execFileSync("bash", [SCRIPT], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: tmp,
      MIRROR_LOG_DIR: path.join(tmp, "logs"),
      ...env,
    },
    encoding: "utf8",
  });
}

const invoked = () =>
  fs.existsSync(path.join(tmp, "invoked"))
    ? fs.readFileSync(path.join(tmp, "invoked"), "utf8").trim()
    : null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b1l-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("reconcile-audio-daily.sh", () => {
  it("defaults to the dry-run npm script", () => {
    run();
    expect(invoked()).toBe("reconcile:audio:dry-run");
  });

  it("stays dry-run when RECONCILE_AUDIO_APPLY is any non-true value", () => {
    run({ RECONCILE_AUDIO_APPLY: "1" });
    expect(invoked()).toBe("reconcile:audio:dry-run");
  });

  it("runs the deleting sweep only when explicitly promoted", () => {
    run({ RECONCILE_AUDIO_APPLY: "true" });
    expect(invoked()).toBe("reconcile:audio");
  });

  it("forces USE_LOCAL_DB=true so the sweep cannot read the prod DB", () => {
    run();
    expect(fs.readFileSync(path.join(tmp, "env"), "utf8").trim()).toBe(
      "USE_LOCAL_DB=true"
    );
  });

  it("aborts without sweeping when the local-DB preflight fails", () => {
    expect(() => run({ PREFLIGHT_EXIT: "1" })).toThrow();
    // The critical assertion: a failed preflight must not reach the sweep at all.
    expect(invoked()).toBeNull();
  });

  it("aborts even when promoted, if the preflight fails", () => {
    expect(() =>
      run({ PREFLIGHT_EXIT: "1", RECONCILE_AUDIO_APPLY: "true" })
    ).toThrow();
    expect(invoked()).toBeNull();
  });
});

/**
 * Lifts the preflight's inline JS out of the shared helper and runs it for real
 * against a supplied LOCAL_DATABASE_URL, so these assert the guard's actual
 * accept/reject behavior rather than a restatement of the regex. dotenv does not
 * override an already-set process.env key, so the injected URL wins.
 */
function runPreflight(url: string): number {
  const src = fs.readFileSync(GUARD, "utf8");
  const guard = src.match(/npx tsx -e "([\s\S]*?)\n"/);
  if (!guard) throw new Error(`no preflight found in ${GUARD}`);

  // Must live inside the repo tree: `require('dotenv')` resolves by walking up
  // from the file, and in a git worktree the local node_modules is empty, so
  // the packages are only found via the parent checkout. Run it from /tmp and
  // every case exits 1 on a resolution failure — which would make the reject
  // assertions below pass for entirely the wrong reason.
  const file = path.join(REPO, `.guard-probe-${process.pid}.cjs`);
  fs.writeFileSync(file, guard[1]);
  try {
    execFileSync("node", [file], {
      cwd: REPO,
      env: { ...process.env, LOCAL_DATABASE_URL: url },
      stdio: "pipe",
    });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const REJECTED = [
  ["a Render prod URL", "postgresql://u:p@dpg-abc123-a.oregon-postgres.render.com:5432/d"],
  ["a bare remote host", "postgres://u:p@db.example.com:5432/d"],
  ["localhost as a subdomain of a remote host", "postgres://u:p@localhost.evil.com:5432/d"],
  ["a non-postgres scheme", "mysql://u:p@localhost:5432/d"],
  ["an empty URL", ""],
] as const;

describe("local-DB preflight guard", () => {
  it.each(REJECTED)("rejects %s", (_label, url) => {
    expect(runPreflight(url)).not.toBe(0);
  });

  it.each([
    ["localhost", "postgresql://u:p@localhost:5432/code_intel"],
    ["127.0.0.1", "postgres://u:p@127.0.0.1:5432/code_intel"],
  ])("accepts %s", (_label, url) => {
    expect(runPreflight(url)).toBe(0);
  });

  it("names the caller in its refusal, so a failing timer says which job", () => {
    let stderr = "";
    try {
      execFileSync("bash", [GUARD, "some-caller"], {
        cwd: REPO,
        env: {
          ...process.env,
          LOCAL_DATABASE_URL: "postgres://u:p@db.example.com:5432/d",
        },
        encoding: "utf8",
        stdio: "pipe",
      });
      throw new Error("guard accepted a remote URL");
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? "");
    }
    expect(stderr).toContain("some-caller");
  });
});

// Both wrappers pair a local store with an env-chosen DB, so the guard has to
// hold in each. reconcile-audio is the destructive one: a DB it cannot see rows
// in makes the entire store look unreferenced. The guard now lives in one place;
// what can still drift is a wrapper quietly dropping the call or growing its own
// copy, so that is what these assert.
const WRAPPERS = ["reconcile-audio-daily.sh", "run-local-cron.sh"] as const;

describe.each(WRAPPERS)("%s", (wrapper) => {
  const src = () => fs.readFileSync(path.join(REPO, "scripts", wrapper), "utf8");

  it("delegates its preflight to the shared guard", () => {
    expect(src()).toContain("lib/assert-local-db.sh");
  });

  it("carries no inline copy of the guard", () => {
    expect(src()).not.toMatch(/npx tsx -e "/);
  });
});
