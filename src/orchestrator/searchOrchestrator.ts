import OpenAI from "openai";
import type {
  CaseGroup,
  ChatCaseDigest,
  ChatTurn,
  ClassifiedQuery,
  ConversationState,
  OrchestratedSearchResult,
  ResolvedReference,
  SearchInput,
  SearchTrace,
  RawChunkHit,
} from "../types/search.js";
import { classifyQuery } from "../query/classify.js";
import { dedupeChunks } from "../ranking/dedupe.js";
import { groupHitsByCase } from "../ranking/groupCases.js";
import { selectEvidence } from "../ranking/selectEvidence.js";
import { runHybridSearch } from "../qdrant/hybridSearch.js";
import { runMetadataSearch } from "../qdrant/metadataSearch.js";
import {
  fetchAllChunksForCase,
  fetchPreviewChunksForCase,
} from "../qdrant/caseReconstruction.js";
import { routeLegalQuery } from "../router/legalRouter.js";
import { routerToClassifiedQuery } from "../router/routerToClassifiedQuery.js";
import {
  matchesCourtConstraint,
  matchesJurisdictionConstraint,
  normalizeLatestJurisdictions,
  getLatestForumBoost,
} from "../utils/courtResolver.js";

const citationAliasClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    })
  : null;

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

function normalizeLooseSimple(text: string | null | undefined): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function citationTokenFingerprint(text: string | null | undefined): string {
  return normalizeLoose(text)
    .split(" ")
    .filter((tok) => tok.length >= 2)
    .sort()
    .join(" ");
}

function expandCitationVariants(text: string | null | undefined): string[] {
  const base = compact(text);
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

function looksLikePureCitationQuery(query: string): boolean {
  const q = compact(query);
  if (!q) return false;
  if (q.split(/\s+/).length > 8) return false;

  return (
    /\b(19|20)\d{2}\b/.test(q) &&
    /\b\d{1,5}\b/.test(q) &&
    /\b(AIR|AIR\s*\(SCW\)|SCW|SCC|SCR|Cri\s*LJ|CrLJ|LawSuit)\b/i.test(q)
  );
}

function inferCitationCourtFilters(query: string): string[] {
  const q = normalizeLooseSimple(query);

  if (/\bsc\b|\bsupreme court\b/.test(q)) return ["Supreme Court"];
  if (/\bguj\b|\bgujarat\b/.test(q)) return ["Gujarat High Court"];
  if (/\bdel\b|\bdelhi\b/.test(q)) return ["Delhi High Court"];
  if (/\bbom\b|\bbombay\b|\bmumbai\b/.test(q)) return ["Bombay High Court"];

  return [];
}

function buildFastCitationClassifiedQuery(rawQuery: string): ClassifiedQuery {
  const citations = expandCitationVariants(rawQuery);

  return {
    originalQuery: compact(rawQuery),
    normalizedQuery: compact(rawQuery),
    intent: "case_lookup",
    confidence: 0.99,
    exactTerms: [compact(rawQuery)],
    citations,
    caseHints: [],
    caseTarget: null,
    metadataField: null,
    referenceTerms: citations,
    comparisonTargets: [],
    followUpLikely: false,
    strategy: "citation_heavy",
    reasons: ["fast-path: direct citation query"],
    filters: {
      jurisdiction: [],
      courts: inferCitationCourtFilters(rawQuery),
      statutes: [],
      sections: [],
      subjects: [],
      dateFrom: null,
      dateTo: null,
      onlyReported: true,
    },
  };
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

function getGroupDecisionTime(group: CaseGroup): number | null {
  const times = (group.chunks || [])
    .map((c) => parseDecisionTime(c.payload || {}))
    .filter((v): v is number => typeof v === "number");

  if (!times.length) return null;
  return Math.max(...times);
}

function metadataBlob(group: CaseGroup): string {
  return [
    group.title || "",
    group.citation || "",
    ...(group.chunks || []).map((c) =>
      [
        String(c.payload?.court || ""),
        String(c.payload?.courtName || ""),
        String(c.payload?.jurisdiction || ""),
        String(c.payload?.state || ""),
        String(c.payload?.bench || ""),
        String(c.payload?.subject || ""),
        String(c.payload?.caseType || ""),
        Array.isArray(c.payload?.actsReferred) ? c.payload.actsReferred.join(" ") : "",
        Array.isArray(c.payload?.equivalentCitations)
          ? c.payload.equivalentCitations.join(" ")
          : "",
        String(c.payload?.dateOfDecision || ""),
      ].join(" ")
    ),
  ]
    .join(" ")
    .toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const v = compact(value);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }

  return out;
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

function getCaseTargetTokensLoose(caseTarget: string | null | undefined): string[] {
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

  return [...new Set(
    normalizeLoose(caseTarget)
      .split(" ")
      .filter((tok) => tok.length >= 3 && !stop.has(tok))
  )];
}

function caseTargetCoverage(title: string, target: string): number {
  const titleLoose = normalizeLoose(title);
  const targetTokens = getCaseTargetTokensLoose(target);

  if (!titleLoose || !targetTokens.length) return 0;

  const matched = targetTokens.filter((tok) => titleLoose.includes(tok)).length;
  return matched / Math.max(1, targetTokens.length);
}

function getGroupEquivalentCitations(group: CaseGroup | undefined): string[] {
  if (!group) return [];

  const out = new Set<string>();

  for (const chunk of group.chunks || []) {
    const eq = Array.isArray(chunk.payload?.equivalentCitations)
      ? chunk.payload.equivalentCitations
      : [];
    for (const item of eq) {
      const v = compact(String(item || ""));
      if (v) out.add(v);
    }
  }

  return [...out];
}

function groupContainsCitation(group: CaseGroup | undefined, citations: string[] = []): boolean {
  if (!group || !citations.length) return false;

  const candidates = new Set<string>();
  if (group.citation) candidates.add(group.citation);
  for (const eq of getGroupEquivalentCitations(group)) candidates.add(eq);

  const candidateFingerprints = new Set(
    [...candidates].map(citationTokenFingerprint).filter(Boolean)
  );

  for (const citation of citations) {
    const fp = citationTokenFingerprint(citation);
    if (fp && candidateFingerprints.has(fp)) return true;
  }

  return false;
}

function isStrongResolvedMatch(
  group: CaseGroup | undefined,
  classified: ClassifiedQuery
): boolean {
  if (!group || !classified.caseTarget) return false;
  return titleMatchStrength(group.title || "", classified.caseTarget) >= 2;
}

function isExactCitationResolved(
  group: CaseGroup | undefined,
  classified: ClassifiedQuery
): boolean {
  if (!classified.citations?.length) return false;
  return groupContainsCitation(group, classified.citations);
}

function isAcceptableResolvedMatch(
  group: CaseGroup | undefined,
  classified: ClassifiedQuery
): boolean {
  if (!group) return false;

  if (isExactCitationResolved(group, classified)) {
    return true;
  }

  if (!classified.caseTarget) return false;

  const strength = titleMatchStrength(group.title || "", classified.caseTarget);
  if (strength >= 2) return true;

  const coverage = caseTargetCoverage(group.title || "", classified.caseTarget);
  const bestScore = Number(group.bestScore || 0);

  if (coverage >= 0.5 && bestScore >= 20) return true;
  if (classified.metadataField === "citation" && coverage >= 0.5) return true;

  return false;
}

function normalizeMessages(messages: ChatTurn[] = []): ChatTurn[] {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role:
        m?.role === "assistant"
          ? "assistant"
          : m?.role === "system"
          ? "system"
          : "user",
      content: compact(m?.content || ""),
      caseDigests: Array.isArray(m?.caseDigests)
        ? m.caseDigests
            .map((d) => ({
              caseId: d?.caseId,
              title: compact(d?.title || ""),
              citation: compact(d?.citation || ""),
              summary: compact(d?.summary || ""),
            }))
            .filter((d) => d.title || d.citation || d.summary)
        : [],
    }))
    .filter((m) => m.content.length > 0);
}

function getLatestAssistantCaseDigests(messages: ChatTurn[] = []): ChatCaseDigest[] {
  const normalized = normalizeMessages(messages);

  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const message = normalized[i];
    if (
      message.role === "assistant" &&
      Array.isArray(message.caseDigests) &&
      message.caseDigests.length
    ) {
      return message.caseDigests.slice(0, 10);
    }
  }

  return [];
}

function buildConversationState(messages: ChatTurn[] = []): ConversationState {
  const digests = getLatestAssistantCaseDigests(messages);

  return {
    activeTopic: null,
    activeCaseIds: digests
      .map((d) => d.caseId)
      .filter((v): v is number => typeof v === "number"),
    activeCaseTitles: uniqueStrings(digests.map((d) => d.title)),
    activeCitations: uniqueStrings(digests.map((d) => d.citation)),
    activeJurisdiction: null,
    activeCourts: [],
    activeStatutes: [],
    activeSections: [],
    activeTimeScope: null,
    lastAnswerType: digests.length ? "case_list" : null,
    lastResultSet: digests.map((d, index) => ({
      rank: index + 1,
      caseId: d.caseId,
      title: d.title,
      citation: d.citation || null,
    })),
  };
}

function extractOrdinalMentions(text: string): number[] {
  const q = ` ${String(text || "").toLowerCase()} `;
  const regex =
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(case|one|judgment|decision)\b/g;

  const out: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(q))) {
    const label = match[1];
    let value: number | null = null;

    if (label === "first" || label === "1st") value = 1;
    else if (label === "second" || label === "2nd") value = 2;
    else if (label === "third" || label === "3rd") value = 3;
    else if (label === "fourth" || label === "4th") value = 4;
    else if (label === "fifth" || label === "5th") value = 5;
    else if (label === "last") value = -1;

    if (value != null && !out.includes(value)) {
      out.push(value);
    }
  }

  return out;
}

function resolveOrdinalDigest(
  digests: ChatCaseDigest[],
  ordinal: number
): ChatCaseDigest | null {
  if (!digests.length) return null;

  const index = ordinal === -1 ? digests.length - 1 : ordinal - 1;
  if (index < 0 || index >= digests.length) return null;

  return digests[index];
}

function isComparisonQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("compare") ||
    q.includes("difference between") ||
    q.includes("distinguish") ||
    q.includes("contrast")
  );
}

function isSummaryQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("summarize") ||
    q.includes("summarise") ||
    q.includes("summary") ||
    q.includes("brief")
  );
}

function isHoldingQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("holding") ||
    q.includes("ratio decidendi") ||
    q.includes("ratio") ||
    q.includes("what did the court hold") ||
    q.includes("what was held")
  );
}

function isFullJudgmentQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("full judgment") ||
    q.includes("full text") ||
    q.includes("complete judgment") ||
    q.includes("entire judgment") ||
    q.includes("judgment text")
  );
}

function isMetadataReferenceQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("citation") ||
    q.includes("court") ||
    q.includes("judges") ||
    q.includes("judge") ||
    q.includes("date of decision") ||
    q.includes("decision date") ||
    q.includes("case number") ||
    q.includes("case no") ||
    q.includes("acts referred") ||
    q.includes("subject") ||
    q.includes("final decision") ||
    q.includes("advocates") ||
    q.includes("case type")
  );
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

function rewriteForSingleTarget(query: string, target: ChatCaseDigest): string {
  const title = target.title || "";
  const citation = target.citation || "";
  const ref = [title, citation].filter(Boolean).join(" ");

  if (!ref) return query;

  if (isFullJudgmentQuery(query)) {
    return `Give the full judgment of ${ref}`;
  }

  if (isHoldingQuery(query)) {
    return `What is the holding in ${ref}`;
  }

  if (isSummaryQuery(query)) {
    return `Summarize ${ref}`;
  }

  if (isMetadataReferenceQuery(query)) {
    if (query.toLowerCase().includes("citation")) return `Give the citation of ${ref}`;
    if (query.toLowerCase().includes("court")) return `What is the court in ${ref}`;
    if (query.toLowerCase().includes("judges") || query.toLowerCase().includes("judge")) {
      return `Who were the judges in ${ref}`;
    }
    if (
      query.toLowerCase().includes("date of decision") ||
      query.toLowerCase().includes("decision date")
    ) {
      return `What is the date of decision in ${ref}`;
    }
    if (query.toLowerCase().includes("case number") || query.toLowerCase().includes("case no")) {
      return `What is the case number in ${ref}`;
    }
    if (query.toLowerCase().includes("acts referred")) {
      return `What acts are referred in ${ref}`;
    }
    if (query.toLowerCase().includes("subject")) {
      return `What is the subject in ${ref}`;
    }
    if (query.toLowerCase().includes("final decision")) {
      return `What is the final decision in ${ref}`;
    }
    if (query.toLowerCase().includes("advocates")) {
      return `Who were the advocates in ${ref}`;
    }
    if (query.toLowerCase().includes("case type")) {
      return `What is the case type in ${ref}`;
    }
  }

  return `${query} in ${ref}`;
}

function maybeRewriteFollowUpQuery(query: string, messages: ChatTurn[] = []): string {
  const digests = getLatestAssistantCaseDigests(messages);
  if (!digests.length) return query;

  const q = compact(query);
  if (!q) return query;

  const ordinalMentions = extractOrdinalMentions(q);

  if (isComparisonQuery(q) && ordinalMentions.length >= 2) {
    const first = resolveOrdinalDigest(digests, ordinalMentions[0]);
    const second = resolveOrdinalDigest(digests, ordinalMentions[1]);

    if (first?.title && second?.title) {
      return `Compare ${first.title} and ${second.title}`;
    }
  }

  if (ordinalMentions.length >= 1) {
    const target = resolveOrdinalDigest(digests, ordinalMentions[0]);
    if (target) {
      return rewriteForSingleTarget(q, target);
    }
  }

  const lower = q.toLowerCase();
  const deicticReference =
    /\b(that case|this case|that judgment|this judgment|that one|this one|it)\b/.test(lower);

  if (deicticReference && digests.length === 1) {
    return rewriteForSingleTarget(q, digests[0]);
  }

  if (
    isComparisonQuery(q) &&
    /\b(compare them|compare those|difference between them|distinguish them)\b/.test(lower) &&
    digests.length === 2
  ) {
    return `Compare ${digests[0].title} and ${digests[1].title}`;
  }

  return query;
}

function resolveReferenceFromMessages(
  rawQuery: string,
  messages: ChatTurn[] = []
): ResolvedReference {
  const digests = getLatestAssistantCaseDigests(messages);
  const notes: string[] = [];
  const ordinalNumbers = extractOrdinalMentions(rawQuery);

  if (!digests.length) {
    return {
      referenceType: "none",
      usedPriorContext: false,
      ordinalNumbers: [],
      resolvedCaseDigests: [],
      notes,
    };
  }

  if (isComparisonQuery(rawQuery) && ordinalNumbers.length >= 2) {
    const first = resolveOrdinalDigest(digests, ordinalNumbers[0]);
    const second = resolveOrdinalDigest(digests, ordinalNumbers[1]);
    const resolved = [first, second].filter(Boolean) as ChatCaseDigest[];

    if (resolved.length >= 2) {
      notes.push("resolved comparison using ordinal references from prior assistant digests");
      return {
        referenceType: "comparison",
        usedPriorContext: true,
        ordinalNumbers,
        resolvedCaseDigests: resolved,
        notes,
      };
    }
  }

  if (ordinalNumbers.length >= 1) {
    const target = resolveOrdinalDigest(digests, ordinalNumbers[0]);
    if (target) {
      notes.push("resolved ordinal follow-up from prior assistant digests");
      return {
        referenceType: "ordinal",
        usedPriorContext: true,
        ordinalNumbers,
        resolvedCaseDigests: [target],
        notes,
      };
    }
  }

  const lower = compact(rawQuery).toLowerCase();
  if (/\b(that case|this case|that judgment|this judgment|that one|this one|it)\b/.test(lower)) {
    if (digests.length === 1) {
      notes.push("resolved deictic follow-up against single prior assistant digest");
      return {
        referenceType: "deictic",
        usedPriorContext: true,
        ordinalNumbers: [],
        resolvedCaseDigests: [digests[0]],
        notes,
      };
    }

    notes.push("detected deictic follow-up but multiple prior digests exist");
    return {
      referenceType: "deictic",
      usedPriorContext: true,
      ordinalNumbers: [],
      resolvedCaseDigests: [],
      notes,
    };
  }

  if (
    isComparisonQuery(rawQuery) &&
    /\b(compare them|compare those|difference between them|distinguish them)\b/.test(lower) &&
    digests.length === 2
  ) {
    notes.push("resolved comparison follow-up against two prior assistant digests");
    return {
      referenceType: "comparison",
      usedPriorContext: true,
      ordinalNumbers: [],
      resolvedCaseDigests: digests.slice(0, 2),
      notes,
    };
  }

  return {
    referenceType: "none",
    usedPriorContext: false,
    ordinalNumbers: [],
    resolvedCaseDigests: [],
    notes,
  };
}

function shouldUseLegacyClassifier(classified: ClassifiedQuery): boolean {
  return (
    classified.intent === "unknown" ||
    !Number.isFinite(classified.confidence) ||
    classified.confidence < 0.45
  );
}

async function buildClassifiedQuery(params: {
  rawQuery: string;
  messages: ChatTurn[];
  state: ConversationState;
  trace: SearchTrace;
}): Promise<ClassifiedQuery> {
  const { rawQuery, messages, state, trace } = params;

  if (looksLikePureCitationQuery(rawQuery)) {
    const fast = buildFastCitationClassifiedQuery(rawQuery);
    trace.effectiveQuery = fast.normalizedQuery;
    trace.filtersApplied = fast.filters;
    trace.notes.push("used fast-path citation classifier");
    return fast;
  }

  try {
    const router = await routeLegalQuery({
      query: rawQuery,
      messages,
      state,
    });

    trace.router = router;
    trace.effectiveQuery = compact(router.resolvedQuery || rawQuery);
    trace.filtersApplied = router.retrievalPlan.filters;

    const routedClassified = routerToClassifiedQuery({
      originalQuery: rawQuery,
      router,
    });

        if (!shouldUseLegacyClassifier(routedClassified)) {
      const routerRewrites = Array.isArray(router?.retrievalPlan?.queryRewrites)
        ? router.retrievalPlan.queryRewrites
        : [];

      const rewriteTargets = routerRewrites
        .map((q) => stripMetadataInstruction(String(q || "")))
        .filter(Boolean);

      const enrichedClassified: ClassifiedQuery = {
        ...routedClassified,
        caseHints: uniqueStrings([
          ...(routedClassified.caseHints || []),
          ...rewriteTargets,
        ]),
        referenceTerms: uniqueStrings([
          ...(routedClassified.referenceTerms || []),
          ...routerRewrites,
          ...rewriteTargets,
        ]),
      };

      trace.notes.push("used structured LLM router");
      return enrichedClassified;
    }

    trace.notes.push("router output was weak; falling back to legacy classifier");
  } catch (error) {
    trace.notes.push("router threw error; falling back to legacy classifier");
    console.error("[searchOrchestrator] router failed:", error);
  }

  const legacyEffectiveQuery = maybeRewriteFollowUpQuery(rawQuery, messages);
  const fallback = classifyQuery(legacyEffectiveQuery);

  trace.classifiedFallback = fallback;
  trace.effectiveQuery = legacyEffectiveQuery;
  trace.filtersApplied = fallback.filters;

  if (legacyEffectiveQuery !== rawQuery) {
    trace.notes.push("legacy follow-up rewrite used during classifier fallback");
  }

  return fallback;
}

function extractSubjectKeywords(classified: ClassifiedQuery): string[] {
  const out = new Set<string>();

  for (const s of classified.filters?.subjects || []) {
    const v = normalizeLooseSimple(s);
    if (v) out.add(v);
    if (v === "murder") out.add("302");
    if (v === "bail") {
      out.add("bail");
      out.add("anticipatory bail");
      out.add("regular bail");
      out.add("interim bail");
    }
  }

  const q = normalizeLooseSimple(classified.normalizedQuery || classified.originalQuery || "");

  if (q.includes("murder")) {
    out.add("murder");
    out.add("302");
  }

  if (q.includes("bail")) {
    out.add("bail");
    out.add("anticipatory bail");
    out.add("regular bail");
    out.add("interim bail");
  }

  return [...out];
}

async function resolveCitationAliasWithLlm(
  classified: ClassifiedQuery,
  hybridHits: RawChunkHit[]
): Promise<string | null> {
  if (!citationAliasClient || !classified.citations?.length) return null;

  const targetCitations = classified.citations.map((c) => normalizeLooseSimple(c));

  const relevant = hybridHits
    .filter((hit) => {
      const text = normalizeLooseSimple(hit.text || "");
      const title = normalizeLooseSimple(hit.title || "");
      const citation = normalizeLooseSimple(hit.citation || "");
      return targetCitations.some(
        (target) => text.includes(target) || title.includes(target) || citation.includes(target)
      );
    })
    .slice(0, 8);

  if (!relevant.length) return null;

  const snippets = relevant.map((hit, idx) => {
    return [
      `Snippet ${idx + 1}`,
      `Hit title: ${hit.title || "Unknown"}`,
      `Hit citation: ${hit.citation || "Unknown"}`,
      `Text: ${compact(hit.text || "").slice(0, 1200)}`,
    ].join("\n");
  });

  try {
    const response = await citationAliasClient.responses.create({
      model: process.env.OPENAI_ROUTER_MODEL || process.env.OPENAI_ANSWER_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You extract the actual case title corresponding to a legal citation from quoted legal excerpts. Return null if the excerpts do not explicitly identify the case. Do not guess from the surrounding hit title unless the excerpt itself makes the mapping clear.",
        },
        {
          role: "user",
          content: [
            `Target citation: ${classified.citations[0]}`,
            "",
            ...snippets,
            "",
            'Return strict JSON: {"caseTitle": string|null, "confidence": number, "reason": string}',
          ].join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "citation_alias_resolution",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              caseTitle: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
            required: ["caseTitle", "confidence", "reason"],
          },
        },
      },
      store: false,
    });

    const raw = response.output_text || "";
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      caseTitle: string | null;
      confidence: number;
      reason: string;
    };

    if (!parsed.caseTitle || !Number.isFinite(parsed.confidence) || parsed.confidence < 0.75) {
      return null;
    }

    return compact(parsed.caseTitle);
  } catch (error) {
    console.warn("[searchOrchestrator] citation alias LLM recovery failed:", error);
    return null;
  }
}

function filterLatestCaseGroups(
  groups: CaseGroup[],
  classified: ClassifiedQuery
): CaseGroup[] {
  const filters = classified.filters || {};
  const subjectKeywords = extractSubjectKeywords(classified);
  const jurisdictions = normalizeLatestJurisdictions(classified);
  const courts = (filters.courts || []).map((c) => normalizeLooseSimple(c));

  const strict = groups.filter((group) => {
    const meta = metadataBlob(group);

    const subjectOk =
      !subjectKeywords.length || subjectKeywords.some((s) => meta.includes(s));

    const jurisdictionOk =
      !jurisdictions.length ||
      jurisdictions.some((j) => matchesJurisdictionConstraint(group, j));

    const courtOk =
      !courts.length || courts.some((c) => matchesCourtConstraint(group, c));

    return subjectOk && jurisdictionOk && courtOk;
  });

  const candidateSet = strict.length ? strict : groups;

  const newestSorted = [...candidateSet].sort((a, b) => {
    const ta = getGroupDecisionTime(a) || 0;
    const tb = getGroupDecisionTime(b) || 0;

    if (tb !== ta) return tb - ta;

    const forumBoostA = getLatestForumBoost(a, classified);
    const forumBoostB = getLatestForumBoost(b, classified);
    if (forumBoostB !== forumBoostA) return forumBoostB - forumBoostA;

    return (b.bestScore || 0) - (a.bestScore || 0);
  });

  const newestTime = getGroupDecisionTime(newestSorted[0]);
  if (!newestTime) return newestSorted.slice(0, 5);

  const fiveYearsMs = 1000 * 60 * 60 * 24 * 365 * 5;

  const pruned = newestSorted.filter((group) => {
    const t = getGroupDecisionTime(group);
    if (!t) return false;
    return newestTime - t <= fiveYearsMs;
  });

  const finalSet = pruned.length >= 2 ? pruned : newestSorted;
  return finalSet.slice(0, 5);
}

function buildLatestEvidence(groups: CaseGroup[], max = 10): RawChunkHit[] {
  const sorted = [...groups].sort((a, b) => {
    const ta = getGroupDecisionTime(a) || 0;
    const tb = getGroupDecisionTime(b) || 0;

    if (tb !== ta) return tb - ta;
    return (b.bestScore || 0) - (a.bestScore || 0);
  });

  const out: RawChunkHit[] = [];
  for (const group of sorted.slice(0, 5)) {
    const chunks = [...(group.chunks || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    out.push(...chunks.slice(0, 2));
  }

  return out.slice(0, max);
}

function shouldExpandWholeCase(
  classified: ClassifiedQuery,
  mode: OrchestratedSearchResult["mode"] = "hybrid"
): boolean {
  if (mode === "full_judgment") return true;
  if (classified.intent === "full_judgment") return true;
  return false;
}

function buildCitationNotFoundResult(
  classified: ClassifiedQuery,
  trace: SearchTrace,
  mode: OrchestratedSearchResult["mode"] = "hybrid"
): OrchestratedSearchResult {
  return {
    query: classified,
    mode,
    groupedCases: [],
    evidence: [],
    trace,
  };
}

async function runHybridPath(
  classified: ClassifiedQuery,
  trace: SearchTrace,
  mode: OrchestratedSearchResult["mode"] = "hybrid"
): Promise<OrchestratedSearchResult> {
  const hybridHits = dedupeChunks(
    await runHybridSearch(
      classified,
      classified.intent === "latest_cases" ? 40 : undefined
    )
  );

  let groupedCases = groupHitsByCase(
    hybridHits,
    classified.intent === "latest_cases" ? 5 : 3,
    classified
  );

  let evidence: RawChunkHit[];

  if (classified.intent === "latest_cases") {
    const filtered = filterLatestCaseGroups(groupedCases, classified);
    if (filtered.length) {
      groupedCases = filtered;
      trace.notes.push(
        "applied latest-case strict filtering, state-aware jurisdiction normalization, shared court resolution, state-HC preference, and date-prioritized ordering"
      );
    } else {
      trace.notes.push(
        "latest-case strict filtering found no stronger narrowed set; kept original groups"
      );
    }

    evidence = buildLatestEvidence(groupedCases, 10);
  } else {
    evidence = selectEvidence(groupedCases, 10);
  }

  return {
    query: classified,
    mode,
    groupedCases,
    evidence,
    trace,
  };
}

async function resolveByCitationFirst(
  classified: ClassifiedQuery,
  trace: SearchTrace,
  mode: OrchestratedSearchResult["mode"] = "hybrid"
): Promise<OrchestratedSearchResult | null> {
  if (!classified.citations?.length) return null;

  const metadataHits = dedupeChunks(await runMetadataSearch(classified, 8));
  const metadataGroups = groupHitsByCase(metadataHits, 1, classified);
  const top = metadataGroups[0];

  if (!isExactCitationResolved(top, classified)) {
    trace.notes.push("citation-first resolution found no exact/equivalent citation match");
    return null;
  }

  const chunks = shouldExpandWholeCase(classified, mode)
    ? mode === "full_judgment"
      ? await fetchAllChunksForCase(top.caseId)
      : await fetchPreviewChunksForCase(top.caseId, 24)
    : metadataHits
        .filter((hit) => hit.caseId === top.caseId)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 6);

  trace.notes.push(
    shouldExpandWholeCase(classified, mode)
      ? "resolved exact citation and expanded preview/full case"
      : "resolved exact citation without full-case expansion"
  );

  return {
    query: classified,
    mode,
    groupedCases: [
      {
        caseId: top.caseId,
        title: top.title,
        citation: top.citation,
        bestScore: top.bestScore,
        chunks,
      },
    ],
    evidence: chunks.slice(0, mode === "full_judgment" ? 12 : 6),
    trace,
  };
}

async function resolveByCitationAliasRecovery(
  classified: ClassifiedQuery,
  trace: SearchTrace,
  mode: OrchestratedSearchResult["mode"] = "hybrid"
): Promise<OrchestratedSearchResult | null> {
  if (!classified.citations?.length) return null;

  const hybridHits = dedupeChunks(await runHybridSearch(classified, 12));
  const aliasTitle = await resolveCitationAliasWithLlm(classified, hybridHits);

  if (!aliasTitle) {
    trace.notes.push(
      "citation alias recovery found no resolvable case-title alias in retrieved citation-bearing snippets"
    );
    return null;
  }

  const perTarget: ClassifiedQuery = {
    ...classified,
    intent: "case_lookup",
    caseTarget: aliasTitle,
    citations: [],
    exactTerms: [aliasTitle],
    referenceTerms: [aliasTitle],
    comparisonTargets: [],
    strategy: "metadata_heavy",
  };

  const metadataHits = dedupeChunks(await runMetadataSearch(perTarget, 8));
  const metadataGroups = groupHitsByCase(metadataHits, 1, perTarget);
  const metadataTop = metadataGroups[0];

  if (metadataTop && isAcceptableResolvedMatch(metadataTop, perTarget)) {
    const chunks = shouldExpandWholeCase(classified, mode)
      ? mode === "full_judgment"
        ? await fetchAllChunksForCase(metadataTop.caseId)
        : await fetchPreviewChunksForCase(metadataTop.caseId, 24)
      : metadataHits
          .filter((hit) => hit.caseId === metadataTop.caseId)
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 6);

    trace.notes.push(
      shouldExpandWholeCase(classified, mode)
        ? `citation alias LLM recovery resolved "${aliasTitle}" and expanded preview/full case`
        : `citation alias LLM recovery resolved "${aliasTitle}" without full-case expansion`
    );

    return {
      query: classified,
      mode,
      groupedCases: [
        {
          caseId: metadataTop.caseId,
          title: metadataTop.title,
          citation: metadataTop.citation,
          bestScore: metadataTop.bestScore,
          chunks,
        },
      ],
      evidence: chunks.slice(0, mode === "full_judgment" ? 12 : 6),
      trace,
    };
  }

  const hybridPerTarget: ClassifiedQuery = {
    ...perTarget,
    strategy: "balanced",
  };

  const recoveredHybridHits = dedupeChunks(await runHybridSearch(hybridPerTarget, 12));
  const recoveredHybridGroups = groupHitsByCase(recoveredHybridHits, 1, hybridPerTarget);
  const hybridTop = recoveredHybridGroups[0];

  if (!hybridTop || !isAcceptableResolvedMatch(hybridTop, hybridPerTarget)) {
    trace.notes.push(
      `citation alias recovery extracted "${aliasTitle}" but both metadata and hybrid title resolution were weak`
    );
    return null;
  }

  const chunks = shouldExpandWholeCase(classified, mode)
    ? mode === "full_judgment"
      ? await fetchAllChunksForCase(hybridTop.caseId)
      : await fetchPreviewChunksForCase(hybridTop.caseId, 24)
    : recoveredHybridHits
        .filter((hit) => hit.caseId === hybridTop.caseId)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 6);

  trace.notes.push(
    shouldExpandWholeCase(classified, mode)
      ? `citation alias LLM recovery resolved "${aliasTitle}" via hybrid fallback and expanded preview/full case`
      : `citation alias LLM recovery resolved "${aliasTitle}" via hybrid fallback without full-case expansion`
  );

  return {
    query: classified,
    mode,
    groupedCases: [
      {
        caseId: hybridTop.caseId,
        title: hybridTop.title,
        citation: hybridTop.citation,
        bestScore: hybridTop.bestScore,
        chunks,
      },
    ],
    evidence: chunks.slice(0, mode === "full_judgment" ? 12 : 6),
    trace,
  };
}

async function resolveComparisonTargetsFirst(
  classified: ClassifiedQuery,
  trace: SearchTrace
): Promise<OrchestratedSearchResult | null> {
  const targets = classified.comparisonTargets || [];
  if (targets.length < 2) return null;

  const resolvedGroups: CaseGroup[] = [];

  for (const target of targets.slice(0, 2)) {
    const perTarget: ClassifiedQuery = {
      ...classified,
      intent: "case_lookup",
      caseTarget: target,
      comparisonTargets: [],
      citations: [],
      strategy: "metadata_heavy",
    };

    const hits = dedupeChunks(await runMetadataSearch(perTarget, 8));
    const groups = groupHitsByCase(hits, 1, perTarget);
    const top = groups[0];

    if (!top || !isAcceptableResolvedMatch(top, perTarget)) {
      trace.notes.push(`failed to strongly resolve comparison target: ${target}`);
      return null;
    }

    const previewChunks = await fetchPreviewChunksForCase(top.caseId, 24);

    resolvedGroups.push({
      caseId: top.caseId,
      title: top.title,
      citation: top.citation,
      bestScore: top.bestScore,
      chunks: previewChunks,
    });
  }

  trace.notes.push("resolved both comparison targets deterministically before hybrid");

  return {
    query: classified,
    mode: "hybrid",
    groupedCases: resolvedGroups,
    evidence: resolvedGroups.flatMap((g) => g.chunks.slice(0, 4)).slice(0, 10),
    trace,
  };
}

async function resolveNamedCaseAndExpand(
  classified: ClassifiedQuery,
  trace: SearchTrace,
  mode: OrchestratedSearchResult["mode"] = "hybrid"
): Promise<OrchestratedSearchResult | null> {
  if (!classified.caseTarget) return null;

  const metadataHits = dedupeChunks(await runMetadataSearch(classified, 8));
  const metadataGroups = groupHitsByCase(metadataHits, 1, classified);
  const top = metadataGroups[0];

  if (!isAcceptableResolvedMatch(top, classified)) {
    trace.notes.push("named-case expansion skipped because metadata resolution was not strong enough");
    return null;
  }

  const chunks = shouldExpandWholeCase(classified, mode)
    ? mode === "full_judgment"
      ? await fetchAllChunksForCase(top.caseId)
      : await fetchPreviewChunksForCase(top.caseId, 24)
    : metadataHits
        .filter((hit) => hit.caseId === top.caseId)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 6);

  trace.notes.push(
    shouldExpandWholeCase(classified, mode)
      ? "expanded resolved named case to preview/full case chunks"
      : "resolved named case without full-case expansion"
  );

  return {
    query: classified,
    mode,
    groupedCases: [
      {
        caseId: top.caseId,
        title: top.title,
        citation: top.citation,
        bestScore: top.bestScore,
        chunks,
      },
    ],
    evidence: chunks.slice(0, mode === "full_judgment" ? 12 : 6),
    trace,
  };
}

async function resolveMetadataLookupByTargetFallback(
  classified: ClassifiedQuery,
  trace: SearchTrace
): Promise<OrchestratedSearchResult | null> {
  const variants = getCaseTargetVariants(classified);
  if (!variants.length) return null;

  for (const variant of variants.slice(0, 5)) {
    const rescueQuery: ClassifiedQuery = {
      ...classified,
      intent: "case_lookup",
      caseTarget: variant,
      normalizedQuery: variant,
      exactTerms: [variant],
      referenceTerms: uniqueStrings([
        variant,
        ...(classified.referenceTerms || []),
      ]),
      citations: [],
      comparisonTargets: [],
      strategy: "dense_heavy",
    };

    const hybridHits = dedupeChunks(await runHybridSearch(rescueQuery, 20));
    const groupedCases = groupHitsByCase(hybridHits, 3, rescueQuery);
    const top = groupedCases[0];

    if (!top || !isAcceptableResolvedMatch(top, rescueQuery)) {
      continue;
    }

    const previewChunks = await fetchPreviewChunksForCase(top.caseId, 24);

    trace.notes.push(`resolved metadata lookup via target-only dense fallback using variant "${variant}"`);

    return {
      query: classified,
      mode: "metadata",
      groupedCases: [
        {
          caseId: top.caseId,
          title: top.title,
          citation: top.citation,
          bestScore: top.bestScore,
          chunks: previewChunks,
        },
      ],
      evidence: previewChunks.slice(0, 6),
      trace,
    };
  }

  trace.notes.push("target-only dense metadata rescue found no acceptable resolved match");
  return null;
}

export async function orchestrateSearch(
  input: SearchInput
): Promise<OrchestratedSearchResult> {
  const rawQuery = compact(input?.query || "");
  const messages = normalizeMessages(input?.messages || []);
  const state = buildConversationState(messages);
  const resolvedReference = resolveReferenceFromMessages(rawQuery, messages);

  const trace: SearchTrace = {
    originalQuery: rawQuery,
    effectiveQuery: rawQuery,
    resolvedReference,
    notes: [],
  };

  if (resolvedReference.usedPriorContext) {
    trace.notes.push(...resolvedReference.notes);
  }

  const classified = await buildClassifiedQuery({
    rawQuery,
    messages,
    state,
    trace,
  });

  if (classified.intent === "comparison") {
    const resolvedComparison = await resolveComparisonTargetsFirst(classified, trace);
    if (resolvedComparison) return resolvedComparison;
  }

  if (classified.citations?.length) {
    const resolvedCitation = await resolveByCitationFirst(
      classified,
      trace,
      classified.intent === "full_judgment" ? "full_judgment" : "hybrid"
    );
    if (resolvedCitation) return resolvedCitation;

    const recoveredCitationAlias = await resolveByCitationAliasRecovery(
      classified,
      trace,
      classified.intent === "full_judgment" ? "full_judgment" : "hybrid"
    );
    if (recoveredCitationAlias) return recoveredCitationAlias;

    if (classified.intent === "case_lookup") {
      trace.notes.push("strict citation lookup produced no resolved case; skipped generic hybrid fallback");
      return buildCitationNotFoundResult(classified, trace);
    }
  }

  if (classified.intent === "metadata_lookup") {
    const metadataHits = dedupeChunks(await runMetadataSearch(classified));
    const groupedCases = groupHitsByCase(metadataHits, 2, classified);
    const evidence = selectEvidence(groupedCases, 6);

    if (groupedCases.length > 0 && isAcceptableResolvedMatch(groupedCases[0], classified)) {
      trace.notes.push("served metadata lookup from metadata path");
      return {
        query: classified,
        mode: "metadata",
        groupedCases,
        evidence,
        trace,
      };
    }

    trace.notes.push(
      "metadata lookup returned no strong resolved match; trying target-only dense rescue"
    );

    const targetRescue = await resolveMetadataLookupByTargetFallback(classified, trace);
    if (targetRescue) {
      return targetRescue;
    }

    trace.notes.push("target-only dense rescue failed; falling back to hybrid path");

    const hybridFallback = await runHybridPath(
      {
        ...classified,
        strategy:
          classified.metadataField === "citation"
            ? "dense_heavy"
            : classified.strategy === "citation_heavy"
            ? "balanced"
            : classified.strategy,
      },
      trace,
      "hybrid"
    );

    if (
      hybridFallback.groupedCases.length > 0 &&
      isAcceptableResolvedMatch(hybridFallback.groupedCases[0], classified)
    ) {
      trace.notes.push("served metadata lookup from hybrid fallback");
      return {
        query: classified,
        mode: "metadata",
        groupedCases: hybridFallback.groupedCases.slice(0, 2),
        evidence: selectEvidence(hybridFallback.groupedCases.slice(0, 2), 6),
        trace,
      };
    }

    return {
      query: classified,
      mode: "metadata",
      groupedCases: [],
      evidence: [],
      trace,
    };
  }

  if (classified.intent === "full_judgment") {
    const resolved = await resolveNamedCaseAndExpand(classified, trace, "full_judgment");
    if (resolved) return resolved;

    trace.notes.push("full judgment fell back to hybrid path");
    return runHybridPath(classified, trace, "full_judgment");
  }

  if (classified.intent === "latest_cases") {
    trace.notes.push(
      "router identified latest/recent case query; shared court resolution, runtime date parsing, state-aware filtering, and newest-first ordering are active"
    );
  }

  const resolvedHybrid = await resolveNamedCaseAndExpand(classified, trace, "hybrid");
  if (resolvedHybrid) return resolvedHybrid;

  return runHybridPath(classified, trace, "hybrid");
}