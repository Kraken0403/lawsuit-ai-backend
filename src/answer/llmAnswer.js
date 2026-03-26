import "dotenv/config";
import OpenAI from "openai";
import {
  selectSingleCaseEvidence,
  buildChunkBatches,
  citationFromChunk,
} from "./caseEvidenceSelector.js";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || undefined;

  if (!apiKey) {
    console.warn("[llmAnswer] OPENAI_API_KEY is missing. LLM path disabled.");
    return null;
  }

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

function compact(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function truncate(text, max = 2200) {
  const clean = compact(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}...`;
}

function responseToText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (
          part?.type === "output_text" &&
          typeof part.text === "string" &&
          part.text.trim()
        ) {
          return part.text.trim();
        }
      }
    }
  }

  return "";
}

function parseDecisionTime(payload) {
  const candidates = [
    payload?.dateOfDecision,
    payload?.decisionDate,
    payload?.judgmentDate,
    payload?.date,
    payload?.year,
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

function getReasoningConfig(model, searchResult) {
  const modelName = String(model || "").toLowerCase();
  const supportsReasoning = modelName.includes("gpt-5");

  if (!supportsReasoning) return undefined;

  const intent = searchResult?.query?.intent || "unknown";
  const isFollowUp = Boolean(
    searchResult?.trace?.router?.isFollowUp || searchResult?.query?.followUpLikely
  );
  const groupedCases = Array.isArray(searchResult?.groupedCases)
    ? searchResult.groupedCases
    : [];

  const singleHugeCase =
    groupedCases.length === 1 &&
    Array.isArray(groupedCases[0]?.chunks) &&
    groupedCases[0].chunks.length > 20;

  const complex =
    isFollowUp ||
    intent === "comparison" ||
    intent === "holding_search" ||
    intent === "full_judgment" ||
    intent === "latest_cases" ||
    singleHugeCase;

  return { effort: complex ? "medium" : "low" };
}

async function callText(client, { model, instructions, input, maxOutputTokens = 420, searchResult }) {
  const reasoning = getReasoningConfig(model, searchResult);

  const response = await client.responses.create({
    model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    ...(reasoning ? { reasoning } : {}),
    text: {
      format: {
        type: "text",
      },
    },
    store: false,
  });

  const text = responseToText(response);
  if (!text) {
    console.warn("[llmAnswer] Raw response had no assistant text.");
    return null;
  }

  return compact(text);
}

function answerStyle(searchResult) {
  const intent = searchResult?.query?.intent || "unknown";
  const q = (
    searchResult?.trace?.router?.resolvedQuery ||
    searchResult?.query?.originalQuery ||
    searchResult?.query?.normalizedQuery ||
    ""
  ).toLowerCase();

  if (intent === "latest_cases") return "latest_cases";
  if (intent === "comparison") return "comparison";
  if (intent === "holding_search") return "holding";
  if (intent === "full_judgment") return "full_judgment";

  if (q.includes("compare") || q.includes("difference between") || q.includes("distinguish")) {
    return "comparison";
  }

  if (
    q.includes("what did the court hold") ||
    q.includes("what was held") ||
    q.includes("holding") ||
    q.includes("ratio decidendi") ||
    q.includes("ratio")
  ) {
    return "holding";
  }

  if (
    q.includes("summarize") ||
    q.includes("summarise") ||
    q.includes("summary") ||
    q.includes("brief")
  ) {
    return "summary";
  }

  return "general";
}

function chooseFinalModel(searchResult) {
  const mini = process.env.OPENAI_ANSWER_MODEL || "gpt-4.1-mini";
  const big = process.env.OPENAI_REASONING_MODEL || "gpt-5.4";

  const q = (
    searchResult?.trace?.router?.resolvedQuery ||
    searchResult?.query?.normalizedQuery ||
    searchResult?.query?.originalQuery ||
    ""
  ).toLowerCase();

  const comparisonLike =
    searchResult?.query?.intent === "comparison" ||
    q.includes("compare") ||
    q.includes("difference between") ||
    q.includes("distinguish");

  const followUpLike =
    Boolean(searchResult?.trace?.router?.isFollowUp) ||
    Boolean(searchResult?.query?.followUpLikely);

  const singleHugeCase =
    Array.isArray(searchResult?.groupedCases) &&
    searchResult.groupedCases.length === 1 &&
    Array.isArray(searchResult.groupedCases[0]?.chunks) &&
    searchResult.groupedCases[0].chunks.length > 20;

  const holdingLike =
    searchResult?.query?.intent === "holding_search" ||
    q.includes("holding") ||
    q.includes("ratio decidendi") ||
    q.includes("what did the court hold");

  const latestLike = searchResult?.query?.intent === "latest_cases";

  if (comparisonLike || followUpLike || holdingLike || singleHugeCase || latestLike) {
    return big;
  }

  return mini;
}

function batchInstructions(searchResult) {
  const style = answerStyle(searchResult);

  if (style === "holding") {
    return [
      "You are extracting a memo from one slice of an Indian judgment.",
      "Use only the supplied slice.",
      "State only what this slice clearly shows about the holding, conclusion, operative reasoning, or legal determination.",
      "Do not convert one judge's reasoning into the final holding unless the slice clearly supports that.",
      "If this slice contains background or issues but not the holding, say that briefly.",
      "Return one compact paragraph of 70 to 120 words.",
      "Do not use bullets.",
      "Do not invent facts.",
    ].join(" ");
  }

  if (style === "summary") {
    return [
      "You are extracting a memo from one slice of an Indian judgment.",
      "Use only the supplied slice.",
      "State only the issue, legal question, major reasoning, or conclusion clearly visible in this slice.",
      "Do not overclaim the final majority position unless it is explicit in this slice.",
      "Return one compact paragraph of 80 to 130 words.",
      "Do not use bullets.",
      "Do not invent facts.",
    ].join(" ");
  }

  return [
    "You are extracting a memo from one slice of an Indian judgment.",
    "Use only the supplied slice.",
    "Return one compact paragraph capturing the legally relevant points clearly visible in this slice.",
    "Do not use bullets.",
    "Do not invent facts.",
  ].join(" ");
}

function finalInstructions(searchResult) {
  const style = answerStyle(searchResult);

  const shared = [
    "You are the answering layer for an Indian legal RAG system.",
    "Use only the supplied evidence and the orchestrator-provided reference resolution.",
    "Do not independently invent or reinterpret missing follow-up context.",
    "Start with a direct answer, not a disclaimer.",
    "Explain first. The UI will separately render related cases and source cards, so do not dump repetitive long case lists in the answer body.",
    "Prefer 1 to 2 short paragraphs.",
    "Do not use bullets or numbered lists in the answer body.",
    "Do not invent facts, holdings, or citations.",
    "If the evidence is partial, say so plainly and stay within the evidence.",
  ];

  if (style === "latest_cases") {
    return [
      ...shared,
      "The user is asking for latest or recent authorities.",
      "Identify the newest decision date explicitly visible in the supplied evidence.",
      "State the newest visible case first and do not describe an older case as the latest if a newer one appears in the evidence.",
      "If the evidence includes mixed courts or mixed jurisdictions, say so briefly.",
      "Keep it under 240 words.",
    ].join(" ");
  }

  if (style === "holding") {
    return [
      ...shared,
      "State only the holding or conclusion clearly supported by the evidence.",
      "If the final majority or operative holding is not fully visible, say that plainly.",
      "Keep it under 220 words.",
    ].join(" ");
  }

  if (style === "summary") {
    return [
      ...shared,
      "Summarize the issue, the legal point, and the practical takeaway.",
      "If the final outcome is only partly visible in the evidence, say so briefly.",
      "Keep it under 240 words.",
    ].join(" ");
  }

  if (style === "comparison") {
    return [
      ...shared,
      "Focus on the key difference and the most relevant common ground.",
      "Keep it under 240 words.",
    ].join(" ");
  }

  if (style === "full_judgment") {
    return [
      ...shared,
      "Provide a concise account of the supplied judgment material without pretending it is a complete official reproduction unless the evidence clearly covers the full text.",
      "Keep it under 260 words.",
    ].join(" ");
  }

  return [
    ...shared,
    "Write a concise explanatory answer grounded in the evidence.",
    "Keep it under 220 words.",
  ].join(" ");
}

function buildResolvedReferenceText(searchResult) {
  const resolved = searchResult?.trace?.resolvedReference;
  if (!resolved || !resolved.usedPriorContext) return "";

  const digests = Array.isArray(resolved.resolvedCaseDigests)
    ? resolved.resolvedCaseDigests
    : [];

  if (!digests.length) {
    return [
      "ORCHESTRATOR FOLLOW-UP RESOLUTION:",
      `Reference type: ${resolved.referenceType || "unknown"}`,
      "Prior context was used, but no specific case digest could be resolved with confidence.",
    ].join("\n");
  }

  return [
    "ORCHESTRATOR FOLLOW-UP RESOLUTION:",
    `Reference type: ${resolved.referenceType || "unknown"}`,
    ...digests.map((d, idx) =>
      [
        `Resolved case ${idx + 1}: ${d.title || "Unknown case"}`,
        d.citation ? `Citation: ${d.citation}` : "",
        d.summary ? `Prior summary: ${truncate(d.summary, 220)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ].join("\n\n");
}

function buildRouterContextText(searchResult) {
  const router = searchResult?.trace?.router;
  if (!router) return "";

  return [
    "ROUTER PLAN:",
    `Task type: ${router.taskType || "unknown"}`,
    `User goal: ${router.userGoal || ""}`,
    `Resolved query: ${router.resolvedQuery || ""}`,
    `Is follow-up: ${router.isFollowUp ? "yes" : "no"}`,
    `Follow-up reference type: ${router.followUpReferenceType || "none"}`,
    `Strategy: ${router.retrievalPlan?.strategy || "balanced"}`,
    Array.isArray(router.reasons) && router.reasons.length
      ? `Reasons: ${router.reasons.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildQueryContextText(searchResult) {
  const query =
    searchResult?.trace?.router?.resolvedQuery ||
    searchResult?.query?.originalQuery ||
    searchResult?.query?.normalizedQuery ||
    "";

  const lines = [`CURRENT USER QUERY: ${query}`];

  if (searchResult?.query?.caseTarget) {
    lines.push(`Primary case target: ${searchResult.query.caseTarget}`);
  }

  if (Array.isArray(searchResult?.query?.comparisonTargets) && searchResult.query.comparisonTargets.length) {
    lines.push(`Comparison targets: ${searchResult.query.comparisonTargets.join("; ")}`);
  }

  if (Array.isArray(searchResult?.query?.citations) && searchResult.query.citations.length) {
    lines.push(`Referenced citations: ${searchResult.query.citations.join("; ")}`);
  }

  return lines.join("\n");
}

function renderBatch(group, batchChunks) {
  const lines = [
    `CASE TITLE: ${group.title || "Unknown"}`,
    `CITATION: ${group.citation || "Unknown"}`,
    `CASE ID: ${group.caseId}`,
    `COURT: ${String(group.chunks?.[0]?.payload?.court || "Unknown")}`,
    `DATE OF DECISION: ${String(group.chunks?.[0]?.payload?.dateOfDecision || "Unknown")}`,
  ];

  for (const chunk of batchChunks) {
    const para =
      chunk.paragraphStart != null && chunk.paragraphEnd != null
        ? `paras ${chunk.paragraphStart}-${chunk.paragraphEnd}`
        : "paras unavailable";

    lines.push(`EVIDENCE (${para}): ${truncate(chunk.text || "", 1800)}`);
  }

  return lines.join("\n");
}

function normalizeLooseText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTextMatch(text, target) {
  const a = normalizeLooseText(text);
  const b = normalizeLooseText(target);

  if (!a || !b) return 0;
  if (a === b) return 6;
  if (a.includes(b) || b.includes(a)) return 4;

  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = b.split(" ").filter(Boolean);
  const overlap = bTokens.filter((tok) => aTokens.has(tok)).length;
  const ratio = overlap / Math.max(1, bTokens.length);

  if (ratio >= 0.85) return 3;
  if (ratio >= 0.65) return 2;
  if (ratio >= 0.45) return 1;
  return 0;
}

function scoreGroupAgainstResolvedDigests(group, resolvedDigests = []) {
  let score = 0;

  for (const digest of resolvedDigests) {
    if (digest?.title) {
      score += scoreTextMatch(group?.title || "", digest.title) * 2;
    }

    if (digest?.citation) {
      score += scoreTextMatch(group?.citation || "", digest.citation) * 2;
    }
  }

  return score;
}

function scoreGroupAgainstQuery(group, query = {}) {
  let score = 0;

  if (query.caseTarget) {
    score += scoreTextMatch(group?.title || "", query.caseTarget) * 2;
  }

  for (const target of query.comparisonTargets || []) {
    score += scoreTextMatch(group?.title || "", target);
  }

  for (const citation of query.citations || []) {
    score += scoreTextMatch(group?.citation || "", citation);
  }

  return score;
}

function reorderGroupedCasesFromTrace(groupedCases = [], searchResult) {
  const resolvedDigests = Array.isArray(searchResult?.trace?.resolvedReference?.resolvedCaseDigests)
    ? searchResult.trace.resolvedReference.resolvedCaseDigests
    : [];

  const referenceType = searchResult?.trace?.resolvedReference?.referenceType || "none";
  const query = searchResult?.query || {};

  if (!groupedCases.length) return groupedCases;

  const scored = groupedCases.map((group, index) => {
    let score = 0;

    score += scoreGroupAgainstResolvedDigests(group, resolvedDigests);
    score += scoreGroupAgainstQuery(group, query);

    if (referenceType === "ordinal" || referenceType === "deictic") {
      score *= 1.4;
    }

    return {
      group,
      index,
      score,
    };
  });

  const hasSignal = scored.some((item) => item.score > 0);
  if (!hasSignal) return groupedCases;

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.group);
}

function sortGroupedCasesForLatest(groupedCases = []) {
  return [...groupedCases].sort((a, b) => {
    const ta = Math.max(0, ...((a?.chunks || []).map((c) => parseDecisionTime(c?.payload || {}) || 0)));
    const tb = Math.max(0, ...((b?.chunks || []).map((c) => parseDecisionTime(c?.payload || {}) || 0)));
    if (tb !== ta) return tb - ta;
    return (b?.bestScore || 0) - (a?.bestScore || 0);
  });
}

async function summarizeSingleCase(client, searchResult) {
  const group = searchResult.groupedCases[0];
  const baseModel = process.env.OPENAI_ANSWER_MODEL || "gpt-4.1-mini";
  const finalModel = chooseFinalModel(searchResult);

  const selected = selectSingleCaseEvidence(
    group,
    searchResult?.trace?.router?.resolvedQuery ||
      searchResult?.query?.originalQuery ||
      searchResult?.query?.normalizedQuery ||
      ""
  );

  if (!selected.selectedChunks.length) return null;

  const batches = buildChunkBatches(selected.selectedChunks, 9500);
  if (!batches.length) return null;

  const routerContext = buildRouterContextText(searchResult);
  const resolvedReferenceText = buildResolvedReferenceText(searchResult);
  const queryContext = buildQueryContextText(searchResult);

  const batchMemos = [];

  for (let i = 0; i < batches.length; i += 1) {
    const batchChunks = batches[i];
    const memo = await callText(client, {
      model: baseModel,
      instructions: batchInstructions(searchResult),
      input: [
        routerContext,
        resolvedReferenceText,
        queryContext,
        `BATCH: ${i + 1} of ${batches.length}`,
        "",
        renderBatch(group, batchChunks),
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxOutputTokens: 420,
      searchResult,
    });

    if (memo) {
      const first = batchChunks[0];
      const last = batchChunks[batchChunks.length - 1];
      const citation = citationFromChunk(
        group,
        batchChunks[Math.floor(batchChunks.length / 2)] || first
      );

      batchMemos.push({
        memo,
        range: `paras ${first.paragraphStart ?? "?"}-${last.paragraphEnd ?? "?"}`,
        citation,
      });
    }
  }

  if (!batchMemos.length) return null;

  const finalText = await callText(client, {
    model: finalModel,
    instructions: finalInstructions(searchResult),
    input: [
      routerContext,
      resolvedReferenceText,
      queryContext,
      `CASE TITLE: ${group.title || "Unknown"}`,
      `CITATION: ${group.citation || "Unknown"}`,
      `COURT: ${String(group.chunks?.[0]?.payload?.court || "Unknown")}`,
      `DATE OF DECISION: ${String(group.chunks?.[0]?.payload?.dateOfDecision || "Unknown")}`,
      "",
      "BATCH MEMOS:",
      ...batchMemos.map((b) => `[${b.range}] ${b.memo}`),
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxOutputTokens: 700,
    searchResult,
  });

  if (!finalText) return null;

  return {
    model: finalModel,
    text: finalText,
    usedCitations: batchMemos.map((b) => b.citation).slice(0, 5),
  };
}

function buildMultiCaseEvidenceText(searchResult) {
  const lines = [];

  for (const [index, group] of (searchResult.groupedCases || []).slice(0, 5).entries()) {
    lines.push(`CASE ${index + 1}: ${group.title || "Unknown"}`);
    lines.push(`CITATION: ${group.citation || "Unknown"}`);
    lines.push(`CASE ID: ${group.caseId}`);
    lines.push(`COURT: ${String(group.chunks?.[0]?.payload?.court || "Unknown")}`);
    lines.push(`DATE OF DECISION: ${String(group.chunks?.[0]?.payload?.dateOfDecision || "Unknown")}`);

    const chunks = Array.isArray(group.chunks) ? group.chunks.slice(0, 2) : [];
    for (const chunk of chunks) {
      const para =
        chunk.paragraphStart != null && chunk.paragraphEnd != null
          ? `paras ${chunk.paragraphStart}-${chunk.paragraphEnd}`
          : "paras unavailable";

      lines.push(`EVIDENCE (${para}): ${truncate(chunk.text || "", 1400)}`);
    }

    lines.push("---");
  }

  return lines.join("\n");
}

export async function generateLlmAnswer(searchResult) {
  const client = getClient();
  if (!client) return null;

  try {
    let groupedCases = reorderGroupedCasesFromTrace(
      Array.isArray(searchResult.groupedCases) ? searchResult.groupedCases : [],
      searchResult
    );

    if (searchResult?.query?.intent === "latest_cases") {
      groupedCases = sortGroupedCasesForLatest(groupedCases).slice(0, 3);
    }

    const effectiveSearchResult = {
      ...searchResult,
      groupedCases,
    };

    const singleResolvedCase =
      Array.isArray(effectiveSearchResult.groupedCases) &&
      effectiveSearchResult.groupedCases.length === 1 &&
      Array.isArray(effectiveSearchResult.groupedCases[0]?.chunks) &&
      effectiveSearchResult.groupedCases[0].chunks.length > 6;

    if (singleResolvedCase) {
      const single = await summarizeSingleCase(client, effectiveSearchResult);

      if (single?.text) {
        return single;
      }
    }

    const model = chooseFinalModel(effectiveSearchResult);
    const text = await callText(client, {
      model,
      instructions: finalInstructions(effectiveSearchResult),
      input: [
        buildRouterContextText(effectiveSearchResult),
        buildResolvedReferenceText(effectiveSearchResult),
        buildQueryContextText(effectiveSearchResult),
        "",
        "EVIDENCE:",
        buildMultiCaseEvidenceText(effectiveSearchResult),
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxOutputTokens: 800,
      searchResult: effectiveSearchResult,
    });

    if (!text) return null;

    const usedCitations = [];
    for (const group of (effectiveSearchResult.groupedCases || []).slice(0, 5)) {
      const chunk = group?.chunks?.[0];
      if (chunk) usedCitations.push(citationFromChunk(group, chunk));
    }

    return {
      model,
      text,
      usedCitations,
    };
  } catch (error) {
    console.warn("[llmAnswer] LLM request failed:", error?.message || error);
    return null;
  }
}