import { qdrant } from "./client.js";
import { env } from "../config/env.js";
import type { ClassifiedQuery, RawChunkHit } from "../types/search.js";

function compact(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeLoose(text: string | null | undefined): string {
  return (text || "")
    .toLowerCase()
    .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableQdrantError(error: any): boolean {
  const msg = String(error?.message || "").toLowerCase();
  const causeMsg = String(error?.cause?.message || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();

  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    causeMsg.includes("econnreset") ||
    causeMsg.includes("timed out") ||
    causeMsg.includes("socket hang up")
  );
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

function toChunkHit(point: any): RawChunkHit {
  const payload = (point.payload || {}) as Record<string, unknown>;

  return {
    id: point.id,
    score: 0,
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

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function getCaseTargetTokens(caseTarget: string | null | undefined): string[] {
  if (!caseTarget) return [];

  const stop = new Set([
    "case",
    "matter",
    "state",
    "union",
    "india",
    "and",
    "ors",
    "anr",
    "the",
    "of",
    "in",
    "re",
    "vs",
    "v",
    "versus",
  ]);

  return unique(
    normalizeLoose(caseTarget)
      .split(" ")
      .filter((tok) => tok.length >= 3 && !stop.has(tok))
  );
}

function getCitationTokens(citation: string | null | undefined): string[] {
  if (!citation) return [];

  return unique(
    normalizeLoose(citation)
      .split(" ")
      .filter((tok) => tok.length >= 2)
  );
}

function getCitationVariants(citation: string | null | undefined): string[] {
  const base = compact(citation);
  if (!base) return [];

  const loose = normalizeLoose(base);
  const tokens = loose.split(" ").filter((tok) => tok.length >= 2);
  const out = new Set<string>([base, loose, tokens.join(" ")]);

  const yearIndex = tokens.findIndex((tok) => /^(19|20)\d{2}$/.test(tok));
  if (yearIndex > 0) {
    out.add(
      [tokens[yearIndex], ...tokens.slice(0, yearIndex), ...tokens.slice(yearIndex + 1)].join(
        " "
      )
    );
  }

  if (tokens.length >= 3) {
    out.add([...tokens].sort().join(" "));
  }

  return [...out].filter(Boolean);
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

function includesLoose(haystack: string, needle: string): boolean {
  const h = normalizeLoose(haystack);
  const n = normalizeLoose(needle);
  if (!h || !n) return false;
  return h.includes(n) || n.includes(h);
}

function arrayIncludesLoose(values: string[], needle: string): boolean {
  const n = normalizeLoose(needle);
  if (!n) return false;

  return values.some((v) => {
    const x = normalizeLoose(v);
    return x === n || x.includes(n) || n.includes(x);
  });
}

function extractCaseTypeHints(classified: ClassifiedQuery): string[] {
  const q = normalizeLoose(classified.normalizedQuery || classified.originalQuery || "");
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

  return unique(hints);
}


function stripMetadataInstruction(text: string): string {
  let out = compact(text);
  if (!out) return "";

  out = out.replace(
    /^(give|find|show|tell me|what is|who were|who are)\s+/i,
    ""
  );

  out = out.replace(
    /^(the\s+)?(citation|court|judges?|judge|date of decision|decision date|case number|case no|acts referred|subject|final decision|advocates|case type)\s+(of|for)\s+/i,
    ""
  );

  out = out.replace(
    /\s+\b(citation|court|judges?|judge|date of decision|decision date|case number|case no|acts referred|subject|final decision|advocates|case type)\b\s*$/i,
    ""
  );

  return compact(out);
}

function getCaseTargetVariants(classified: ClassifiedQuery): string[] {
  const rawCandidates = [
    classified.caseTarget,
    ...(classified.caseHints || []),
    ...(classified.referenceTerms || []),
    ...(classified.exactTerms || []),
  ];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of rawCandidates) {
    const cleaned = stripMetadataInstruction(String(candidate || ""));
    if (!cleaned || cleaned.length < 4) continue;

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }

  return out.sort((a, b) => b.length - a.length);
}

type RankedFilter = {
  priority: number;
  filter: any;
};

function getMetadataSearchPlan(classified: ClassifiedQuery) {
  if (classified.strategy === "citation_heavy") {
    return {
      filtersToRun: 4,
      pointLimit: 24,
      maxPages: 1,
      pageSize: 16,
      concurrency: 4,
    };
  }

  if (classified.intent === "metadata_lookup") {
    return {
      filtersToRun: 6,
      pointLimit: 30,
      maxPages: 1,
      pageSize: 20,
      concurrency: 4,
    };
  }

  if (classified.intent === "latest_cases" || classified.strategy === "recency_heavy") {
    return {
      filtersToRun: 8,
      pointLimit: 45,
      maxPages: 2,
      pageSize: 25,
      concurrency: 4,
    };
  }

  return {
    filtersToRun: 8,
    pointLimit: 40,
    maxPages: 2,
    pageSize: 25,
    concurrency: 4,
  };
}

function buildMetadataFilters(classified: ClassifiedQuery): RankedFilter[] {
  const ranked: RankedFilter[] = [];
  const seen = new Set<string>();

  const pushFilter = (priority: number, filter: any) => {
    const key = JSON.stringify(filter);
    if (!seen.has(key)) {
      seen.add(key);
      ranked.push({ priority, filter });
    }
  };

  const filtersInput = classified.filters || {};
  const caseTypeHints = extractCaseTypeHints(classified);

  const caseTargetVariants = getCaseTargetVariants(classified);

  for (const [index, target] of caseTargetVariants.slice(0, 5).entries()) {
    const tokens = getCaseTargetTokens(target);
    const basePriority = Math.max(60, 100 - index * 8);

    pushFilter(basePriority, {
      must: [{ key: "title", match: { phrase: target } }],
    });

    pushFilter(basePriority - 10, {
      must: [{ key: "title", match: { text: target } }],
    });

    if (tokens.length >= 2) {
      pushFilter(basePriority - 20, {
        must: tokens.slice(0, 4).map((token) => ({
          key: "title",
          match: { text: token },
        })),
      });
    }
  }

  for (const rawCitation of classified.citations || []) {
    for (const citation of getCitationVariants(rawCitation)) {
      const citationTokens = getCitationTokens(citation);

      pushFilter(120, {
        must: [{ key: "citation", match: { value: citation } }],
      });

      pushFilter(118, {
        must: [{ key: "equivalentCitations", match: { value: citation } }],
      });

      pushFilter(105, {
        must: [{ key: "citation", match: { text: citation } }],
      });

      pushFilter(102, {
        must: [{ key: "equivalentCitations", match: { text: citation } }],
      });

      pushFilter(96, {
        must: [{ key: "text", match: { text: citation } }],
      });

      if (citationTokens.length >= 3) {
        pushFilter(92, {
          must: citationTokens.slice(0, 4).map((token) => ({
            key: "equivalentCitations",
            match: { text: token },
          })),
        });

        pushFilter(88, {
          must: citationTokens.slice(0, 4).map((token) => ({
            key: "citation",
            match: { text: token },
          })),
        });

        pushFilter(84, {
          must: citationTokens.slice(0, 4).map((token) => ({
            key: "text",
            match: { text: token },
          })),
        });
      }
    }
  }

  for (const court of filtersInput.courts || []) {
    pushFilter(52, {
      must: [{ key: "court", match: { text: court } }],
    });
  }

  for (const subject of filtersInput.subjects || []) {
    pushFilter(48, {
      must: [{ key: "subject", match: { text: subject } }],
    });
  }

  for (const statute of filtersInput.statutes || []) {
    pushFilter(44, {
      must: [{ key: "actsReferred", match: { value: statute } }],
    });

    pushFilter(40, {
      must: [{ key: "actsReferred", match: { text: statute } }],
    });
  }

  for (const section of filtersInput.sections || []) {
    pushFilter(44, {
      must: [{ key: "actsReferred", match: { value: section } }],
    });

    pushFilter(40, {
      must: [{ key: "actsReferred", match: { text: section } }],
    });
  }

  for (const hint of caseTypeHints) {
    pushFilter(34, {
      must: [{ key: "caseType", match: { text: hint } }],
    });
  }

  return ranked.sort((a, b) => b.priority - a.priority);
}

async function runScroll(
  filter: any,
  opts: { pointLimit?: number; maxPages?: number; pageSize?: number } = {}
): Promise<any[]> {
  const pointLimit = opts.pointLimit ?? 80;
  const maxPages = opts.maxPages ?? 2;
  const pageSize = opts.pageSize ?? 25;

  const points: any[] = [];
  let offset: string | number | undefined = undefined;
  let pages = 0;

  while (points.length < pointLimit && pages < maxPages) {
    let response: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await qdrant.scroll(env.qdrant.collection, {
          filter,
          limit: Math.min(pageSize, pointLimit - points.length),
          with_payload: true,
          with_vector: false,
          offset,
        });
        lastError = null;
        break;
      } catch (error: any) {
        lastError = error;

        if (!isRetryableQdrantError(error) || attempt === 3) {
          throw error;
        }

        const waitMs = 250 * attempt;
        console.warn(
          `[metadataSearch] qdrant.scroll retry ${attempt}/3 after ${waitMs}ms:`,
          error?.cause?.code || error?.message || error
        );
        await sleep(waitMs);
      }
    }

    if (!response) {
      throw lastError || new Error("qdrant.scroll failed with empty response");
    }

    const batch = response.points || [];
    if (batch.length === 0) break;

    points.push(...batch);
    pages += 1;

    if (!response.next_page_offset) break;
    offset = response.next_page_offset;
  }

  return points;
}

function scoreMetadataHit(hit: RawChunkHit, classified: ClassifiedQuery): number {
  const payload = hit.payload || {};
  const filters = classified.filters || {};
  const caseTypeHints = extractCaseTypeHints(classified);

  const title = String(payload.title || "");
  const citation = String(payload.citation || "");
  const equivalentCitations = getStringArray(payload.equivalentCitations);
  const court = String(payload.court || "");
  const subject = String(payload.subject || "");
  const actsReferred = getStringArray(payload.actsReferred);
  const judges = getStringArray(payload.judges);
  const advocates = getStringArray(payload.advocates);
  const caseType = String(payload.caseType || "");
  const caseNo = String(payload.caseNo || "");
  const finalDecision = String(payload.finalDecision || "");
  const citedCount =
    typeof payload.cited === "number" ? payload.cited : Number(payload.cited || 0);

  let score = 0;

  const caseTargetVariants = getCaseTargetVariants(classified);

  if (caseTargetVariants.length) {
    let bestVariantScore = 0;

    for (const variant of caseTargetVariants.slice(0, 5)) {
      let variantScore = 0;

      const strength = titleMatchStrength(title, variant);
      if (strength === 3) variantScore += 180;
      else if (strength === 2) variantScore += 130;
      else if (strength === 1) variantScore += 55;

      const targetTokens = getCaseTargetTokens(variant);
      const titleLoose = normalizeLoose(title);
      const tokenMatches = targetTokens.filter((tok) => titleLoose.includes(tok)).length;

      variantScore += tokenMatches * 12;

      if (targetTokens.length > 0) {
        const ratio = tokenMatches / targetTokens.length;
        if (ratio >= 1) variantScore += 40;
        else if (ratio >= 0.8) variantScore += 24;
        else if (ratio >= 0.6) variantScore += 10;
      }

      if (variantScore > bestVariantScore) {
        bestVariantScore = variantScore;
      }
    }

    score += bestVariantScore;
  }

  for (const rawCitation of classified.citations || []) {
    for (const citationQuery of getCitationVariants(rawCitation)) {
      const queryLoose = normalizeLoose(citationQuery);
      const citationTokens = getCitationTokens(citationQuery);

      if (normalizeLoose(citation) === queryLoose) score += 220;
      if (equivalentCitations.some((c) => normalizeLoose(c) === queryLoose)) score += 190;

      if (includesLoose(citation, citationQuery)) score += 40;
      if (equivalentCitations.some((c) => includesLoose(c, citationQuery))) score += 35;
      if (includesLoose(hit.text || "", citationQuery)) score += 48;

      const citationLoose = normalizeLoose(citation);
      const eqLoose = equivalentCitations.map((c) => normalizeLoose(c));
      const textLoose = normalizeLoose(hit.text || "");

      const tokenHits =
        citationTokens.filter((t) => citationLoose.includes(t)).length +
        citationTokens.filter((t) => eqLoose.some((eq) => eq.includes(t))).length +
        citationTokens.filter((t) => textLoose.includes(t)).length;

      score += Math.min(tokenHits, 10) * 8;
    }
  }

  for (const courtFilter of filters.courts || []) {
    if (includesLoose(court, courtFilter)) score += 28;
  }

  for (const subjectFilter of filters.subjects || []) {
    if (includesLoose(subject, subjectFilter)) score += 24;
  }

  for (const statute of filters.statutes || []) {
    if (arrayIncludesLoose(actsReferred, statute)) score += 18;
  }

  for (const section of filters.sections || []) {
    if (arrayIncludesLoose(actsReferred, section)) score += 18;
  }

  for (const hint of caseTypeHints) {
    if (includesLoose(caseType, hint)) score += 20;
  }

  if (classified.metadataField) {
    switch (classified.metadataField) {
      case "court":
        if (court) score += 10;
        break;
      case "judges":
        if (judges.length) score += 10;
        break;
      case "dateOfDecision":
        if (payload.dateOfDecision) score += 10;
        break;
      case "caseNo":
        if (caseNo) score += 10;
        break;
      case "actsReferred":
        if (actsReferred.length) score += 10;
        break;
      case "subject":
        if (subject) score += 10;
        break;
      case "finalDecision":
        if (finalDecision) score += 10;
        break;
      case "advocates":
        if (advocates.length) score += 10;
        break;
      case "caseType":
        if (caseType) score += 10;
        break;
      case "citation":
      case "equivalentCitations":
        if (citation || equivalentCitations.length) score += 10;
        break;
      default:
        break;
    }
  }

  if (classified.intent === "latest_cases" || classified.strategy === "recency_heavy") {
    const decisionTime = parseDecisionTime(payload);
    if (decisionTime) {
      const ageDays = Math.max(
        0,
        (Date.now() - decisionTime) / (1000 * 60 * 60 * 24)
      );

      if (ageDays <= 30) score += 18;
      else if (ageDays <= 180) score += 14;
      else if (ageDays <= 365) score += 10;
      else if (ageDays <= 3 * 365) score += 5;
      else score -= 6;
    } else {
      score -= 4;
    }
  }

  if (Number.isFinite(citedCount) && citedCount > 0) {
    score += Math.min(citedCount, 100) * 0.08;
  }

  return score;
}

export async function runMetadataSearch(
  classified: ClassifiedQuery,
  limit = 24
): Promise<RawChunkHit[]> {
  const rankedFilters = buildMetadataFilters(classified);
  if (rankedFilters.length === 0) return [];

  const plan = getMetadataSearchPlan(classified);
  const filtersToRun = rankedFilters.slice(0, plan.filtersToRun);
  const byCase = new Map<number, RawChunkHit>();

  for (let i = 0; i < filtersToRun.length; i += plan.concurrency) {
    const batch = filtersToRun.slice(i, i + plan.concurrency);

    const settled = await Promise.allSettled(
      batch.map((entry) =>
        runScroll(entry.filter, {
          pointLimit: plan.pointLimit,
          maxPages: plan.maxPages,
          pageSize: plan.pageSize,
        })
      )
    );

    for (const result of settled) {
      if (result.status !== "fulfilled") {
        console.warn(
          "[metadataSearch] filter batch failed:",
          (result.reason as any)?.message || result.reason
        );
        continue;
      }

      for (const point of result.value) {
        const hit = toChunkHit(point);
        const scoredHit = {
          ...hit,
          score: scoreMetadataHit(hit, classified),
        };

        if (scoredHit.score <= 0) continue;

        const existing = byCase.get(scoredHit.caseId);
        if (!existing || scoredHit.score > existing.score) {
          byCase.set(scoredHit.caseId, scoredHit);
        }
      }
    }
  }

  return [...byCase.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}