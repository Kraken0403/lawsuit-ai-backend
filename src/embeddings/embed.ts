import { env } from "../config/env.js";

type OpenAIEmbeddingResponse = {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
};

const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE_MAX_ENTRIES = 500;
const embeddingCache = new Map<
  string,
  { value: number[]; expiresAt: number }
>();

function getCachedEmbedding(key: string) {
  const cached = embeddingCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    embeddingCache.delete(key);
    return null;
  }

  embeddingCache.delete(key);
  embeddingCache.set(key, cached);
  return cached.value;
}

function cacheEmbedding(key: string, value: number[]) {
  embeddingCache.set(key, {
    value,
    expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
  });

  while (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey == null) break;
    embeddingCache.delete(oldestKey);
  }
}

export async function embedQuery(text: string): Promise<number[]> {
  const cacheKey = text.replace(/\s+/g, " ").trim();
  const cached = getCachedEmbedding(cacheKey);
  if (cached) return cached;

  const response = await fetch(`${env.embedding.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.embedding.apiKey}`,
    },
    body: JSON.stringify({
      model: env.embedding.model,
      input: [text],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding failed: ${response.status} ${errorText}`);
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse;
  const embedding = json.data[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response did not contain a vector.");
  }

  cacheEmbedding(cacheKey, embedding);
  return embedding;
}
