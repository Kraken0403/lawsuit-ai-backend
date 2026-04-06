import { qdrant } from "./client.js";
import { env } from "../config/env.js";
import { embedQuery } from "../embeddings/embed.js";
import type { ClassifiedQuery, RawChunkHit } from "../types/search.js";
import { buildHybridQueryText } from "../query/rewrite.js";
import {
  buildQdrantPayloadFilter,
  getRequestedCourtCodes,
} from "./payloadFilters.js";
import { canonicalizeCourt } from "../utils/courtResolver.js";

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

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
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
  if (query.intent === "issue_search") {
    return { sparseLimit: 70, denseLimit: 75, finalLimit: 40 };
  }

  switch (query.strategy) {
    case "citation_heavy":
      return { sparseLimit: 40, denseLimit: 0, finalLimit: 12 };

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
      return { sparseLimit: 55, denseLimit: 55, finalLimit: 28 };
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

function containsAnyLoose(text: string, patterns: string[]): boolean {
  const hay = normalizeLoose(text);
  return patterns.some((pattern) => hay.includes(normalizeLoose(pattern)));
}

type IssueConceptGroup = {
  patterns: string[];
  required: boolean;
  hitBoost: number;
  missPenalty: number;
};

function getIssueConceptGroups(query: ClassifiedQuery): IssueConceptGroup[] {
  if (query.intent !== "issue_search") return [];

  const q = normalizeLoose(query.normalizedQuery || query.originalQuery || "");
  const lowerCourtHints = (query.filters?.lowerCourtHints || []).map((x) =>
    normalizeLoose(x)
  );
  const groups: IssueConceptGroup[] = [];

  const hasFakeCitation =
    /\bnon[\s-]?existent\b|\bdoes not exist\b|\bnot exist\b|\bfabricated\b|\bfalse citation\b|\bfake citation\b|\bwrong citation\b|\bbogus\b|\bimaginary\b|\bforged\b|\bfraud on court\b/.test(
      q
    );

  const hasSupremeCourt = /\bsupreme court\b|\bsc\b/.test(q);

  const hasLowerCourt =
    /\bcivil court\b|\btrial court\b|\bsubordinate court\b|\bcivil judge\b|\bdistrict judge\b|\bsessions court\b/.test(
      q
    ) || lowerCourtHints.length > 0;

  const hasAction =
    /\baction\b|\bdisciplinary\b|\bstrictures?\b|\badverse remarks?\b|\bproceedings against\b|\bmisconduct\b|\breprimand\b|\bsupervisory\b/.test(
      q
    );

  if (hasFakeCitation) {
    groups.push({
      patterns: [
        "non existent",
        "non-existent",
        "does not exist",
        "did not exist",
        "fabricated",
        "false citation",
        "fake citation",
        "wrong citation",
        "bogus citation",
        "imaginary judgment",
        "non existent precedent",
        "non existent supreme court judgment",
        "forged supreme court order",
        "fraud on court",
        "fake supreme court judgment",
      ],
      required: true,
      hitBoost: 1.15,
      missPenalty: 0.8,
    });
  }

  if (hasSupremeCourt) {
    groups.push({
      patterns: [
        "supreme court",
        "supreme court judgment",
        "supreme court decision",
        "supreme court case",
        "supreme court order",
        "supreme court precedent",
      ],
      required: true,
      hitBoost: 0.6,
      missPenalty: 0.3,
    });
  }

  if (hasLowerCourt) {
    groups.push({
      patterns: [
        "civil court",
        "trial court",
        "subordinate court",
        "civil judge",
        "district judge",
        "lower court",
        "sessions court",
        "principal civil judge",
        "city civil court",
        "jmfc",
        "magistrate",
      ],
      required: true,
      hitBoost: 0.85,
      missPenalty: 0.45,
    });
  }

  if (hasAction) {
    groups.push({
      patterns: [
        "disciplinary action",
        "departmental inquiry",
        "strictures",
        "adverse remarks",
        "proceedings against",
        "misconduct",
        "action against",
        "reprimand",
        "strictures against",
        "supervisory jurisdiction",
        "administrative side",
      ],
      required: true,
      hitBoost: 0.95,
      missPenalty: 0.5,
    });
  }

  return groups;
}

function scoreIssueSearchConcepts(hit: RawChunkHit, query: ClassifiedQuery): number {
  const groups = getIssueConceptGroups(query);
  if (!groups.length) return 0;

  const hay = normalizeLoose(
    [
      hit.title || "",
      hit.text || "",
      String(hit.payload?.court || ""),
      String(hit.payload?.courtName || ""),
      String(hit.payload?.subject || ""),
      String(hit.payload?.finalDecision || ""),
      String(hit.payload?.caseType || ""),
    ].join(" ")
  );

  let score = 0;
  let matchedGroups = 0;

  for (const group of groups) {
    const matched = containsAnyLoose(hay, group.patterns);

    if (matched) {
      score += group.hitBoost;
      matchedGroups += 1;
    } else if (group.required) {
      score -= group.missPenalty;
    }
  }

  if (matchedGroups >= Math.max(2, groups.length - 1)) {
    score += 0.65;
  }

  if (groups.length >= 3 && matchedGroups <= 1) {
    score -= 0.85;
  }

  return score;
}

function expandOriginAliases(term: string): string[] {
  const t = normalizeLoose(term);
  const map: Record<string, string[]> = {
    gujarat: ["gujarat", "state of gujarat", "from gujarat", "saurashtra", "kutch"],
    maharashtra: ["maharashtra", "state of maharashtra", "from bombay", "from maharashtra", "bombay", "mumbai"],
    delhi: ["delhi", "state of delhi", "from delhi"],
    karnataka: ["karnataka", "state of karnataka", "from karnataka"],
    tamilnadu: ["tamil nadu", "state of tamil nadu", "from madras", "from tamil nadu", "madras"],
    westbengal: ["west bengal", "state of west bengal", "from calcutta", "from west bengal", "calcutta"],
    uttarpradesh: ["uttar pradesh", "state of uttar pradesh", "from allahabad", "from uttar pradesh", "allahabad"],
    madhyapradesh: ["madhya pradesh", "state of madhya pradesh", "from madhya pradesh"],
    kerala: ["kerala", "state of kerala", "from kerala"],
    rajasthan: ["rajasthan", "state of rajasthan", "from rajasthan"],
    bihar: ["bihar", "state of bihar", "from bihar", "from patna"],
    odisha: ["odisha", "orissa", "state of odisha", "state of orissa", "from orissa", "from odisha"],
  };

  const key = t.replace(/\s+/g, "");
  return unique(map[key] || [t, `state of ${t}`, `from ${t}`]);
}

function scoreOriginStateForTransferredOrAppealedCase(
  hit: RawChunkHit,
  query: ClassifiedQuery
): number {
  const rawTerms = [
    ...(query.filters?.originJurisdiction || []),
    ...(!(query.filters?.originJurisdiction || []).length
      ? query.filters?.jurisdiction || []
      : []),
  ].map((j) => normalizeLoose(j));

  if (!rawTerms.length) return 0;

  const aliasTerms = unique(rawTerms.flatMap(expandOriginAliases));
  const payload = hit.payload || {};
  const court = String(payload.court || "");
  const courtName = String(payload.courtName || "");
  const state = String(payload.state || "");
  const jurisdiction = String(payload.jurisdiction || "");
  const title = String(hit.title || "");
  const text = String(hit.text || "");

  const hay = normalizeLoose(
    [court, courtName, state, jurisdiction, title, text].join(" ")
  );
  const courtOnly = normalizeLoose([court, courtName].join(" "));

  let score = 0;
  let matchedAny = false;

  for (const term of aliasTerms) {
    if (!term) continue;

    if (courtOnly.includes(term)) {
      score += term.startsWith("from ") ? 1.9 : 0.95;
      matchedAny = true;
    } else if (hay.includes(term)) {
      score += term.startsWith("state of ") ? 0.95 : 0.45;
      matchedAny = true;
    }
  }

  if (!matchedAny && /\bfrom\b/.test(courtOnly)) {
    score -= 0.6;
  }

  return score;
}

function expandLowerCourtHintPatterns(lowerCourtHints: string[]): string[] {
  const out: string[] = [];

  for (const rawHint of lowerCourtHints) {
    const hint = normalizeLoose(rawHint);

    if (hint.includes("civil court")) {
      out.push(
        "civil court",
        "principal civil judge",
        "city civil court",
        "civil judge",
        "district court",
        "subordinate court"
      );
      continue;
    }

    if (hint.includes("trial court")) {
      out.push(
        "trial court",
        "sessions court",
        "district and sessions judge",
        "principal sessions judge",
        "trial judge",
        "magistrate",
        "jmfc"
      );
      continue;
    }

    if (hint.includes("subordinate")) {
      out.push(
        "subordinate court",
        "trial court",
        "civil judge",
        "district judge",
        "sessions judge",
        "magistrate"
      );
      continue;
    }

    out.push(hint);
  }

  return unique(out);
}

function scoreLowerCourtHints(hit: RawChunkHit, query: ClassifiedQuery): number {
  const lowerHints = query.filters?.lowerCourtHints || [];
  if (!lowerHints.length) return 0;

  const patterns = expandLowerCourtHintPatterns(lowerHints);
  const hay = normalizeLoose(
    [
      hit.title || "",
      hit.text || "",
      String(hit.payload?.court || ""),
      String(hit.payload?.courtName || ""),
      String(hit.payload?.subject || ""),
      String(hit.payload?.caseType || ""),
    ].join(" ")
  );

  let score = 0;
  let matched = 0;

  for (const pattern of patterns) {
    if (hay.includes(pattern)) {
      matched += 1;
      score += 0.42;
    }
  }

  if (matched > 0) {
    score += Math.min(matched, 3) * 0.18;
  } else if (query.intent === "issue_search") {
    score -= 0.45;
  }

  return score;
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
      String(payload.finalDecision || ""),
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
  const requestedCourtCodes = getRequestedCourtCodes(query);
  const hitCourtCode = canonicalizeCourt(
    (hit.payload || {}) as Record<string, unknown>
  ).code;

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

  if (requestedCourtCodes.length) {
    if (hitCourtCode && requestedCourtCodes.includes(hitCourtCode)) {
      score += 1.45;
    } else {
      score -= 1.1;
    }
  } else if (filters.courts?.length) {
    const matched = filters.courts.some((court) => blob.includes(normalize(court)));
    score += matched ? 0.95 : -0.7;
  }

  if (filters.jurisdiction?.length) {
    const matched = filters.jurisdiction.some((j) => blob.includes(normalize(j)));
    score += matched ? 0.7 : -0.45;
  }

  score += scoreOriginStateForTransferredOrAppealedCase(hit, query);
  score += scoreLowerCourtHints(hit, query);

  if (filters.subjects?.length) {
    const matched = filters.subjects.some((s) => blob.includes(normalize(s)));

    if (matched) {
      score += 0.9;
    } else if (query.intent !== "issue_search") {
      score -= 0.55;
    }
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

  score += scoreIssueSearchConcepts(hit, query);

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
  const payloadFilter = buildQdrantPayloadFilter(classified);

  const sparsePrefetch: any = {
    query: {
      text: hybridText,
      model: "Qdrant/bm25",
    },
    using: "sparse",
    limit: limits.sparseLimit,
  };

  if (payloadFilter) {
    sparsePrefetch.filter = payloadFilter;
  }

  const prefetch: any[] = [sparsePrefetch];

  if (!skipDense && limits.denseLimit > 0) {
    const denseInput =
      classified.caseTarget && isDirectCaseLookupIntent(classified.intent)
        ? classified.caseTarget
        : classified.normalizedQuery;

    const denseVector = await embedQuery(denseInput);

    const densePrefetch: any = {
      query: denseVector,
      using: "dense",
      limit: limits.denseLimit,
    };

    if (payloadFilter) {
      densePrefetch.filter = payloadFilter;
    }

    prefetch.push(densePrefetch);
  }

  const queryRequest: any = {
    prefetch,
    query: {
      fusion: "rrf",
    },
    limit: limit ?? limits.finalLimit,
    with_payload: true,
  };

  if (payloadFilter) {
    queryRequest.filter = payloadFilter;
  }

  const results = await qdrant.query(env.qdrant.collection, queryRequest);

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