import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

type LogSearchResult = {
  mode?: string;
  query?: any;
  groupedCases?: any[];
  evidence?: any[];
  trace?: any;
};

type LogAnswer = {
  answerType?: string;
  summary?: string;
  caseDigests?: any[];
  citations?: any[];
  confidence?: number;
  warnings?: string[];
};

type LogEventParams = {
  requestId?: string;
  conversationId?: string | undefined;
  query: string;
  messages?: any[];
  searchResult?: LogSearchResult | null;
  answer?: LogAnswer | null;
  error?: unknown;
  startedAt: number;
  finishedAt?: number;
};

const LOG_DIR =
  process.env.SEARCH_LOG_DIR ||
  path.resolve(process.cwd(), "logs", "search-traces");

function compact(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function buildRequestId(): string {
  return `req_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function safeError(error: unknown) {
  if (!error) return null;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || "",
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    stack: "",
  };
}

function summarizeMessages(messages: any[] = []) {
  return (Array.isArray(messages) ? messages : []).map((m) => ({
    role: m?.role || "user",
    content: compact(m?.content || ""),
    caseDigests: Array.isArray(m?.caseDigests)
      ? m.caseDigests.slice(0, 10).map((d: any) => ({
          caseId: d?.caseId,
          title: compact(d?.title || ""),
          citation: compact(d?.citation || ""),
          summary: compact(d?.summary || ""),
        }))
      : [],
  }));
}

function summarizeGroupedCases(groupedCases: any[] = []) {
  return (Array.isArray(groupedCases) ? groupedCases : []).slice(0, 10).map((g) => ({
    caseId: g?.caseId,
    title: compact(g?.title || ""),
    citation: compact(g?.citation || ""),
    bestScore: g?.bestScore,
    chunkCount: Array.isArray(g?.chunks) ? g.chunks.length : 0,
    topChunks: Array.isArray(g?.chunks)
      ? g.chunks.slice(0, 3).map((c: any) => ({
          chunkId: c?.chunkId,
          paragraphStart: c?.paragraphStart ?? null,
          paragraphEnd: c?.paragraphEnd ?? null,
          score: c?.score,
          preview: compact(c?.text || "").slice(0, 300),
        }))
      : [],
  }));
}

function summarizeEvidence(evidence: any[] = []) {
  return (Array.isArray(evidence) ? evidence : []).slice(0, 12).map((c) => ({
    caseId: c?.caseId,
    chunkId: c?.chunkId,
    paragraphStart: c?.paragraphStart ?? null,
    paragraphEnd: c?.paragraphEnd ?? null,
    score: c?.score,
    title: compact(c?.title || ""),
    citation: compact(c?.citation || ""),
    preview: compact(c?.text || "").slice(0, 300),
  }));
}

function summarizeAnswer(answer: LogAnswer | null | undefined) {
  if (!answer) return null;

  return {
    answerType: answer.answerType || "unknown",
    summary: compact(answer.summary || ""),
    confidence: answer.confidence ?? null,
    warnings: Array.isArray(answer.warnings) ? answer.warnings : [],
    citations: Array.isArray(answer.citations)
      ? answer.citations.slice(0, 10).map((c: any) => ({
          caseId: c?.caseId,
          title: compact(c?.title || ""),
          citation: compact(c?.citation || ""),
          chunkId: c?.chunkId || "",
          paragraphStart: c?.paragraphStart ?? null,
          paragraphEnd: c?.paragraphEnd ?? null,
        }))
      : [],
    caseDigests: Array.isArray(answer.caseDigests)
      ? answer.caseDigests.slice(0, 10).map((d: any) => ({
          caseId: d?.caseId,
          title: compact(d?.title || ""),
          citation: compact(d?.citation || ""),
          summary: compact(d?.summary || "").slice(0, 500),
        }))
      : [],
  };
}

function buildDailyLogFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${day}.jsonl`);
}

export async function logSearchTrace(params: LogEventParams) {
  const finishedAt = params.finishedAt ?? Date.now();
  const requestId = params.requestId || buildRequestId();

  const payload = {
    requestId,
    timestamp: toIsoNow(),
    conversationId: params.conversationId || null,
    query: compact(params.query),
    messages: summarizeMessages(params.messages || []),
    latencyMs: Math.max(0, finishedAt - params.startedAt),
    search: params.searchResult
      ? {
          mode: params.searchResult.mode || null,
          query: params.searchResult.query || null,
          trace: params.searchResult.trace || null,
          groupedCases: summarizeGroupedCases(params.searchResult.groupedCases || []),
          evidence: summarizeEvidence(params.searchResult.evidence || []),
        }
      : null,
    answer: summarizeAnswer(params.answer),
    error: safeError(params.error),
  };

  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(buildDailyLogFile(), `${JSON.stringify(payload)}\n`, "utf8");

  return requestId;
}