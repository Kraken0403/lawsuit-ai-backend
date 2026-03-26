import { qdrant } from "../qdrant/client.js";
import { env } from "../config/env.js";

type IndexJob = {
  field_name: string;
  field_schema: any;
};

const INDEX_JOBS: IndexJob[] = [
  {
    field_name: "title",
    field_schema: {
      type: "text",
      tokenizer: "word",
      min_token_len: 2,
      max_token_len: 50,
      lowercase: true,
      phrase_matching: true,
    },
  },
  {
    field_name: "court",
    field_schema: {
      type: "text",
      tokenizer: "word",
      min_token_len: 2,
      max_token_len: 30,
      lowercase: true,
    },
  },
  {
    field_name: "citation",
    field_schema: "keyword",
  },
  {
    field_name: "equivalentCitations",
    field_schema: "keyword",
  },
  {
    field_name: "caseNo",
    field_schema: "keyword",
  },
  {
    field_name: "judges",
    field_schema: "keyword",
  },
  {
    field_name: "advocates",
    field_schema: "keyword",
  },
  {
    field_name: "actsReferred",
    field_schema: "keyword",
  },
  {
    field_name: "subject",
    field_schema: "keyword",
  },
  {
    field_name: "finalDecision",
    field_schema: "keyword",
  },
  {
    field_name: "caseType",
    field_schema: "keyword",
  },
  {
    field_name: "caseId",
    field_schema: "integer",
  },
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function createIndexes() {
  const collection = env.qdrant.collection;

  console.log(`Creating payload indexes on collection: ${collection}`);

  for (const job of INDEX_JOBS) {
    try {
      console.log(`→ indexing ${job.field_name}`);

      const result = await qdrant.createPayloadIndex(collection, {
        field_name: job.field_name,
        field_schema: job.field_schema,
      });

      console.log(`✓ ${job.field_name}`, result);
    } catch (error) {
      const message = errorMessage(error);

      if (/already exists|duplicate|exists/i.test(message)) {
        console.log(`• ${job.field_name} already indexed`);
        continue;
      }

      console.error(`✗ failed for ${job.field_name}`);
      console.error(message);
      throw error;
    }
  }

  console.log("Done creating payload indexes.");
}

createIndexes().catch((error) => {
  console.error(error);
  process.exit(1);
});