import { qdrant } from "./client.js";
import { env } from "../config/env.js";
import { embedQuery } from "../embeddings/embed.js";
import type { ClassifiedQuery, RawChunkHit } from "../types/search.js";
import { buildHybridQueryText } from "../query/rewrite.js";

function normalize(text: string | null | undefined): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLoose(text: string | null | undefined): string {
  return (text || "")
    .toLowerCase()
    .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchStrength(title: string, target: string): 0 | 1 | 2 | 3 {
  const t1 = normalizeLoose(title);
  const t2 = normalizeLoose(target);

  if (!t1 || !t2) return 0;
  if (t1 === t2) return 3;
  if (t1.includes(t2) || t2.includes(t1)) return 2;

  const titleTokens = new Set(t1.split(" ").filter(Boolean));
  const targetTokens = t2.split(" ").filter(Boolean);
  const overlap = targetTokens.filter((tok) => titleTokens.has(tok)).length;
  const ratio = overlap / Math.max(1, targetTokens.length);

  if (ratio >= 0.8) return 2;
  if (ratio >= 0.6) return 1;
  return 0;
}

function isDirectCaseLookupIntent(intent: ClassifiedQuery["intent"]): boolean {
  return (
    intent === "case_lookup" ||
    intent === "full_judgment" ||
    intent === "metadata_lookup"
  );
}

function toChunkHit(result: any): RawChunkHit {
  const payload = (result.payload || {}) as Record<string, unknown>;

  return {
    id: result.id,
    score: result.score ?? 0,
    caseId: Number(payload.caseId),
    chunkId: String(payload.chunkId || ""),
    title: payload.title ? String(payload.title) : null,
    citation: payload.citation ? String(payload.citation) : null,
    paragraphStart:
      payload.paragraphStart != null ? Number(payload.paragraphStart) : null,
    paragraphEnd:
      payload.paragraphEnd != null ? Number(payload.paragraphEnd) : null,
    text: String(payload.text || ""),
    payload,
  };
}
function getPrefetchLimits(query: ClassifiedQuery): {
  sparseLimit: number;
  denseLimit: number;
  finalLimit: number;
} {
  switch (query.strategy) {
    case "citation_heavy":
      return { sparseLimit: 40, denseLimit: 0, finalLimit: 12 };

    // Restore stronger recall for latest/recent retrieval
    case "recency_heavy":
      return { sparseLimit: 70, denseLimit: 36, finalLimit: 40 };

    case "sparse_heavy":
      return { sparseLimit: 60, denseLimit: 16, finalLimit: 24 };

    case "dense_heavy":
      return { sparseLimit: 20, denseLimit: 48, finalLimit: 24 };

    case "metadata_heavy":
      return { sparseLimit: 36, denseLimit: 16, finalLimit: 16 };

    case "balanced":
    default:
      return { sparseLimit: 45, denseLimit: 45, finalLimit: 20 };
  }
}

function shouldSkipDense(query: ClassifiedQuery): boolean {
  return (
    query.strategy === "citation_heavy" &&
    !query.caseTarget &&
    !(query.comparisonTargets?.length)
  );
}

function parseDecisionTime(payload: Record<string, unknown>): number | null {
  const candidates = [
    payload.dateOfDecision,
    payload.decisionDate,
    payload.judgmentDate,
    payload.date,
    payload.year,
  ];

  for (const value of candidates) {
    if (value == null) continue;

    if (typeof value === "number" && Number.isFinite(value)) {
      if (value > 1800 && value < 3000) {
        return new Date(`${value}-01-01`).getTime();
      }
    }

    const text = String(value).trim();
    if (!text) continue;

    const yearOnly = text.match(/\b(19|20)\d{2}\b/);
    if (yearOnly && yearOnly[0].length === text.length) {
      return new Date(`${text}-01-01`).getTime();
    }

    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}

function extractCaseTypeHints(query: ClassifiedQuery): string[] {
  const q = normalizeLoose(query.normalizedQuery || query.originalQuery || "");
  const hints: string[] = [];

  const patterns = [
    "writ petition",
    "criminal appeal",
    "civil appeal",
    "special leave petition",
    "slp",
    "review petition",
    "revision petition",
    "transfer petition",
    "writ appeal",
    "letters patent appeal",
    "public interest litigation",
    "pil",
    "bail application",
  ];

  for (const p of patterns) {
    if (q.includes(p)) hints.push(p);
  }

  return [...new Set(hints)];
}

function payloadBlob(hit: RawChunkHit): string {
  const payload = hit.payload || {};
  const acts = Array.isArray(payload.actsReferred)
    ? payload.actsReferred.join(" ")
    : "";
  const judges = Array.isArray(payload.judges) ? payload.judges.join(" ") : "";
  const eqCitations = Array.isArray(payload.equivalentCitations)
    ? payload.equivalentCitations.join(" ")
    : "";

  return normalize(
    [
      hit.title || "",
      hit.citation || "",
      hit.text || "",
      String(payload.court || ""),
      String(payload.courtName || ""),
      String(payload.jurisdiction || ""),
      String(payload.state || ""),
      String(payload.bench || ""),
      String(payload.subject || ""),
      String(payload.caseType || ""),
      acts,
      judges,
      eqCitations,
      String(payload.dateOfDecision || ""),
    ].join(" ")
  );
}

function postScoreHit(hit: RawChunkHit, query: ClassifiedQuery): number {
  let score = hit.score ?? 0;

  const title = normalize(hit.title);
  const text = normalize(hit.text);
  const normalizedQuery = normalize(query.normalizedQuery);
  const blob = payloadBlob(hit);
  const filters = query.filters || {};
  const caseTypeHints = extractCaseTypeHints(query);

  if (query.caseTarget) {
    const target = normalize(query.caseTarget);
    const titleStrength = titleMatchStrength(hit.title || "", query.caseTarget);

    if (isDirectCaseLookupIntent(query.intent)) {
      if (titleStrength === 3) score += 3.2;
      else if (titleStrength === 2) score += 2.2;
      else if (titleStrength === 1) score += 0.45;
      else score -= 1.85;

      if (titleStrength === 0 && text.includes(target)) {
        score -= 0.35;
      }
    } else {
      if (title === target) score += 0.4;
      else if (title.includes(target) || target.includes(title)) score += 0.25;

      if (text.includes(target)) score += 0.08;
    }
  }

  if (query.comparisonTargets?.length) {
    let matches = 0;

    for (const targetRaw of query.comparisonTargets) {
      const target = normalize(targetRaw);
      if (!target) continue;

      const strength = titleMatchStrength(hit.title || "", targetRaw);

      if (strength === 3) {
        score += 0.35;
        matches += 1;
      } else if (strength >= 2) {
        score += 0.22;
        matches += 1;
      } else if (text.includes(target)) {
        score += 0.07;
      }
    }

    if (matches >= 2) score += 0.22;
  }

  if (query.citations?.length) {
    let strongCitationMatch = false;

    for (const citation of query.citations) {
      const c = normalize(citation);
      const hitCitation = normalize(hit.citation);
      const equivalent = Array.isArray(hit.payload?.equivalentCitations)
        ? hit.payload.equivalentCitations.map((x: unknown) => normalize(String(x)))
        : [];

      if (hitCitation === c) {
        score += 4.5;
        strongCitationMatch = true;
      } else if (hitCitation.includes(c) || c.includes(hitCitation)) {
        score += 2.2;
      }

      if (equivalent.includes(c)) {
        score += 3.6;
        strongCitationMatch = true;
      }

      if (text.includes(c)) score += 0.8;
    }

    if (query.strategy === "citation_heavy" && !strongCitationMatch) {
      score -= 2.0;
    }
  }

  if (query.exactTerms?.length) {
    for (const ref of query.exactTerms) {
      const r = normalize(ref);
      if (text.includes(r)) score += 0.12;
    }
  }

  if (query.intent === "holding_search") {
    if (
      /\bheld\b|\bholding\b|\bwe hold\b|\bit is held\b|\btherefore\b|\bwe conclude\b/i.test(
        hit.text
      )
    ) {
      score += 0.16;
    }
  }

  const doctrineStyle =
    query.intent === "issue_search" &&
    /basic structure|doctrine|evolution|history|jurisprudence|constitutional framework/i.test(
      query.normalizedQuery
    );

  if (doctrineStyle) {
    if (/kesavananda/i.test(title)) score += 0.55;
    if (/golak/i.test(title)) score += 0.28;
    if (/minerva/i.test(title)) score += 0.28;
    if (/indira/i.test(title)) score += 0.24;
    if (/coelho/i.test(title)) score += 0.2;
    if (/waman/i.test(title)) score += 0.18;

    const citedCount =
      typeof hit.payload?.cited === "number"
        ? hit.payload.cited
        : Number(hit.payload?.cited || 0);

    if (Number.isFinite(citedCount) && citedCount > 0) {
      score += Math.min(citedCount, 100) * 0.012;
    }
  }

  if (filters.courts?.length) {
    const matched = filters.courts.some((court) => blob.includes(normalize(court)));
    score += matched ? 0.95 : -0.7;
  }

  if (filters.jurisdiction?.length) {
    const matched = filters.jurisdiction.some((j) => blob.includes(normalize(j)));
    score += matched ? 0.7 : -0.45;
  }

  if (filters.subjects?.length) {
    const matched = filters.subjects.some((s) => blob.includes(normalize(s)));
    score += matched ? 0.9 : -0.55;
  }

  if (filters.statutes?.length) {
    const matched = filters.statutes.some((s) => blob.includes(normalize(s)));
    score += matched ? 0.7 : -0.35;
  }

  if (filters.sections?.length) {
    const matched = filters.sections.some((s) => blob.includes(normalize(s)));
    score += matched ? 0.7 : -0.35;
  }

  if (caseTypeHints.length) {
    const matched = caseTypeHints.some((hint) => blob.includes(normalize(hint)));
    score += matched ? 0.5 : -0.2;
  }

  if (query.strategy === "recency_heavy" || query.intent === "latest_cases") {
    const decisionTime = parseDecisionTime(hit.payload || {});
    if (decisionTime) {
      const ageDays = Math.max(
        0,
        (Date.now() - decisionTime) / (1000 * 60 * 60 * 24)
      );

      if (ageDays <= 30) score += 1.4;
      else if (ageDays <= 180) score += 1.0;
      else if (ageDays <= 365) score += 0.7;
      else if (ageDays <= 3 * 365) score += 0.25;
      else score -= 0.35;
    } else {
      score -= 0.25;
    }
  }

  if (normalizedQuery.split(" ").length > 18) {
    if (hit.text.length > 300) score += 0.03;
  }

  return score;
}

export async function runHybridSearch(
  classified: ClassifiedQuery,
  limit?: number
): Promise<RawChunkHit[]> {
  const hybridText = buildHybridQueryText(classified);
  const limits = getPrefetchLimits(classified);
  const skipDense = shouldSkipDense(classified);

  const prefetch: any[] = [
    {
      query: {
        text: hybridText,
        model: "Qdrant/bm25",
      },
      using: "sparse",
      limit: limits.sparseLimit,
    },
  ];

  if (!skipDense && limits.denseLimit > 0) {
    const denseInput =
      classified.caseTarget && isDirectCaseLookupIntent(classified.intent)
        ? classified.caseTarget
        : classified.normalizedQuery;

    const denseVector = await embedQuery(denseInput);

    prefetch.push({
      query: denseVector,
      using: "dense",
      limit: limits.denseLimit,
    });
  }

  const results = await qdrant.query(env.qdrant.collection, {
    prefetch,
    query: {
      fusion: "rrf",
    },
    limit: limit ?? limits.finalLimit,
    with_payload: true,
  });

  const points = Array.isArray((results as any).points)
    ? (results as any).points
    : (results as any);

  return points
    .map(toChunkHit)
    .map((hit) => ({
      ...hit,
      score: postScoreHit(hit, classified),
    }))
    .sort((a, b) => b.score - a.score);
}