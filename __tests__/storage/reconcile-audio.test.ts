/**
 * Unit tests for audio storage reconciliation (orphan sweep).
 *
 * The sweep deletes stored audio objects that no generated_podcast_audio row
 * references. Getting this wrong deletes live audio, so the tests lean on the
 * cases where a naive left-join would be destructive: segment-only references
 * and files young enough to belong to a flight that has not persisted yet.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  LocalStorageAdapter,
  audioUrlToKey,
} from "../../src/lib/storage/local";
import {
  reconcileAudioStorage,
  EmptyReferenceSetError,
  DEFAULT_GRACE_MS,
} from "../../src/lib/storage/reconcile-audio";
import type { StoredObject, ReconcilableStorage } from "../../src/lib/audio/types";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** In-memory storage double so the sweep can be tested without touching disk. */
function fakeStorage(objects: StoredObject[]): ReconcilableStorage & { deleted: string[] } {
  const remaining = [...objects];
  const deleted: string[] = [];
  return {
    deleted,
    async listObjects() {
      return [...remaining];
    },
    async deleteObject(key: string) {
      const idx = remaining.findIndex((o) => o.key === key);
      if (idx === -1) return false;
      remaining.splice(idx, 1);
      deleted.push(key);
      return true;
    },
  };
}

const obj = (key: string, ageMs: number, bytes = 100): StoredObject => ({
  key,
  bytes,
  modifiedAtMs: NOW - ageMs,
});

describe("audioUrlToKey", () => {
  it("maps a served audio URL back to its storage key", () => {
    expect(audioUrlToKey("/api/audio/podcasts/abc.mp3")).toBe("podcasts/abc.mp3");
  });

  it("maps an absolute URL pointing at the audio route", () => {
    expect(audioUrlToKey("https://example.com/api/audio/podcasts/abc.mp3")).toBe(
      "podcasts/abc.mp3"
    );
  });

  it("returns null for URLs that are not backed by our storage", () => {
    expect(audioUrlToKey("https://cdn.example.com/somewhere/abc.mp3")).toBeNull();
    expect(audioUrlToKey("/api/audio/")).toBeNull();
    expect(audioUrlToKey("")).toBeNull();
  });

  it("round trips the exact key putObject wrote into the URL", async () => {
    // putObject interpolates the key verbatim, so decoding the relative form
    // would corrupt any key holding a literal '%' and orphan a live file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-roundtrip-"));
    try {
      const storage = new LocalStorageAdapter(dir);
      const key = "podcasts/100%-final v2.mp3";
      const { url } = await storage.putObject(key, Buffer.from("x"));

      expect(audioUrlToKey(url)).toBe(key);
      expect((await storage.listObjects())[0].key).toBe(key);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decodes the absolute form, which the URL parser percent-encodes", () => {
    expect(audioUrlToKey("https://example.com/api/audio/podcasts/a%20b.mp3")).toBe(
      "podcasts/a b.mp3"
    );
  });

  it("returns null rather than throwing on malformed percent-encoding", () => {
    expect(audioUrlToKey("https://example.com/api/audio/podcasts/%E0%A4%A.mp3")).toBeNull();
  });
});

describe("reconcileAudioStorage", () => {
  it("deletes an unreferenced object older than the grace window", async () => {
    // Paired with a live object so the reference set is non-empty: a sweep that
    // resolves zero references is the wrong-DB signature and is refused below.
    const storage = fakeStorage([
      obj("podcasts/orphan.mp3", 48 * HOUR, 500),
      obj("podcasts/live.mp3", 48 * HOUR),
    ]);

    const result = await reconcileAudioStorage(
      storage,
      async () => new Set(["podcasts/live.mp3"]),
      { now: NOW }
    );

    expect(storage.deleted).toEqual(["podcasts/orphan.mp3"]);
    expect(result.deleted).toBe(1);
    expect(result.reclaimedBytes).toBe(500);
  });

  it("keeps an unreferenced object still inside the grace window", async () => {
    // A file written seconds ago may belong to a flight that has not persisted
    // its row yet — deleting it would race the writer.
    const storage = fakeStorage([obj("podcasts/inflight.mp3", 1000)]);

    const result = await reconcileAudioStorage(storage, async () => new Set(), {
      now: NOW,
    });

    expect(storage.deleted).toEqual([]);
    expect(result.withinGrace).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it("keeps a referenced object no matter how old it is", async () => {
    const storage = fakeStorage([obj("podcasts/live.mp3", 365 * 24 * HOUR)]);

    const result = await reconcileAudioStorage(
      storage,
      async () => new Set(["podcasts/live.mp3"]),
      { now: NOW }
    );

    expect(storage.deleted).toEqual([]);
    expect(result.referenced).toBe(1);
  });

  it("keeps objects referenced only through segment_audio", async () => {
    // A row's segment URLs are real references; joining on audio_url alone
    // would sweep every per-segment file.
    const storage = fakeStorage([
      obj("podcasts/main.mp3", 48 * HOUR),
      obj("podcasts/seg-1.mp3", 48 * HOUR),
      obj("podcasts/seg-2.mp3", 48 * HOUR),
    ]);

    const result = await reconcileAudioStorage(
      storage,
      async () =>
        new Set(["podcasts/main.mp3", "podcasts/seg-1.mp3", "podcasts/seg-2.mp3"]),
      { now: NOW }
    );

    expect(storage.deleted).toEqual([]);
    expect(result.deleted).toBe(0);
  });

  it("reports orphans without deleting them in dry-run mode", async () => {
    const storage = fakeStorage([obj("podcasts/orphan.mp3", 48 * HOUR, 750)]);

    const result = await reconcileAudioStorage(storage, async () => new Set(), {
      now: NOW,
      dryRun: true,
    });

    expect(storage.deleted).toEqual([]);
    expect(result.orphaned).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.reclaimedBytes).toBe(750);
  });

  it("deletes nothing when the reference set cannot be loaded", async () => {
    // A partial or failed reference read must never be treated as "unreferenced".
    const storage = fakeStorage([obj("podcasts/live.mp3", 48 * HOUR)]);

    await expect(
      reconcileAudioStorage(
        storage,
        async () => {
          throw new Error("db down");
        },
        { now: NOW }
      )
    ).rejects.toThrow("db down");

    expect(storage.deleted).toEqual([]);
  });

  it("keeps sweeping after an individual delete fails", async () => {
    const storage = fakeStorage([
      obj("podcasts/a.mp3", 48 * HOUR),
      obj("podcasts/b.mp3", 48 * HOUR),
      obj("podcasts/live.mp3", 48 * HOUR),
    ]);
    const realDelete = storage.deleteObject.bind(storage);
    storage.deleteObject = async (key: string) => {
      if (key === "podcasts/a.mp3") throw new Error("EACCES");
      return realDelete(key);
    };

    const result = await reconcileAudioStorage(
      storage,
      async () => new Set(["podcasts/live.mp3"]),
      { now: NOW }
    );

    expect(result.orphaned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failures).toEqual([{ key: "podcasts/a.mp3", error: "EACCES" }]);
  });

  it("lists objects before resolving references, so a concurrent write is kept", async () => {
    // A row persisted between the two reads must land inside the reference set.
    // Listing second would classify the file it protects as an orphan.
    const calls: string[] = [];
    const storage = fakeStorage([obj("podcasts/racing.mp3", 48 * HOUR)]);
    const listObjects = storage.listObjects.bind(storage);
    storage.listObjects = async () => {
      calls.push("list");
      return listObjects();
    };

    const result = await reconcileAudioStorage(
      storage,
      async () => {
        calls.push("refs");
        // Simulates the writer committing its row after the listing.
        return new Set(["podcasts/racing.mp3"]);
      },
      { now: NOW }
    );

    expect(calls).toEqual(["list", "refs"]);
    expect(storage.deleted).toEqual([]);
    expect(result.referenced).toBe(1);
  });

  it("defaults to a grace window long enough to outlast a render flight", () => {
    expect(DEFAULT_GRACE_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});

describe("reconcileAudioStorage wrong-database interlock", () => {
  // The host preflight proves LOCAL_DATABASE_URL points at *a* local postgres.
  // It cannot prove it is the instance whose rows back this store. Read the
  // wrong local instance and listReferencedAudioKeys returns nothing, so every
  // object looks orphaned and the whole store becomes eligible for deletion.
  // Zero references against a non-empty store is that read's exact signature.

  it("refuses to delete when the store is non-empty but nothing is referenced", async () => {
    const storage = fakeStorage([
      obj("podcasts/a.mp3", 48 * HOUR),
      obj("podcasts/b.mp3", 48 * HOUR),
    ]);

    await expect(
      reconcileAudioStorage(storage, async () => new Set(), { now: NOW })
    ).rejects.toThrow(EmptyReferenceSetError);

    expect(storage.deleted).toEqual([]);
  });

  it("names the counts that tripped it, so the operator can tell which DB it read", async () => {
    const storage = fakeStorage([obj("podcasts/a.mp3", 48 * HOUR)]);

    await expect(
      reconcileAudioStorage(storage, async () => new Set(), { now: NOW })
    ).rejects.toThrow(/scanned=1 referenced=0 orphaned=1/);
  });

  it("proceeds when the operator has confirmed the store is genuinely all-orphan", async () => {
    // The legitimate empty-reference case — every row deleted, files left over.
    // Rare enough to be worth an explicit opt-in on a destructive pass.
    const storage = fakeStorage([obj("podcasts/a.mp3", 48 * HOUR)]);

    const result = await reconcileAudioStorage(storage, async () => new Set(), {
      now: NOW,
      allowEmptyReferenceSet: true,
    });

    expect(storage.deleted).toEqual(["podcasts/a.mp3"]);
    expect(result.deleted).toBe(1);
  });

  it("still reports the orphans in dry-run mode, which deletes nothing", async () => {
    // Dry-run is how an operator diagnoses this in the first place; failing it
    // closed would hide the counts that distinguish wrong-DB from all-orphan.
    const storage = fakeStorage([obj("podcasts/a.mp3", 48 * HOUR, 300)]);

    const result = await reconcileAudioStorage(storage, async () => new Set(), {
      now: NOW,
      dryRun: true,
    });

    expect(storage.deleted).toEqual([]);
    expect(result.orphaned).toBe(1);
    expect(result.reclaimedBytes).toBe(300);
  });

  it("does not trip on an empty store, which has nothing to lose", async () => {
    const storage = fakeStorage([]);

    const result = await reconcileAudioStorage(storage, async () => new Set(), {
      now: NOW,
    });

    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("does not trip when every unreferenced object is still within grace", async () => {
    // Nothing would be deleted, so there is no destructive act to interlock.
    // Tripping here would fail a fresh store where no row has landed yet.
    const storage = fakeStorage([obj("podcasts/inflight.mp3", 1000)]);

    const result = await reconcileAudioStorage(storage, async () => new Set(), {
      now: NOW,
    });

    expect(result.withinGrace).toBe(1);
    expect(result.orphaned).toBe(0);
  });
});

describe("LocalStorageAdapter listObjects/deleteObject", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-reconcile-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists stored objects by nested key with size and mtime", async () => {
    const storage = new LocalStorageAdapter(dir);
    await storage.putObject("podcasts/one.mp3", Buffer.from("abcd"));

    const objects = await storage.listObjects();

    expect(objects).toHaveLength(1);
    expect(objects[0].key).toBe("podcasts/one.mp3");
    expect(objects[0].bytes).toBe(4);
    expect(objects[0].modifiedAtMs).toBeGreaterThan(0);
  });

  it("deletes a stored object and reports whether it was there", async () => {
    const storage = new LocalStorageAdapter(dir);
    await storage.putObject("podcasts/one.mp3", Buffer.from("abcd"));

    expect(await storage.deleteObject("podcasts/one.mp3")).toBe(true);
    expect(await storage.exists("podcasts/one.mp3")).toBe(false);
    expect(await storage.deleteObject("podcasts/one.mp3")).toBe(false);
  });

  it("refuses keys that escape the audio directory", async () => {
    const storage = new LocalStorageAdapter(dir);

    await expect(storage.deleteObject("../../etc/passwd")).rejects.toThrow(
      /outside the audio directory/
    );
  });
});
