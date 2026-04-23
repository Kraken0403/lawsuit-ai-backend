import OpenAI from "openai";
import { fetchFullCaseFromQdrant } from "./qdrantCaseService.js";
import { fetchFullCaseHtmlFromSql } from "./sqlCaseService.js";
import { getLatestDetailedCaseSummary } from "./caseSummaryService.js";

export type CaseChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type CaseChatStreamEvent =
  | {
      type: "status";
      phase: string;
      trace?: Record<string, unknown> | null;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "done";
      caseId: string;
      title: string;
      citation: string;
      trace?: Record<string, unknown> | null;
    }
  | {
      type: "error";
      message: string;
      trace?: Record<string, unknown> | null;
    };

function compact(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeForSearch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQueryTokens(text: string) {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "when",
    "where",
    "which",
    "about",
    "into",
    "have",
    "has",
    "had",
    "were",
    "was",
    "are",
    "is",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "please",
    "explain",
    "tell",
    "case",
    "judgment",
    "order",
    "appeal",
    "court",
    "law",
  ]);

  return [
    ...new Set(
      normalizeForSearch(text)
        .split(" ")
        .filter((token) => token.length >= 3 && !stopwords.has(token))
    ),
  ];
}

function scoreText(text: string, tokens: string[]) {
  const hay = normalizeForSearch(text);
  let score = 0;

  for (const token of tokens) {
    if (hay.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function stripHtmlToText(html: string) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|table|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text: string) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 60);
}

function truncateText(text: string, max = 2200) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}…`;
}

function selectRelevantParagraphsFromSqlText(
  text: string,
  latestUserQuery: string,
  limit = 6
) {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return [];

  const tokens = extractQueryTokens(latestUserQuery);

  const ranked = paragraphs.map((paragraph, index) => ({
    paragraph,
    index,
    score: tokens.length ? scoreText(paragraph, tokens) : 0,
  }));

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const useful = ranked.filter((item) => item.score > 0).slice(0, limit);

  if (useful.length) {
    return useful.map((item) => item.paragraph);
  }

  return paragraphs.slice(0, limit);
}

function selectRelevantChunks(
  fullCase: Awaited<ReturnType<typeof fetchFullCaseFromQdrant>>,
  latestUserQuery: string,
  limit = 4
) {
  const tokens = extractQueryTokens(latestUserQuery);

  const ranked = [...fullCase.chunks].map((chunk, index) => ({
    chunk,
    index,
    score: tokens.length ? scoreText(chunk.text || "", tokens) : 0,
  }));

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const aIdx = a.chunk.chunkIndex ?? Number.MAX_SAFE_INTEGER;
    const bIdx = b.chunk.chunkIndex ?? Number.MAX_SAFE_INTEGER;
    return aIdx - bIdx;
  });

  const useful = ranked.filter((item) => item.score > 0).slice(0, limit);

  if (useful.length) {
    return useful.map((item) => item.chunk);
  }

  return [...fullCase.chunks]
    .sort((a, b) => {
      const aIdx = a.chunkIndex ?? Number.MAX_SAFE_INTEGER;
      const bIdx = b.chunkIndex ?? Number.MAX_SAFE_INTEGER;
      return aIdx - bIdx;
    })
    .slice(0, limit);
}

function formatChunkLabel(chunk: {
  chunkIndex: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
}) {
  const parts: string[] = [];

  if (chunk.chunkIndex != null) {
    parts.push(`chunk ${chunk.chunkIndex}`);
  }

  if (chunk.paragraphStart != null && chunk.paragraphEnd != null) {
    if (chunk.paragraphStart === chunk.paragraphEnd) {
      parts.push(`para ${chunk.paragraphStart}`);
    } else {
      parts.push(`paras ${chunk.paragraphStart}-${chunk.paragraphEnd}`);
    }
  }

  return parts.join(" · ");
}

function buildTrace(
  fullCase: Awaited<ReturnType<typeof fetchFullCaseFromQdrant>>,
  latestUserQuery: string,
  phase: string,
  extra?: {
    reasons?: string[];
    queryRewrites?: string[];
    notes?: string[];
  }
) {
  return {
    originalQuery: latestUserQuery,
    effectiveQuery: latestUserQuery,
    router: {
      strategy: "case_only_chat",
      taskType: "single_case_chat",
      entities: {
        caseTarget: fullCase.title || fullCase.citation || String(fullCase.caseId),
      },
      reasons: extra?.reasons || [
        "Restricting the answer to the currently opened case record only.",
      ],
      retrievalPlan: {
        queryRewrites: extra?.queryRewrites || [latestUserQuery],
      },
      metadataField: "",
    },
    notes: [phase, ...(extra?.notes || [])],
  };
}

function getDeltaText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }

  return "";
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

async function buildCaseChatContext(
  caseId: string | number,
  messages: CaseChatTurn[]
) {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        compact(message.content)
    )
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: compact(message.content),
    }));

  const latestUserQuery =
    [...safeMessages].reverse().find((message) => message.role === "user")
      ?.content || "";

  const [fullCase, sqlResult, existingSummary] = await Promise.all([
    fetchFullCaseFromQdrant(caseId),
    fetchFullCaseHtmlFromSql(caseId).catch(() => null),
    getLatestDetailedCaseSummary(caseId).catch(() => null),
  ]);

  const sqlPlainText = sqlResult?.jtext ? stripHtmlToText(sqlResult.jtext) : "";
  const relevantParagraphs = sqlPlainText
    ? selectRelevantParagraphsFromSqlText(sqlPlainText, latestUserQuery, 6)
    : [];
  const relevantChunks = selectRelevantChunks(fullCase, latestUserQuery, 4);

  const sections =
    existingSummary?.sectionsJson &&
    typeof existingSummary.sectionsJson === "object"
      ? existingSummary.sectionsJson
      : {};

  const caseContextParts = [
    `Case Title: ${fullCase.title}`,
    `Citation: ${fullCase.citation}`,
    `Court: ${fullCase.court}`,
    `Date of Decision: ${fullCase.dateOfDecision}`,
    `Judges: ${fullCase.judges.join(", ")}`,
    `Case Type: ${fullCase.caseType}`,
    `Case Number: ${fullCase.caseNo}`,
    `Subject: ${fullCase.subject}`,
    `Acts Referred: ${fullCase.actsReferred.join(", ")}`,
    `Final Decision: ${fullCase.finalDecision}`,
    "",
    "Stored Structured Summary:",
    JSON.stringify(sections),
  ];

  if (relevantParagraphs.length) {
    caseContextParts.push("", "Relevant Passages From Full Case Text (SQL):");
    relevantParagraphs.forEach((paragraph, index) => {
      caseContextParts.push(`\n[passage ${index + 1}]\n${truncateText(paragraph, 2400)}`);
    });
  }

  caseContextParts.push("", "Relevant Extracts From This Same Case (Qdrant Chunks):");
  relevantChunks.forEach((chunk) => {
    caseContextParts.push(
      `\n[${formatChunkLabel(chunk)}]\n${truncateText(chunk.text, 1800)}`
    );
  });

  const developerPrompt = [
    "You are a case-grounded legal assistant.",
    `You must answer only about this one case: ${fullCase.title}.`,
    "Use only the supplied case metadata, stored structured summary, SQL full-text passages, and excerpts from the same case.",
    "Do not use outside law, outside cases, or general legal knowledge beyond what is present in this case material.",
    "If the user asks something not supported by this case, clearly say that this case-only chat is limited to the provided case record.",
    "Write in clean markdown-style formatting when useful.",
    "Use short headings and bullet points when helpful.",
    "Do not invent paragraph numbers, holdings, statutes, judges, or conclusions not present in the supplied material.",
    "",
    "Case Material:",
    caseContextParts.join("\n"),
  ].join("\n");

  return {
    safeMessages,
    latestUserQuery,
    fullCase,
    developerPrompt,
  };
}

export async function askCaseOnlyChat(
  caseId: string | number,
  messages: CaseChatTurn[]
) {
  const { safeMessages, fullCase, developerPrompt } = await buildCaseChatContext(
    caseId,
    messages
  );

  const model =
    process.env.CASE_CHAT_MODEL ||
    process.env.OPENAI_ANSWER_MODEL ||
    "gpt-5-mini";

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "developer",
        content: developerPrompt,
      },
      ...safeMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
  });

  return {
    answer:
      response.choices[0]?.message?.content?.trim() ||
      "I could not generate a response for this case.",
    caseId: fullCase.caseId,
    title: fullCase.title,
    citation: fullCase.citation,
  };
}

export async function streamCaseOnlyChat(
  caseId: string | number,
  messages: CaseChatTurn[],
  writeEvent: (event: CaseChatStreamEvent) => void
) {
  const { safeMessages, latestUserQuery, fullCase, developerPrompt } =
    await buildCaseChatContext(caseId, messages);

  const model =
    process.env.CASE_CHAT_MODEL ||
    process.env.OPENAI_ANSWER_MODEL ||
    "gpt-5-mini";

  writeEvent({
    type: "status",
    phase: "Understanding case question",
    trace: buildTrace(fullCase, latestUserQuery, "Understanding case question", {
      reasons: [
        "Reading the latest user question in the context of the currently opened case.",
      ],
    }),
  });

  writeEvent({
    type: "status",
    phase: "Reviewing case record",
    trace: buildTrace(fullCase, latestUserQuery, "Reviewing case record", {
      reasons: [
        "Reviewing stored metadata, summary, and the full case record for this one case.",
      ],
    }),
  });

  writeEvent({
    type: "status",
    phase: "Selecting relevant portions of the judgment",
    trace: buildTrace(
      fullCase,
      latestUserQuery,
      "Selecting relevant portions of the judgment",
      {
        reasons: [
          "Picking the most relevant passages from the current case before answering.",
        ],
      }
    ),
  });

  const stream = await openai.chat.completions.create({
    model,
    stream: true,
    messages: [
      {
        role: "developer",
        content: developerPrompt,
      },
      ...safeMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
  });

  writeEvent({
    type: "status",
    phase: "Streaming answer",
    trace: buildTrace(fullCase, latestUserQuery, "Streaming answer", {
      reasons: [
        "Drafting the final answer strictly from the material of the opened case.",
      ],
    }),
  });

  let answer = "";

  for await (const chunk of stream) {
    const text = getDeltaText((chunk as any)?.choices?.[0]?.delta?.content);

    if (!text) continue;

    answer += text;
    writeEvent({
      type: "delta",
      text,
    });
  }

  writeEvent({
    type: "done",
    caseId: fullCase.caseId,
    title: fullCase.title,
    citation: fullCase.citation,
    trace: buildTrace(fullCase, latestUserQuery, "Streaming answer", {
      reasons: [
        "Finished the case-only answer using the opened case record.",
      ],
      notes: answer.trim()
        ? ["Completed case-only answer."]
        : ["The model returned an empty answer."],
    }),
  });

  return {
    answer: answer.trim() || "I could not generate a response for this case.",
    caseId: fullCase.caseId,
    title: fullCase.title,
    citation: fullCase.citation,
  };
}

