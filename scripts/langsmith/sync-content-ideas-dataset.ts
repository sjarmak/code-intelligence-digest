import dotenv from "dotenv";
import path from "path";
import { Client } from "langsmith";
import {
  CONTENT_IDEAS_DATASET_DESCRIPTION,
  CONTENT_IDEAS_DATASET_NAME,
  CONTENT_IDEAS_EXAMPLES,
} from "./content-ideas-dataset";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    throw new Error("LANGSMITH_API_KEY is required.");
  }

  const client = new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT?.trim() || process.env.LANGCHAIN_ENDPOINT?.trim(),
    webUrl: process.env.LANGSMITH_WEB_URL?.trim(),
  });

  const hasDataset = await client.hasDataset({ datasetName: CONTENT_IDEAS_DATASET_NAME });
  const dataset = hasDataset
    ? await client.readDataset({ datasetName: CONTENT_IDEAS_DATASET_NAME })
    : await client.createDataset(CONTENT_IDEAS_DATASET_NAME, {
        description: CONTENT_IDEAS_DATASET_DESCRIPTION,
        dataType: "kv",
      });

  const existingExamplesIterable = await client.listExamples({
    datasetName: CONTENT_IDEAS_DATASET_NAME,
    limit: 100,
  });
  const existingExamples = [];
  for await (const example of existingExamplesIterable) {
    existingExamples.push(example);
  }
  const existingBySeedId = new Map(
    existingExamples
      .map((example) => [String(example.metadata?.seed_id ?? ""), example] as const)
      .filter(([seedId]) => Boolean(seedId)),
  );

  const uploads = CONTENT_IDEAS_EXAMPLES.filter((example) => !existingBySeedId.has(example.id)).map((example) => ({
    dataset_name: CONTENT_IDEAS_DATASET_NAME,
    inputs: example.inputs,
    outputs: example.outputs,
    metadata: {
      seed_id: example.id,
      suite: "content_ideas",
    },
    split: ["baseline"],
  }));

  const updates = CONTENT_IDEAS_EXAMPLES.flatMap((example) => {
    const existing = existingBySeedId.get(example.id);
    if (!existing) return [];

    const nextMetadata = {
      seed_id: example.id,
      suite: "content_ideas",
    };

    const inputsChanged = stableStringify(existing.inputs ?? {}) !== stableStringify(example.inputs);
    const outputsChanged = stableStringify(existing.outputs ?? {}) !== stableStringify(example.outputs);
    const metadataChanged = stableStringify(existing.metadata ?? {}) !== stableStringify(nextMetadata);
    const splitChanged =
      stableStringify(existing.split ?? []) !== stableStringify(["baseline"]);

    if (!inputsChanged && !outputsChanged && !metadataChanged && !splitChanged) {
      return [];
    }

    return [
      {
        id: existing.id,
        inputs: example.inputs,
        outputs: example.outputs,
        metadata: nextMetadata,
        split: ["baseline"],
      },
    ];
  });

  if (uploads.length > 0) {
    await client.createExamples(uploads);
  }
  if (updates.length > 0) {
    await client.updateExamples(updates);
  }

  console.log(
    JSON.stringify(
      {
        dataset: CONTENT_IDEAS_DATASET_NAME,
        datasetId: typeof dataset?.id === "string" ? dataset.id : null,
        existing: existingExamples.length,
        created: uploads.length,
        updated: updates.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
