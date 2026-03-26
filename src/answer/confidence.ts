import type { OrchestratedSearchResult } from "../types/search.js";

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function estimateConfidence(result: OrchestratedSearchResult): number {
  const grouped = result.groupedCases || [];
  if (!grouped.length) return 0.2;

  const top = grouped[0]?.bestScore ?? 0;
  const second = grouped[1]?.bestScore ?? 0;
  const evidenceCount = result.evidence?.length ?? 0;

  let score = 0.45;

  score += Math.min(top, 1) * 0.3;
  score += Math.min(Math.max(top - second, 0), 0.3) * 0.4;
  score += Math.min(evidenceCount / 6, 1) * 0.1;

  if (grouped.length >= 2) score += 0.05;

  return Number(clamp(score).toFixed(2));
}