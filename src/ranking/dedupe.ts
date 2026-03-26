import type { RawChunkHit } from "../types/search.js";

export function dedupeChunks(hits: RawChunkHit[]): RawChunkHit[] {
  const seen = new Set<string>();
  const output: RawChunkHit[] = [];

  for (const hit of hits) {
    const key = `${hit.caseId}:${hit.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(hit);
  }

  return output;
}