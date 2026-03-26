import type { ClassifiedQuery } from "../types/search.js";

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const v = String(value || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }

  return out;
}

export function buildHybridQueryText(query: ClassifiedQuery): string {
  const citations = query.citations || [];
  const comparisonTargets = query.comparisonTargets || [];
  const exactTerms = query.exactTerms || [];
  const filters = query.filters || {};

  switch (query.intent) {
    case "metadata_lookup":
    case "case_lookup":
    case "full_judgment":
      return unique([
        query.caseTarget,
        ...citations,
        ...exactTerms,
        query.normalizedQuery,
      ]).join(" ");

    case "holding_search":
      return unique([
        query.caseTarget,
        ...citations,
        query.normalizedQuery,
        "holding ratio decidendi held concluded",
      ]).join(" ");

    case "comparison":
      return unique([
        ...comparisonTargets,
        ...citations,
        query.normalizedQuery,
      ]).join(" ");

    case "latest_cases":
      return unique([
        ...(filters.jurisdiction || []),
        ...(filters.courts || []),
        ...(filters.subjects || []),
        ...(filters.statutes || []),
        ...(filters.sections || []),
        query.normalizedQuery,
        "latest recent new recent judgment decision",
      ]).join(" ");

    case "issue_search":
    case "follow_up":
    case "unknown":
    default:
      return unique([
        query.caseTarget,
        ...comparisonTargets,
        ...citations,
        query.normalizedQuery,
      ]).join(" ");
  }
}