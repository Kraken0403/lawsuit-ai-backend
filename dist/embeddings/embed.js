import { env } from "../config/env.js";
export async function embedQuery(text) {
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
    const json = (await response.json());
    return json.data[0].embedding;
}
//# sourceMappingURL=embed.js.map