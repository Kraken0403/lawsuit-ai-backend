import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

const llmApiKey =
  process.env.OPENAI_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.EMBEDDING_API_KEY ||
  "";

if (!llmApiKey) {
  throw new Error(
    "Missing env var: OPENAI_API_KEY (or LLM_API_KEY / EMBEDDING_API_KEY fallback)"
  );
}

export const env = {
  qdrant: {
    url: required("QDRANT_URL"),
    apiKey: process.env.QDRANT_API_KEY || "",
    collection: required("QDRANT_COLLECTION"),
  },
  embedding: {
    apiKey: required("EMBEDDING_API_KEY"),
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    baseUrl: process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1",
  },
  llm: {
    apiKey: llmApiKey,
    baseUrl:
      process.env.OPENAI_BASE_URL ||
      process.env.LLM_BASE_URL ||
      "https://api.openai.com/v1",
    routerModel:
      process.env.OPENAI_ROUTER_MODEL ||
      process.env.LLM_ROUTER_MODEL ||
      "gpt-4.1-mini",
  },
};