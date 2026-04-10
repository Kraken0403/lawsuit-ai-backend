import OpenAI from "openai";
import { fetchFullCaseFromQdrant } from "./qdrantCaseService.js";
import { getLatestDetailedCaseSummary, getOrCreateDetailedCaseSummary, } from "./caseSummaryService.js";
function compact(value) {
    return String(value ?? "").trim();
}
function normalizeForSearch(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function extractQueryTokens(text) {
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
        ...new Set(normalizeForSearch(text)
            .split(" ")
            .filter((token) => token.length >= 3 && !stopwords.has(token))),
    ];
}
function scoreChunk(text, tokens) {
    const hay = normalizeForSearch(text);
    let score = 0;
    for (const token of tokens) {
        if (hay.includes(token))
            score += 1;
    }
    return score;
}
function selectRelevantChunks(fullCase, latestUserQuery, limit = 4) {
    const tokens = extractQueryTokens(latestUserQuery);
    const ranked = [...fullCase.chunks].map((chunk, index) => ({
        chunk,
        index,
        score: tokens.length ? scoreChunk(chunk.text || "", tokens) : 0,
    }));
    ranked.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
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
function formatChunkLabel(chunk) {
    const parts = [];
    if (chunk.chunkIndex != null)
        parts.push(`chunk ${chunk.chunkIndex}`);
    if (chunk.paragraphStart != null && chunk.paragraphEnd != null) {
        if (chunk.paragraphStart === chunk.paragraphEnd) {
            parts.push(`para ${chunk.paragraphStart}`);
        }
        else {
            parts.push(`paras ${chunk.paragraphStart}-${chunk.paragraphEnd}`);
        }
    }
    return parts.join(" · ");
}
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
});
export async function askCaseOnlyChat(caseId, messages) {
    const safeMessages = (Array.isArray(messages) ? messages : [])
        .filter((message) => (message.role === "user" || message.role === "assistant") &&
        compact(message.content))
        .slice(-12)
        .map((message) => ({
        role: message.role,
        content: compact(message.content),
    }));
    const latestUserQuery = [...safeMessages].reverse().find((message) => message.role === "user")
        ?.content || "";
    const [fullCase, existingSummary] = await Promise.all([
        fetchFullCaseFromQdrant(caseId),
        getLatestDetailedCaseSummary(caseId),
    ]);
    const detailedSummary = existingSummary || (await getOrCreateDetailedCaseSummary(caseId)).summary;
    const relevantChunks = selectRelevantChunks(fullCase, latestUserQuery, 4);
    const sections = detailedSummary.sectionsJson &&
        typeof detailedSummary.sectionsJson === "object"
        ? detailedSummary.sectionsJson
        : {};
    const caseContext = [
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
        "",
        "Relevant Extracts From This Same Case:",
        ...relevantChunks.map((chunk) => `\n[${formatChunkLabel(chunk)}]\n${chunk.text}`),
    ].join("\n");
    const developerPrompt = [
        "You are a case-grounded legal assistant.",
        `You must answer only about this one case: ${fullCase.title}.`,
        "Use only the supplied case metadata, stored structured summary, and excerpts from the same case.",
        "Do not use outside law, outside cases, or general legal knowledge beyond what is present in this case material.",
        "If the user asks something not supported by this case, say that this case-only chat is limited to the provided case record.",
        "Answer clearly, deeply, and beautifully, but stay grounded.",
        "Use headings and bullet points when useful.",
        "",
        "Case Material:",
        caseContext,
    ].join("\n");
    const model = process.env.CASE_CHAT_MODEL ||
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
        answer: response.choices[0]?.message?.content?.trim() ||
            "I could not generate a response for this case.",
        caseId: fullCase.caseId,
        title: fullCase.title,
        citation: fullCase.citation,
    };
}
//# sourceMappingURL=caseChatService.js.map