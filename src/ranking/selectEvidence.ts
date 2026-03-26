import type { CaseGroup, RawChunkHit } from "../types/search.js";

export function selectEvidence(groups: CaseGroup[], maxChunks = 6): RawChunkHit[] {
  const output: RawChunkHit[] = [];

  for (const group of groups) {
    for (const chunk of group.chunks) {
      output.push(chunk);
      if (output.length >= maxChunks) {
        return output;
      }
    }
  }

  return output;
}