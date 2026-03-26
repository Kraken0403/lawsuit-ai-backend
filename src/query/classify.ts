import type {
  ClassifiedQuery,
  MetadataField,
  QueryIntent,
  QueryStrategy,
} from "../types/search.js";
import { normalizeQuery } from "./normalize.js";
import { extractCaseTarget } from "./extractCaseTarget.js";
import { extractComparisonTargets } from "./extractComparisonTargets.js";

const ARTICLE_PATTERN = /\bart(?:icle)?\.?\s*\d+[a-z0-9()/-]*/gi;
const SECTION_PATTERN = /\bsec(?:tion)?\.?\s*\d+[a-z0-9()/-]*/gi;
const ORDER_RULE_PATTERN = /\border\s+\d+[a-z0-9()/-]*\s+rule\s+\d+[a-z0-9()/-]*/gi;
const RULE_ONLY_PATTERN = /\brule\s+\d+[a-z0-9()/-]*/gi;

const CITATION_PATTERNS = [
  /\b\d{4}\s+lawsuit\s*\([^)]+\)\s*\d+\b/gi,
  /\b\d{4}\s+scr\s+\d+\b/gi,
  /\b\d{4}\s+scc\s+\d+\b/gi,
  /\bair\s*\d{4}\s*[a-z() ]*\s*\d+\b/gi,
];

function findAllMatches(pattern: RegExp, text: string): string[] {
  const matches = text.match(pattern);
  return matches ? [...new Set(matches.map((m) => m.trim()))] : [];
}

function detectMetadataField(query: string): MetadataField | null {
  const q = query.toLowerCase();

  if (/\bequivalent citation\b|\bequivalent citations\b/.test(q)) return "equivalentCitations";
  if (/\bacts referred\b|\bact referred\b/.test(q)) return "actsReferred";
  if (/\bsubject\b/.test(q)) return "subject";
  if (/\bfinal decision\b/.test(q)) return "finalDecision";
  if (/\badvocates\b|\badvocate\b/.test(q)) return "advocates";
  if (/\bjudges\b|\bjudge\b|\bbench\b/.test(q)) return "judges";

  if (
    /\bwhich court\b/.test(q) ||
    /\bwhat court\b/.test(q) ||
    /\bcourt for\b/.test(q) ||
    /\bcourt of\b/.test(q) ||
    /\bdecided by which court\b/.test(q)
  ) {
    return "court";
  }

  if (/\bcitation\b/.test(q)) return "citation";
  if (/\bdate of decision\b|\bdate decided\b/.test(q)) return "dateOfDecision";
  if (/\bcase number\b|\bcase no\b/.test(q)) return "caseNo";
  if (/\bcase type\b/.test(q)) return "caseType";

  return null;
}

function isFullJudgmentQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("full judgment") ||
    q.includes("complete judgment") ||
    q.includes("complete text") ||
    q.includes("entire judgment") ||
    q.includes("full case") ||
    q.includes("complete case")
  );
}

function isComparisonQuery(query: string, comparisonTargets: string[]): boolean {
  const q = query.toLowerCase();
  return (
    comparisonTargets.length >= 2 &&
    (
      q.includes("compare") ||
      q.includes("difference between") ||
      q.includes("distinguish")
    )
  );
}

function inferIntent(
  normalizedQuery: string,
  caseTarget: string | null,
  metadataField: MetadataField | null,
  comparisonTargets: string[]
): {
  intent: QueryIntent;
  confidence: number;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (isFullJudgmentQuery(normalizedQuery)) {
    reasons.push("matched full judgment wording");
    return { intent: "full_judgment", confidence: 0.97, reasons };
  }

  if (isComparisonQuery(normalizedQuery, comparisonTargets)) {
    reasons.push("matched comparison wording");
    return { intent: "comparison", confidence: 0.93, reasons };
  }

  if (metadataField && caseTarget) {
    reasons.push("matched metadata field with case target");
    return { intent: "metadata_lookup", confidence: 0.95, reasons };
  }

  reasons.push("defaulted to hybrid");
  if (caseTarget) reasons.push("case target extracted");

  return {
    intent: "hybrid",
    confidence: caseTarget ? 0.84 : 0.68,
    reasons,
  };
}

function inferStrategy(intent: QueryIntent): QueryStrategy {
  switch (intent) {
    case "metadata_lookup":
      return "metadata_heavy";
    case "full_judgment":
      return "full_judgment";
    case "comparison":
      return "balanced";
    case "hybrid":
    default:
      return "balanced";
  }
}

export function classifyQuery(query: string): ClassifiedQuery {
  const normalizedQuery = normalizeQuery(query);
  const caseTarget = extractCaseTarget(normalizedQuery);
  const comparisonTargets = extractComparisonTargets(normalizedQuery);
  const metadataField = detectMetadataField(normalizedQuery);

  const exactTerms = [
    ...findAllMatches(ARTICLE_PATTERN, normalizedQuery),
    ...findAllMatches(SECTION_PATTERN, normalizedQuery),
    ...findAllMatches(ORDER_RULE_PATTERN, normalizedQuery),
    ...findAllMatches(RULE_ONLY_PATTERN, normalizedQuery),
  ];

  const citations = CITATION_PATTERNS.flatMap((rx) =>
    findAllMatches(rx, normalizedQuery)
  );

  const { intent, confidence, reasons } = inferIntent(
    normalizedQuery,
    caseTarget,
    metadataField,
    comparisonTargets
  );

  const caseHints =
    comparisonTargets.length > 0
      ? comparisonTargets
      : caseTarget
        ? [caseTarget]
        : [];

  return {
    originalQuery: query,
    normalizedQuery,
    intent,
    confidence,
    exactTerms,
    citations,
    caseHints,
    caseTarget,
    metadataField,
    referenceTerms: [...exactTerms, ...citations],
    comparisonTargets,
    followUpLikely: /\bthis case\b|\bthat case\b|\bthis judgment\b|\bthat judgment\b/i.test(
      normalizedQuery
    ),
    strategy: inferStrategy(intent),
    reasons,
  };
}