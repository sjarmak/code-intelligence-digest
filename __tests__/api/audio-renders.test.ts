/**
 * Route handler unit tests for the asynchronous render API:
 *   POST /api/podcast/audio-renders
 *   GET  /api/podcast/audio-renders/{renderId}
 *
 * The Temporal client is mocked at the module boundary
 * (src/lib/audio/durable/temporalClient); classification helpers and
 * constants stay real. The transcript store is mocked in-memory so tests
 * never write into the repo's .data/ directory. No DB, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import {
  Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";

vi.mock("@/src/lib/audio/durable/temporalClient", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/audio/durable/temporalClient")
  >();
  return { ...actual, getTemporalClient: vi.fn() };
});

vi.mock("@/src/lib/audio/durable/transcriptStore", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/audio/durable/transcriptStore")
  >();
  const { createHash: hash } = await import("node:crypto");
  class InMemoryTranscriptStore {
    async put(sanitizedTranscript: string) {
      if (sanitizedTranscript.length === 0) {
        throw new Error("TranscriptStore.put: refusing to store an empty transcript");
      }
      const bytes = Buffer.from(sanitizedTranscript, "utf8");
      const transcriptSha256 = hash("sha256").update(bytes).digest("hex");
      return {
        transcriptRef: `transcripts/${transcriptSha256}.txt`,
        transcriptSha256,
        byteCount: bytes.length,
      };
    }
  }
  return { ...actual, TranscriptStore: InMemoryTranscriptStore };
});

import { POST } from "@/app/api/podcast/audio-renders/route";
import { GET } from "@/app/api/podcast/audio-renders/[renderId]/route";
import {
  RENDER_POLICY_VERSION,
  getTemporalClient,
} from "@/src/lib/audio/durable/temporalClient";
import { CHUNKER_VERSION } from "@/src/lib/audio/durable/chunker";
import { STITCHER_VERSION } from "@/src/lib/audio/durable/stitcher";
import { computeRenderKey, workflowIdFor } from "@/src/lib/audio/durable/keys";
import { sanitizeTranscriptForTts } from "@/src/lib/audio/sanitize";
import { PublishResult } from "@/src/lib/audio/durable/types";

const mockGetTemporalClient = vi.mocked(getTemporalClient);

const TRANSCRIPT =
  "Welcome back to the digest. Today we cover durable execution, chunked audio renders, and one worker that refuses to die quietly.";

const VALID_BODY = {
  transcript: TRANSCRIPT,
  provider: "demo",
  providerModel: "deterministic-v1",
  voice: "single-default",
  format: "wav",
};

function expectedRenderKey(): string {
  const sanitized = sanitizeTranscriptForTts(TRANSCRIPT);
  const sanitizedTranscriptSha256 = createHash("sha256")
    .update(Buffer.from(sanitized, "utf8"))
    .digest("hex");
  return computeRenderKey({
    sanitizedTranscriptSha256,
    provider: "demo",
    providerModel: "deterministic-v1",
    voice: "single-default",
    format: "wav",
    chunkerVersion: CHUNKER_VERSION,
    stitcherVersion: STITCHER_VERSION,
    renderPolicyVersion: RENDER_POLICY_VERSION,
  });
}

function postRequest(body: unknown, raw = false): NextRequest {
  return new Request("http://localhost:3002/api/podcast/audio-renders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function getRequest(renderId: string) {
  const request = new Request(
    `http://localhost:3002/api/podcast/audio-renders/${renderId}`
  ) as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ renderId }) });
}

type FakeHandle = {
  describe: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  result: ReturnType<typeof vi.fn>;
};

function fakeHandle(overrides: Partial<FakeHandle> = {}): FakeHandle {
  return {
    describe: overrides.describe ?? vi.fn().mockRejectedValue(new Error("describe not stubbed")),
    query: overrides.query ?? vi.fn().mockRejectedValue(new Error("query not stubbed")),
    result: overrides.result ?? vi.fn().mockRejectedValue(new Error("result not stubbed")),
  };
}

function fakeClient(options: { start?: ReturnType<typeof vi.fn>; handle?: FakeHandle } = {}) {
  const handle = options.handle ?? fakeHandle();
  const start = options.start ?? vi.fn().mockResolvedValue({ workflowId: "wf" });
  const client = {
    workflow: {
      start,
      getHandle: vi.fn().mockReturnValue(handle),
    },
  } as unknown as Client;
  return { client, start, handle };
}

/** A gRPC-shaped error that isGrpcServiceError recognizes. */
function grpcError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code, details: message, metadata: {} });
}

function describeStatus(name: string) {
  return vi.fn().mockResolvedValue({ status: { name } });
}

const PUBLISH_RESULT: PublishResult = {
  renderKey: expectedRenderKey(),
  audioId: "aud-11111111-2222-3333-4444-555555555555",
  audioUrl: `/api/audio/podcast-renders/${expectedRenderKey()}/final.wav`,
  finalObjectKey: `podcast-renders/${expectedRenderKey()}/final.wav`,
  checksumSha256: "ab".repeat(32),
  byteCount: 987_654,
  durationMs: 143_250,
  publishedAt: "2026-07-23T12:00:00.000Z",
};

beforeEach(() => {
  mockGetTemporalClient.mockReset();
});

describe("POST /api/podcast/audio-renders validation", () => {
  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(postRequest("this is not json", true));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid JSON/);
    expect(mockGetTemporalClient).not.toHaveBeenCalled();
  });

  it("rejects a missing transcript with 400", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, transcript: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/transcript/);
  });

  it("rejects an unknown provider with 400", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, provider: "espeak" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/provider must be one of/);
  });

  it("rejects a missing providerModel with 400", async () => {
    const { providerModel: _dropped, ...body } = VALID_BODY;
    const res = await POST(postRequest(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/providerModel/);
  });

  it("rejects a missing voice with 400", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, voice: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/voice/);
  });

  it("rejects an unsupported format with 400", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, format: "flac" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/format must be one of/);
  });

  it("rejects a multi-voice transcript with 422", async () => {
    const res = await POST(
      postRequest({
        ...VALID_BODY,
        transcript: "HOST: Welcome to the show.\nCOHOST: Glad to be here.",
      })
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/multi-voice/);
    expect(mockGetTemporalClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/podcast/audio-renders start behavior", () => {
  it("starts the workflow and returns 202 with Location and statusUrl", async () => {
    const { client, start } = fakeClient();
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(202);

    const renderKey = expectedRenderKey();
    const statusUrl = `/api/podcast/audio-renders/${renderKey}`;
    expect(res.headers.get("Location")).toBe(statusUrl);
    expect(await res.json()).toEqual({
      renderId: renderKey,
      status: "queued",
      statusUrl,
    });

    expect(start).toHaveBeenCalledTimes(1);
    const [workflowType, options] = start.mock.calls[0];
    expect(workflowType).toBe("renderPodcast");
    expect(options.workflowId).toBe(workflowIdFor(renderKey));
    expect(options.workflowId).toBe(`podcast-render/${renderKey}`);
    expect(options.taskQueue).toBe("podcast-render");
    expect(options.workflowIdReusePolicy).toBe(WorkflowIdReusePolicy.REJECT_DUPLICATE);

    const sanitized = sanitizeTranscriptForTts(TRANSCRIPT);
    const sha = createHash("sha256").update(Buffer.from(sanitized, "utf8")).digest("hex");
    expect(options.args).toEqual([
      {
        renderKey,
        transcriptRef: `transcripts/${sha}.txt`,
        transcriptSha256: sha,
        config: {
          provider: "demo",
          providerModel: "deterministic-v1",
          voice: "single-default",
          format: "wav",
          chunkerVersion: CHUNKER_VERSION,
          stitcherVersion: STITCHER_VERSION,
          renderPolicyVersion: RENDER_POLICY_VERSION,
        },
      },
    ]);
  });

  it("returns 200 with the running resource on a duplicate start", async () => {
    const renderKey = expectedRenderKey();
    const handle = fakeHandle({
      describe: describeStatus("RUNNING"),
      query: vi.fn().mockResolvedValue({ completedChunks: 6, totalChunks: 8, attempt: 1 }),
    });
    const start = vi
      .fn()
      .mockRejectedValue(
        new WorkflowExecutionAlreadyStartedError(
          "Workflow execution already started",
          workflowIdFor(renderKey),
          "renderPodcast"
        )
      );
    const { client } = fakeClient({ start, handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      renderId: renderKey,
      status: "running",
      completedChunks: 6,
      totalChunks: 8,
      attempt: 1,
    });
    expect(handle.query).toHaveBeenCalledWith("progress");
  });

  it("returns 200 with the published result on a duplicate start of a completed render", async () => {
    const renderKey = expectedRenderKey();
    const handle = fakeHandle({
      describe: describeStatus("COMPLETED"),
      result: vi.fn().mockResolvedValue(PUBLISH_RESULT),
    });
    const start = vi
      .fn()
      .mockRejectedValue(
        new WorkflowExecutionAlreadyStartedError(
          "Workflow execution already started",
          workflowIdFor(renderKey),
          "renderPodcast"
        )
      );
    const { client } = fakeClient({ start, handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      renderId: renderKey,
      status: "completed",
      result: PUBLISH_RESULT,
    });
  });

  it("returns 503 when the Temporal connection cannot be established", async () => {
    mockGetTemporalClient.mockRejectedValue(grpcError(14, "No connection established"));

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/unavailable/);
  });

  it("returns 503 when the workflow start fails as unavailable", async () => {
    const start = vi.fn().mockRejectedValue(grpcError(14, "upstream connect error"));
    const { client } = fakeClient({ start });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/was not accepted/);
  });

  it("returns 500 on a non-availability start failure", async () => {
    const start = vi.fn().mockRejectedValue(new Error("payload converter exploded"));
    const { client } = fakeClient({ start });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("payload converter exploded");
  });
});

describe("GET /api/podcast/audio-renders/{renderId}", () => {
  const renderKey = expectedRenderKey();

  it("rejects a malformed renderId with 400", async () => {
    const res = await getRequest("not-a-render-key");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/64-character/);
    expect(mockGetTemporalClient).not.toHaveBeenCalled();
  });

  it("returns 404 when Temporal has no execution for the renderKey", async () => {
    const handle = fakeHandle({
      describe: vi
        .fn()
        .mockRejectedValue(
          new WorkflowNotFoundError("no such workflow", workflowIdFor(renderKey), undefined)
        ),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no audio render found/);
  });

  it("projects a running workflow with progress", async () => {
    const handle = fakeHandle({
      describe: describeStatus("RUNNING"),
      query: vi.fn().mockResolvedValue({ completedChunks: 2, totalChunks: 8, attempt: 3 }),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      renderId: renderKey,
      status: "running",
      completedChunks: 2,
      totalChunks: 8,
      attempt: 3,
    });
  });

  it("projects a running workflow with no plan yet as queued", async () => {
    const handle = fakeHandle({
      describe: describeStatus("RUNNING"),
      query: vi.fn().mockResolvedValue({ completedChunks: 0, totalChunks: 0, attempt: 1 }),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ renderId: renderKey, status: "queued" });
  });

  it("projects a running workflow whose progress query deadlines (no worker yet) as queued", async () => {
    const handle = fakeHandle({
      describe: describeStatus("RUNNING"),
      query: vi.fn().mockRejectedValue(grpcError(4, "Deadline exceeded")),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ renderId: renderKey, status: "queued" });
  });

  it("projects a running workflow whose progress query hits FAILED_PRECONDITION (worker down) as queued", async () => {
    // The demo's kill-to-restart window: the frontend rejects the query with
    // gRPC FAILED_PRECONDITION "no poller seen for task queue recently".
    const handle = fakeHandle({
      describe: describeStatus("RUNNING"),
      query: vi
        .fn()
        .mockRejectedValue(
          grpcError(9, "no poller seen for task queue recently, worker may be down")
        ),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ renderId: renderKey, status: "queued" });
  });

  it("returns 500 on a malformed progress query result", async () => {
    const handle = fakeHandle({
      describe: describeStatus("RUNNING"),
      query: vi.fn().mockResolvedValue({ completedChunks: 9, totalChunks: 8, attempt: 0 }),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/malformed progress query result/);
  });

  it("projects a completed workflow with the publish result", async () => {
    const handle = fakeHandle({
      describe: describeStatus("COMPLETED"),
      result: vi.fn().mockResolvedValue(PUBLISH_RESULT),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      renderId: renderKey,
      status: "completed",
      result: PUBLISH_RESULT,
    });
  });

  it("projects a failed workflow with the root-cause message", async () => {
    const handle = fakeHandle({
      describe: describeStatus("FAILED"),
      result: vi
        .fn()
        .mockRejectedValue(
          new WorkflowFailedError(
            "Workflow execution failed",
            Object.assign(new Error("transcript at transcripts/deadbeef.txt hashes to a different digest"), {}),
            undefined
          )
        ),
    });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      renderId: renderKey,
      status: "failed",
      error: "transcript at transcripts/deadbeef.txt hashes to a different digest",
    });
  });

  it("projects a cancelled workflow", async () => {
    const handle = fakeHandle({ describe: describeStatus("CANCELLED") });
    const { client } = fakeClient({ handle });
    mockGetTemporalClient.mockResolvedValue(client);

    const res = await getRequest(renderKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ renderId: renderKey, status: "cancelled" });
  });

  it("returns 503 when Temporal is unreachable", async () => {
    mockGetTemporalClient.mockRejectedValue(grpcError(14, "No connection established"));

    const res = await getRequest(renderKey);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/unavailable/);
  });
});
