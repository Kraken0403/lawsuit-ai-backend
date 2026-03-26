import type { CaseGroup, ClassifiedQuery, RawChunkHit } from "../types/search.js";

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

function payloadBlob(group: CaseGroup): string {
  return normalize(
    [
      group.title || "",
      group.citation || "",
      ...(group.chunks || []).map((c) =>
        [
          c.text || "",
          String(c.payload?.court || ""),
          String(c.payload?.courtName || ""),
          String(c.payload?.jurisdiction || ""),
          String(c.payload?.state || ""),
          String(c.payload?.bench || ""),
          String(c.payload?.subject || ""),
        ].join(" ")
      ),
    ].join(" ")
  );
}

function scoreCaseGroup(group: CaseGroup, query?: ClassifiedQuery): number {
  const chunkScores = group.chunks.map((c) => c.score).sort((a, b) => b - a);
  const best = chunkScores[0] ?? 0;
  const second = chunkScores[1] ?? 0;
  const third = chunkScores[2] ?? 0;

  let score = best + second * 0.35 + third * 0.2;

  if (group.chunks.length > 1) {
    score += Math.min(group.chunks.length, 4) * 0.03;
  }

  if (!query) return score;

  const title = normalize(group.title);
  const blob = payloadBlob(group);
  const filters = query.filters || {};

  if (query.caseTarget) {
    const target = normalize(query.caseTarget);
    const strength = titleMatchStrength(group.title || "", query.caseTarget);

    if (isDirectCaseLookupIntent(query.intent)) {
      if (strength === 3) score += 4.0;
      else if (strength === 2) score += 2.5;
      else if (strength === 1) score += 0.5;
      else score -= 2.75;
    } else {
      if (title && target) {
        if (title === target) score += 0.5;
        else if (title.includes(target) || target.includes(title)) score += 0.35;
      }
    }
  }

  if (query.citations?.length) {
    for (const citation of query.citations) {
      const c = normalize(citation);
      const citationText = normalize(group.citation);
      if (citationText === c) score += 5.0;
      else if (citationText.includes(c) || c.includes(citationText)) score += 2.2;
    }
  }

  if (query.comparisonTargets?.length) {
    let titleTargetMatches = 0;

    for (const target of query.comparisonTargets) {
      const strength = titleMatchStrength(group.title || "", target);
      if (strength >= 2) {
        score += 0.9;
        titleTargetMatches += 1;
      } else if (strength === 1) {
        score += 0.3;
      }
    }

    if (titleTargetMatches >= 1) score += 0.25;
    if (titleTargetMatches === 0) score -= 0.15;
  }

  const doctrineStyle =
    query.intent === "issue_search" &&
    /basic structure|doctrine|evolution|history|jurisprudence|constitutional framework/i.test(
      query.normalizedQuery
    );

  if (doctrineStyle) {
    if (/kesavananda/i.test(title)) score += 0.4;
    if (/golak/i.test(title)) score += 0.25;
    if (/minerva/i.test(title)) score += 0.25;
    if (/indira/i.test(title)) score += 0.22;
    if (/coelho/i.test(title)) score += 0.18;
    if (/waman/i.test(title)) score += 0.16;
  }

  if (filters.courts?.length) {
    const matched = filters.courts.some((court) => blob.includes(normalize(court)));
    score += matched ? 0.7 : -0.45;
  }

  if (filters.jurisdiction?.length) {
    const matched = filters.jurisdiction.some((j) => blob.includes(normalize(j)));
    score += matched ? 0.55 : -0.35;
  }

  if (filters.subjects?.length) {
    const matched = filters.subjects.some((s) => blob.includes(normalize(s)));
    score += matched ? 0.55 : -0.3;
  }

  if (query.intent === "latest_cases" || query.strategy === "recency_heavy") {
    const decisionTimes = group.chunks
      .map((c) => parseDecisionTime(c.payload || {}))
      .filter((v): v is number => typeof v === "number");

    const bestDecisionTime = decisionTimes.length ? Math.max(...decisionTimes) : null;

    if (bestDecisionTime) {
      const ageDays = Math.max(
        0,
        (Date.now() - bestDecisionTime) / (1000 * 60 * 60 * 24)
      );

      if (ageDays <= 30) score += 1.2;
      else if (ageDays <= 180) score += 0.85;
      else if (ageDays <= 365) score += 0.55;
      else if (ageDays <= 3 * 365) score += 0.15;
      else score -= 0.25;
    } else {
      score -= 0.15;
    }
  }

  return score;
}

export function groupHitsByCase(
  hits: RawChunkHit[],
  maxChunksPerCase = 2,
  query?: ClassifiedQuery
): CaseGroup[] {
  const grouped = new Map<number, CaseGroup>();

  for (const hit of hits) {
    if (!grouped.has(hit.caseId)) {
      grouped.set(hit.caseId, {
        caseId: hit.caseId,
        title: hit.title,
        citation: hit.citation,
        bestScore: hit.score,
        chunks: [],
      });
    }

    const group = grouped.get(hit.caseId)!;
    group.bestScore = Math.max(group.bestScore, hit.score);

    if (group.chunks.length < maxChunksPerCase) {
      group.chunks.push(hit);
    }
  }

  const sorted = [...grouped.values()].sort(
    (a, b) => scoreCaseGroup(b, query) - scoreCaseGroup(a, query)
  );

  if (query?.caseTarget && isDirectCaseLookupIntent(query.intent)) {
    const strong = sorted.filter(
      (g) => titleMatchStrength(g.title || "", query.caseTarget!) >= 2
    );

    if (strong.length > 0) {
      const rest = sorted.filter(
        (g) => titleMatchStrength(g.title || "", query.caseTarget!) < 2
      );
      return [...strong, ...rest];
    }
  }

  return sorted;
}