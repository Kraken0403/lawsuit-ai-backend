import { env } from "../config/env.js";

type OpenAIEmbeddingResponse = {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
};

export async function embedQuery(text: string): Promise<number[]> {
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
  return json.data[0].embedding;
}