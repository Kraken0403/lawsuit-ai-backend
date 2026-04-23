import { createHash } from "node:crypto";
import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import { fetchFullCaseFromQdrant } from "./qdrantCaseService.js";
import { fetchFullCaseHtmlFromSql } from "./sqlCaseService.js";
import { buildCanonicalCaseTextFromQdrant } from "./canonicalCaseText.js";
const SUMMARY_TYPE = "detailed_v1";
const pendingSummaryJobs = new Map();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
});
function emptyDetailedSummarySections() {
    return {
        overview: "",
        facts: "",
        proceduralHistory: "",
        issues: [],
        holding: "",
        reasoning: "",
        statutesAndArticles: [],
        precedentsDiscussed: [],
        finalDisposition: "",
        bench: [],
        keyTakeaways: [],
    };
}
function buildSummarySchema() {
    return {
        name: "case_summary_detailed_v1",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                overview: { type: "string" },
                facts: { type: "string" },
                proceduralHistory: { type: "string" },
                issues: {
                    type: "array",
                    items: { type: "string" },
                },
                holding: { type: "string" },
                reasoning: { type: "string" },
                statutesAndArticles: {
                    type: "array",
                    items: { type: "string" },
                },
                precedentsDiscussed: {
                    type: "array",
                    items: { type: "string" },
                },
                finalDisposition: { type: "string" },
                bench: {
                    type: "array",
                    items: { type: "string" },
                },
                keyTakeaways: {
                    type: "array",
                    items: { type: "string" },
                },
            },
            required: [
                "overview",
                "facts",
                "proceduralHistory",
                "issues",
                "holding",
                "reasoning",
                "statutesAndArticles",
                "precedentsDiscussed",
                "finalDisposition",
                "bench",
                "keyTakeaways",
            ],
        },
    };
}
function renderDetailedSummaryMarkdown(meta, sections) {
    const lines = [];
    if (meta.title)
        lines.push(`# ${meta.title}`);
    if (meta.citation)
        lines.push(`**Citation:** ${meta.citation}`);
    if (meta.court)
        lines.push(`**Court:** ${meta.court}`);
    if (meta.dateOfDecision) {
        lines.push(`**Date of Decision:** ${meta.dateOfDecision}`);
    }
    lines.push("");
    lines.push("## Overview");
    lines.push(sections.overview || "");
    lines.push("");
    lines.push("## Facts");
    lines.push(sections.facts || "");
    lines.push("");
    lines.push("## Procedural History");
    lines.push(sections.proceduralHistory || "");
    lines.push("");
    lines.push("## Issues");
    for (const item of sections.issues || []) {
        lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("## Holding");
    lines.push(sections.holding || "");
    lines.push("");
    lines.push("## Reasoning");
    lines.push(sections.reasoning || "");
    lines.push("");
    lines.push("## Statutes and Articles");
    for (const item of sections.statutesAndArticles || []) {
        lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("## Precedents Discussed");
    for (const item of sections.precedentsDiscussed || []) {
        lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("## Final Disposition");
    lines.push(sections.finalDisposition || "");
    lines.push("");
    lines.push("## Bench");
    for (const item of sections.bench || []) {
        lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("## Key Takeaways");
    for (const item of sections.keyTakeaways || []) {
        lines.push(`- ${item}`);
    }
    return lines.join("\n");
}
function stripHtmlToCaseText(html) {
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
function normalizeCaseText(text) {
    return String(text || "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function isUsableCaseText(text, minLength = 1200) {
    return normalizeCaseText(text).length >= minLength;
}
function splitParagraphs(text) {
    return String(text || "")
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 40);
}
function buildFocusedSummaryInput(text, maxChars = 32000) {
    const normalized = normalizeCaseText(text);
    const paragraphs = splitParagraphs(normalized);
    if (!paragraphs.length) {
        return normalized.slice(0, maxChars);
    }
    const keywords = [
        "facts",
        "issue",
        "issues",
        "held",
        "holding",
        "reasoning",
        "analysis",
        "discussion",
        "conclusion",
        "order",
        "relief",
        "disposed",
        "dismissed",
        "allowed",
        "petition",
        "appeal",
        "appellant",
        "respondent",
        "plaintiff",
        "defendant",
        "bench",
        "judge",
        "judges",
    ];
    const scored = paragraphs.map((paragraph, index) => {
        const lower = paragraph.toLowerCase();
        let score = 0;
        if (index < 10)
            score += 4;
        if (index >= paragraphs.length - 10)
            score += 5;
        for (const keyword of keywords) {
            if (lower.includes(keyword)) {
                score += 2;
            }
        }
        if (paragraph.length >= 200 && paragraph.length <= 1800) {
            score += 1;
        }
        return {
            paragraph,
            index,
            score,
        };
    });
    const picked = [];
    const used = new Set();
    let total = 0;
    const take = (items) => {
        for (const item of items) {
            if (used.has(item.index))
                continue;
            if (total + item.paragraph.length + 2 > maxChars)
                continue;
            used.add(item.index);
            picked.push(item.paragraph);
            total += item.paragraph.length + 2;
        }
    };
    take(scored.slice(0, 8));
    take([...scored].sort((a, b) => b.score - a.score).slice(0, 24));
    take(scored.slice(-8));
    const combined = picked.join("\n\n").trim();
    return combined || normalized.slice(0, maxChars);
}
function cleanMarkdownInline(text) {
    return String(text || "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
        .trim();
}
function cleanMarkdownBlock(text) {
    return String(text || "")
        .replace(/\r/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function markdownListToArray(text) {
    return String(text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim())
        .map(cleanMarkdownInline)
        .filter(Boolean);
}
function parseDetailedSummaryMarkdown(markdown) {
    const sections = emptyDetailedSummarySections();
    const headingMap = {
        Overview: "overview",
        Facts: "facts",
        "Procedural History": "proceduralHistory",
        Issues: "issues",
        Holding: "holding",
        Reasoning: "reasoning",
        "Statutes and Articles": "statutesAndArticles",
        "Precedents Discussed": "precedentsDiscussed",
        "Final Disposition": "finalDisposition",
        Bench: "bench",
        "Key Takeaways": "keyTakeaways",
    };
    const regex = /^##\s+(Overview|Facts|Procedural History|Issues|Holding|Reasoning|Statutes and Articles|Precedents Discussed|Final Disposition|Bench|Key Takeaways)\s*$/gim;
    const matches = [...markdown.matchAll(regex)];
    for (let i = 0; i < matches.length; i += 1) {
        const match = matches[i];
        const heading = match[1];
        const key = headingMap[heading];
        if (!key || typeof match.index !== "number")
            continue;
        const start = match.index + match[0].length;
        const end = i + 1 < matches.length && typeof matches[i + 1].index === "number"
            ? matches[i + 1].index
            : markdown.length;
        const rawBlock = markdown.slice(start, end).trim();
        if (key === "issues" ||
            key === "statutesAndArticles" ||
            key === "precedentsDiscussed" ||
            key === "bench" ||
            key === "keyTakeaways") {
            sections[key] = markdownListToArray(rawBlock);
        }
        else {
            sections[key] = cleanMarkdownBlock(rawBlock);
        }
    }
    return sections;
}
function getDeltaText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (typeof part === "string")
                return part;
            if (part &&
                typeof part === "object" &&
                "text" in part &&
                typeof part.text === "string") {
                return part.text;
            }
            return "";
        })
            .join("");
    }
    return "";
}
function splitIntoStreamChunks(text, size = 140) {
    const chunks = [];
    let index = 0;
    while (index < text.length) {
        chunks.push(text.slice(index, index + size));
        index += size;
    }
    return chunks;
}
async function generateDetailedSummarySectionsFromText(input) {
    const model = process.env.CASE_SUMMARY_MODEL ||
        process.env.OPENAI_ANSWER_MODEL ||
        "gpt-5-mini";
    const developerPrompt = [
        "You are generating a detailed Indian case-law summary.",
        "Return only valid JSON matching the provided schema.",
        "Do not invent facts not grounded in the supplied case text and metadata.",
        "Keep the summary practical, legally useful, and clearly sectioned.",
        "If some detail is unavailable, return an empty string or empty array.",
        "Prefer concise but meaningful sections over overly long repetition.",
    ].join(" ");
    const userPrompt = [
        `Title: ${input.title}`,
        `Citation: ${input.citation}`,
        `Court: ${input.court}`,
        `Date of Decision: ${input.dateOfDecision}`,
        `Judges: ${input.judges.join(", ")}`,
        `Case Type: ${input.caseType}`,
        `Case Number: ${input.caseNo}`,
        `Subject: ${input.subject}`,
        `Acts Referred: ${input.actsReferred.join(", ")}`,
        `Final Decision: ${input.finalDecision}`,
        "",
        "Generate a detailed structured legal summary for the following case text:",
        "",
        input.text,
    ].join("\n");
    const response = await openai.chat.completions.create({
        model,
        response_format: {
            type: "json_schema",
            json_schema: buildSummarySchema(),
        },
        messages: [
            {
                role: "developer",
                content: developerPrompt,
            },
            {
                role: "user",
                content: userPrompt,
            },
        ],
    });
    const content = response.choices[0]?.message?.content || "{}";
    const sections = JSON.parse(content);
    return {
        model,
        sections,
    };
}
async function streamDetailedSummaryMarkdownFromText(input, onDelta) {
    const model = process.env.CASE_SUMMARY_MODEL ||
        process.env.OPENAI_ANSWER_MODEL ||
        "gpt-5-mini";
    const developerPrompt = [
        "You are generating a detailed Indian case-law summary.",
        "Return only markdown.",
        "Do not invent facts not grounded in the supplied case text and metadata.",
        "Use exactly these headings, in this exact order:",
        "## Overview",
        "## Facts",
        "## Procedural History",
        "## Issues",
        "## Holding",
        "## Reasoning",
        "## Statutes and Articles",
        "## Precedents Discussed",
        "## Final Disposition",
        "## Bench",
        "## Key Takeaways",
        "For Issues, Statutes and Articles, Precedents Discussed, Bench, and Key Takeaways, use markdown bullet points.",
        "For unavailable details, leave the section blank instead of inventing content.",
        "Do not include code fences, intro text, outro text, or any heading outside the required headings.",
    ].join("\n");
    const userPrompt = [
        `Title: ${input.title}`,
        `Citation: ${input.citation}`,
        `Court: ${input.court}`,
        `Date of Decision: ${input.dateOfDecision}`,
        `Judges: ${input.judges.join(", ")}`,
        `Case Type: ${input.caseType}`,
        `Case Number: ${input.caseNo}`,
        `Subject: ${input.subject}`,
        `Acts Referred: ${input.actsReferred.join(", ")}`,
        `Final Decision: ${input.finalDecision}`,
        "",
        "Generate the detailed summary for the following case text:",
        "",
        input.text,
    ].join("\n");
    const stream = await openai.chat.completions.create({
        model,
        stream: true,
        messages: [
            {
                role: "developer",
                content: developerPrompt,
            },
            {
                role: "user",
                content: userPrompt,
            },
        ],
    });
    let markdown = "";
    for await (const chunk of stream) {
        const text = getDeltaText(chunk?.choices?.[0]?.delta?.content);
        if (!text)
            continue;
        markdown += text;
        onDelta(text);
    }
    return {
        model,
        markdown: markdown.trim(),
    };
}
async function prepareDetailedSummarySource(caseId, options) {
    const providedHtml = typeof options?.html === "string" ? options.html : "";
    const providedHtmlText = stripHtmlToCaseText(providedHtml);
    const fullCasePromise = fetchFullCaseFromQdrant(caseId);
    const shouldFetchSql = !isUsableCaseText(providedHtmlText);
    const sqlCasePromise = shouldFetchSql
        ? fetchFullCaseHtmlFromSql(caseId).catch(() => null)
        : Promise.resolve(null);
    const [fullCase, sqlCase] = await Promise.all([fullCasePromise, sqlCasePromise]);
    const canonical = buildCanonicalCaseTextFromQdrant(fullCase);
    const sqlText = sqlCase?.jtext ? stripHtmlToCaseText(sqlCase.jtext) : "";
    let sourceType = "sql_html";
    let sourceText = "";
    if (isUsableCaseText(providedHtmlText)) {
        sourceType = "sql_html";
        sourceText = providedHtmlText;
    }
    else if (isUsableCaseText(sqlText)) {
        sourceType = "sql_html";
        sourceText = sqlText;
    }
    else {
        sourceType = "qdrant";
        sourceText = normalizeCaseText(canonical.text);
    }
    const focusedText = buildFocusedSummaryInput(sourceText);
    const sourceHash = createHash("sha256").update(sourceText).digest("hex");
    return {
        fullCase,
        canonical,
        sourceType,
        sourceText,
        focusedText,
        sourceHash,
    };
}
export async function getLatestDetailedCaseSummary(caseId) {
    return prisma.caseSummary.findFirst({
        where: {
            caseId: String(caseId),
            summaryType: SUMMARY_TYPE,
            status: "ready",
        },
        orderBy: {
            updatedAt: "desc",
        },
    });
}
export async function getOrCreateDetailedCaseSummary(caseId, options) {
    const jobKey = `${String(caseId)}:${SUMMARY_TYPE}`;
    const existingJob = pendingSummaryJobs.get(jobKey);
    if (existingJob) {
        return existingJob;
    }
    const job = (async () => {
        const prepared = await prepareDetailedSummarySource(caseId, options);
        const existing = await prisma.caseSummary.findFirst({
            where: {
                caseId: prepared.canonical.caseId,
                summaryType: SUMMARY_TYPE,
                sourceHash: prepared.sourceHash,
                status: "ready",
            },
        });
        if (existing) {
            return {
                cached: true,
                summary: existing,
            };
        }
        const { model, sections } = await generateDetailedSummarySectionsFromText({
            title: prepared.fullCase.title,
            citation: prepared.fullCase.citation,
            court: prepared.fullCase.court,
            dateOfDecision: prepared.fullCase.dateOfDecision,
            judges: prepared.fullCase.judges,
            caseType: prepared.fullCase.caseType,
            caseNo: prepared.fullCase.caseNo,
            subject: prepared.fullCase.subject,
            actsReferred: prepared.fullCase.actsReferred,
            finalDecision: prepared.fullCase.finalDecision,
            text: prepared.focusedText,
        });
        const renderedMarkdown = renderDetailedSummaryMarkdown({
            title: prepared.fullCase.title,
            citation: prepared.fullCase.citation,
            court: prepared.fullCase.court,
            dateOfDecision: prepared.fullCase.dateOfDecision,
        }, sections);
        try {
            const saved = await prisma.caseSummary.create({
                data: {
                    caseId: prepared.canonical.caseId,
                    fileName: prepared.canonical.fileName,
                    title: prepared.fullCase.title || null,
                    citation: prepared.fullCase.citation || null,
                    summaryType: SUMMARY_TYPE,
                    sourceType: prepared.sourceType,
                    sourceHash: prepared.sourceHash,
                    modelName: model,
                    status: "ready",
                    sectionsJson: sections,
                    renderedMarkdown,
                },
            });
            return {
                cached: false,
                summary: saved,
            };
        }
        catch (error) {
            if (error?.code === "P2002") {
                const concurrent = await prisma.caseSummary.findFirst({
                    where: {
                        caseId: prepared.canonical.caseId,
                        summaryType: SUMMARY_TYPE,
                        sourceHash: prepared.sourceHash,
                        status: "ready",
                    },
                });
                if (concurrent) {
                    return {
                        cached: true,
                        summary: concurrent,
                    };
                }
            }
            throw error;
        }
    })().finally(() => {
        pendingSummaryJobs.delete(jobKey);
    });
    pendingSummaryJobs.set(jobKey, job);
    return job;
}
export async function streamDetailedCaseSummary(caseId, options, writeEvent) {
    const prepared = await prepareDetailedSummarySource(caseId, options);
    const existing = await prisma.caseSummary.findFirst({
        where: {
            caseId: prepared.canonical.caseId,
            summaryType: SUMMARY_TYPE,
            sourceHash: prepared.sourceHash,
            status: "ready",
        },
    });
    if (existing) {
        writeEvent({
            type: "status",
            phase: "Loading saved detailed summary",
        });
        const renderedMarkdown = existing.renderedMarkdown ||
            renderDetailedSummaryMarkdown({
                title: prepared.fullCase.title,
                citation: prepared.fullCase.citation,
                court: prepared.fullCase.court,
                dateOfDecision: prepared.fullCase.dateOfDecision,
            }, existing.sectionsJson ||
                emptyDetailedSummarySections());
        for (const chunk of splitIntoStreamChunks(renderedMarkdown, 140)) {
            writeEvent({
                type: "delta",
                text: chunk,
            });
        }
        writeEvent({
            type: "done",
            cached: true,
            summary: existing,
        });
        return {
            cached: true,
            summary: existing,
        };
    }
    writeEvent({
        type: "status",
        phase: "Preparing case text",
    });
    writeEvent({
        type: "status",
        phase: "Generating detailed summary",
    });
    const { model, markdown } = await streamDetailedSummaryMarkdownFromText({
        title: prepared.fullCase.title,
        citation: prepared.fullCase.citation,
        court: prepared.fullCase.court,
        dateOfDecision: prepared.fullCase.dateOfDecision,
        judges: prepared.fullCase.judges,
        caseType: prepared.fullCase.caseType,
        caseNo: prepared.fullCase.caseNo,
        subject: prepared.fullCase.subject,
        actsReferred: prepared.fullCase.actsReferred,
        finalDecision: prepared.fullCase.finalDecision,
        text: prepared.focusedText,
    }, (text) => {
        writeEvent({
            type: "delta",
            text,
        });
    });
    const parsedSections = parseDetailedSummaryMarkdown(markdown);
    const renderedMarkdown = renderDetailedSummaryMarkdown({
        title: prepared.fullCase.title,
        citation: prepared.fullCase.citation,
        court: prepared.fullCase.court,
        dateOfDecision: prepared.fullCase.dateOfDecision,
    }, parsedSections);
    try {
        const saved = await prisma.caseSummary.create({
            data: {
                caseId: prepared.canonical.caseId,
                fileName: prepared.canonical.fileName,
                title: prepared.fullCase.title || null,
                citation: prepared.fullCase.citation || null,
                summaryType: SUMMARY_TYPE,
                sourceType: prepared.sourceType,
                sourceHash: prepared.sourceHash,
                modelName: model,
                status: "ready",
                sectionsJson: parsedSections,
                renderedMarkdown,
            },
        });
        writeEvent({
            type: "done",
            cached: false,
            summary: saved,
        });
        return {
            cached: false,
            summary: saved,
        };
    }
    catch (error) {
        if (error?.code === "P2002") {
            const concurrent = await prisma.caseSummary.findFirst({
                where: {
                    caseId: prepared.canonical.caseId,
                    summaryType: SUMMARY_TYPE,
                    sourceHash: prepared.sourceHash,
                    status: "ready",
                },
            });
            if (concurrent) {
                writeEvent({
                    type: "done",
                    cached: true,
                    summary: concurrent,
                });
                return {
                    cached: true,
                    summary: concurrent,
                };
            }
        }
        throw error;
    }
}
//# sourceMappingURL=caseSummaryService.js.map