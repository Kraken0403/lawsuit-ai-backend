import express from "express";
import prisma from "../lib/prisma.js";
import { orchestrateSearch } from "../orchestrator/searchOrchestrator.js";
import { composeAnswer } from "../answer/composeAnswer.js";
import { extractUnresolvedPlaceholders } from "../drafting/placeholders.js";
import { orchestrateDrafting } from "../drafting/orchestrateDrafting.js";
import { toNullableJsonInput } from "../lib/prismaJson.js";
import { optionalAuth, requireAuth, } from "../middleware/auth.js";
import { deriveConversationTitle } from "../utils/auth.js";
import { normalizeAllowedCourts, restrictSelectedCourtIds, } from "../utils/allowedCourts.js";
export const chatStreamRouter = express.Router();
function normalizeComparableText(value) {
    return String(value ?? "")
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function normalizeTitleWhitespace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}
function stripSubjectPrefix(value) {
    return normalizeTitleWhitespace(value)
        .replace(/^subject\s*[:\-]\s*/i, "")
        .trim();
}
function countBracketPlaceholders(value) {
    return (String(value || "").match(/\[[^\]]+\]/g) || []).length;
}
function looksLikePromptStyleTitle(candidate, query) {
    const a = normalizeComparableText(candidate);
    const b = normalizeComparableText(query);
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    return (a.startsWith("draft ") ||
        a.startsWith("prepare ") ||
        a.startsWith("create ") ||
        a.startsWith("make "));
}
function looksLikeScaffoldTitle(candidate) {
    const value = normalizeTitleWhitespace(candidate).toLowerCase();
    if (!value)
        return true;
    const scaffoldPhrases = [
        "your name",
        "your company",
        "your address",
        "sender name",
        "sender company",
        "sender address",
        "recipient name",
        "recipient company",
        "recipient address",
        "company name",
        "city, state",
        "zip code",
        "pin code",
        "email address",
        "phone number",
        "mobile number",
        "invoice number",
        "invoice date",
        "due date",
        "amount due",
        "insert date",
        "date]",
        "sir/madam",
    ];
    if (/^to[,]?$/.test(value) ||
        /^dear\b/.test(value) ||
        /^date\s*[:\-]/.test(value)) {
        return true;
    }
    if (scaffoldPhrases.some((phrase) => value.includes(phrase))) {
        return true;
    }
    if (/^\[[^\]]+\]$/.test(value)) {
        return true;
    }
    if (countBracketPlaceholders(value) >= 2) {
        return true;
    }
    const placeholderOnly = value
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/[\/,.-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!placeholderOnly)
        return true;
    return false;
}
function isBadDraftTitleCandidate(candidate, query) {
    const text = normalizeTitleWhitespace(candidate);
    if (!text)
        return true;
    const generic = /^(\s*template( content)?|untitled|new chat)\b/i.test(text) ||
        /^```/.test(text) ||
        /^markdown$/i.test(text);
    const subjectlessPlaceholder = countBracketPlaceholders(text) >= 2 ||
        looksLikeScaffoldTitle(text) ||
        looksLikeAddress(text) ||
        looksLikePromptStyleTitle(text, query);
    return generic || subjectlessPlaceholder;
}
function extractFactTitleCandidate(plan) {
    const facts = plan?.extractedFacts || {};
    const candidates = [
        facts?.subject,
        facts?.core_request_or_purpose,
        facts?.what_you_want_the_document_to_achieve,
        facts?.grievance_or_default,
        facts?.demands,
    ];
    for (const candidate of candidates) {
        const text = stripSubjectPrefix(candidate);
        if (text)
            return text;
    }
    return "";
}
function extractTitleFromDraftBody(text, query) {
    const withoutFences = stripCodeFence(String(text || ""));
    const stripped = stripLeadingAddressBlock(withoutFences || "");
    const subject = stripSubjectPrefix(findSubjectLine(stripped) || findSubjectLine(withoutFences));
    if (subject && !isBadDraftTitleCandidate(subject, query)) {
        return subject;
    }
    const lines = stripped
        .split(/\r?\n/)
        .map((line) => normalizeTitleWhitespace(line))
        .filter(Boolean);
    for (const line of lines.slice(0, 8)) {
        if (!isBadDraftTitleCandidate(line, query)) {
            return line;
        }
    }
    return "";
}
function deriveStableDraftTitle(params) {
    const { requestedTitle = "", query, draftingResult, rawBody } = params;
    const templateTop = draftingResult.plan?.templateCandidates?.[0] || null;
    const templateTitle = normalizeTitleWhitespace(templateTop?.title || "");
    const templateRaw = String(templateTop?.rawText || "");
    const bodyTitle = extractTitleFromDraftBody(rawBody, query);
    const templateSubject = stripSubjectPrefix(findSubjectLine(templateRaw));
    const factTitle = extractFactTitleCandidate(draftingResult.plan);
    const requested = normalizeTitleWhitespace(requestedTitle);
    if (bodyTitle && !isBadDraftTitleCandidate(bodyTitle, query)) {
        return sanitizeDocumentTitle(bodyTitle);
    }
    if (templateSubject && !isBadDraftTitleCandidate(templateSubject, query)) {
        return sanitizeDocumentTitle(templateSubject);
    }
    if (templateTitle && !isBadDraftTitleCandidate(templateTitle, query)) {
        return sanitizeDocumentTitle(templateTitle);
    }
    if (factTitle && !isBadDraftTitleCandidate(factTitle, query)) {
        return sanitizeDocumentTitle(factTitle);
    }
    if (requested && !isBadDraftTitleCandidate(requested, query)) {
        return sanitizeDocumentTitle(requested);
    }
    const synthesized = synthesizeTitleFromPlan(draftingResult.plan, query, rawBody);
    if (synthesized && !isBadDraftTitleCandidate(synthesized, query)) {
        return sanitizeDocumentTitle(synthesized);
    }
    if (draftingResult.plan?.detectedFamily === "notice") {
        return "Legal Notice";
    }
    const fam = normalizeTitleWhitespace(String(draftingResult.plan?.detectedFamily || "document").replace(/_/g, " "));
    return fam ? capitalizeWords(fam) : "Draft";
}
function looksLikeDuplicateDigestSummary(digestSummary, assistantAnswer) {
    const digest = normalizeComparableText(digestSummary);
    const answer = normalizeComparableText(assistantAnswer);
    if (!digest || !answer)
        return false;
    if (digest === answer)
        return true;
    if (digest.length > 80 && answer.includes(digest))
        return true;
    if (answer.length > 80 && digest.includes(answer))
        return true;
    return false;
}
function pickCaseDigestSummary(digest, assistantAnswer) {
    const candidates = [
        digest?.summary,
        digest?.excerpt,
        digest?.excerptText,
        digest?.snippet,
        digest?.chunkText,
        digest?.chunkDetail,
        digest?.text,
        digest?.quote,
        digest?.holding,
        digest?.relevantPassage,
    ]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
    for (const candidate of candidates) {
        if (!looksLikeDuplicateDigestSummary(candidate, assistantAnswer)) {
            return candidate;
        }
    }
    return "Open Summary to inspect the extracted chunk for this case.";
}
async function createDraftDocumentFromDraftingResult(params) {
    const { userId, conversationId, title, query, draftingResult } = params;
    const sourceTemplateIds = draftingResult.plan.templateCandidates.map((item) => item.id);
    const unresolvedPlaceholders = extractUnresolvedPlaceholders(draftingResult.summary || "");
    const document = await prisma.$transaction(async (tx) => {
        const rawMarkdown = String(draftingResult.summary || "").trim();
        let cleaned = rawMarkdown;
        cleaned = stripCodeFence(cleaned);
        const finalTitle = deriveStableDraftTitle({
            requestedTitle: title,
            query,
            draftingResult,
            rawBody: cleaned || rawMarkdown || "",
        });
        const heading = extractHeading(cleaned);
        if (heading && heading === finalTitle) {
            cleaned = cleaned.replace(/^\s*#{1,3}\s+.*\r?\n/, "").trim();
        }
        const html = simpleMarkdownToHtml(cleaned || rawMarkdown || "");
        const created = await tx.draftDocument.create({
            data: {
                userId,
                conversationId,
                title: sanitizeDocumentTitle(finalTitle),
                family: draftingResult.plan.detectedFamily || "misc",
                subtype: draftingResult.plan.detectedSubtype || null,
                strategy: draftingResult.plan.strategy,
                matchLevel: draftingResult.plan.matchLevel,
                sourceTemplateIdsJson: toNullableJsonInput(sourceTemplateIds),
                inputDataJson: toNullableJsonInput({ query }),
                draftingPlanJson: toNullableJsonInput(draftingResult.plan),
                draftMarkdown: cleaned || rawMarkdown,
                draftHtml: html || null,
                editorJson: toNullableJsonInput(null),
                unresolvedPlaceholdersJson: toNullableJsonInput(unresolvedPlaceholders),
                status: "DRAFT",
            },
        });
        await tx.draftDocumentVersion.create({
            data: {
                draftDocumentId: created.id,
                versionNumber: 1,
                title: created.title,
                family: created.family,
                subtype: created.subtype,
                strategy: created.strategy,
                matchLevel: created.matchLevel,
                sourceTemplateIdsJson: toNullableJsonInput(created.sourceTemplateIdsJson),
                inputDataJson: toNullableJsonInput(created.inputDataJson),
                draftingPlanJson: toNullableJsonInput(created.draftingPlanJson),
                draftMarkdown: created.draftMarkdown,
                draftHtml: created.draftHtml,
                editorJson: toNullableJsonInput(created.editorJson),
                unresolvedPlaceholdersJson: toNullableJsonInput(created.unresolvedPlaceholdersJson),
                createdByUserId: userId,
            },
        });
        return created;
    });
    return document;
}
function stripHtmlToPlainTextForDraftContext(value) {
    return String(value || "")
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}
function normalizeDraftContextText(value) {
    const source = String(value || "").trim();
    if (!source)
        return "";
    if (/<\/?[a-z][\s\S]*>/i.test(source)) {
        return stripHtmlToPlainTextForDraftContext(source);
    }
    return stripCodeFence(source) || source;
}
function extractFilledValuesFromInputData(inputDataJson) {
    if (!inputDataJson || typeof inputDataJson !== "object" || Array.isArray(inputDataJson)) {
        return {};
    }
    const raw = inputDataJson.filledValues;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    return Object.fromEntries(Object.entries(raw)
        .map(([key, value]) => [String(key || "").trim(), compact(value)])
        .filter(([key, value]) => key && value));
}
async function loadCurrentDraftDocumentContext(params) {
    const requestedId = compact(params.draftDocumentId);
    const liveText = normalizeDraftContextText(params.currentDraftText || "");
    const liveTitle = compact(params.currentDraftTitle);
    const document = requestedId
        ? await prisma.draftDocument.findFirst({
            where: {
                id: requestedId,
                userId: params.userId,
            },
            select: {
                id: true,
                conversationId: true,
                title: true,
                family: true,
                subtype: true,
                strategy: true,
                matchLevel: true,
                sourceTemplateIdsJson: true,
                inputDataJson: true,
                draftingPlanJson: true,
                draftMarkdown: true,
                draftHtml: true,
                editorJson: true,
                unresolvedPlaceholdersJson: true,
                status: true,
            },
        })
        : null;
    const persistedText = normalizeDraftContextText(document?.draftMarkdown || document?.draftHtml || "");
    const filledValues = extractFilledValuesFromInputData(document?.inputDataJson);
    const contextTitle = liveTitle || compact(document?.title);
    const contextText = liveText || persistedText;
    const context = contextTitle || contextText || Object.keys(filledValues).length
        ? {
            id: document?.id || requestedId || null,
            title: contextTitle || null,
            draftText: contextText || null,
            filledValues,
        }
        : null;
    return {
        document,
        context,
    };
}
async function updateDraftDocumentFromDraftingResult(params) {
    const { existingDocument, userId, query, title, draftingResult } = params;
    const sourceTemplateIds = draftingResult.plan.templateCandidates.map((item) => item.id);
    const unresolvedPlaceholders = extractUnresolvedPlaceholders(draftingResult.summary || "");
    const rawMarkdown = String(draftingResult.summary || "").trim();
    let cleaned = stripCodeFence(rawMarkdown);
    const finalTitle = deriveStableDraftTitle({
        requestedTitle: title || existingDocument.title,
        query,
        draftingResult,
        rawBody: cleaned || rawMarkdown || "",
    });
    const heading = extractHeading(cleaned);
    if (heading && heading === finalTitle) {
        cleaned = cleaned.replace(/^\s*#{1,3}\s+.*\r?\n/, "").trim();
    }
    const html = simpleMarkdownToHtml(cleaned || rawMarkdown || "");
    const latestVersion = await prisma.draftDocumentVersion.findFirst({
        where: { draftDocumentId: existingDocument.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
    });
    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;
    const previousInputData = existingDocument.inputDataJson &&
        typeof existingDocument.inputDataJson === "object" &&
        !Array.isArray(existingDocument.inputDataJson)
        ? existingDocument.inputDataJson
        : {};
    const updated = await prisma.$transaction(async (tx) => {
        const updatedDocument = await tx.draftDocument.update({
            where: { id: existingDocument.id },
            data: {
                title: sanitizeDocumentTitle(finalTitle),
                family: draftingResult.plan.detectedFamily || existingDocument.family || "misc",
                subtype: draftingResult.plan.detectedSubtype || null,
                strategy: draftingResult.plan.strategy,
                matchLevel: draftingResult.plan.matchLevel,
                sourceTemplateIdsJson: toNullableJsonInput(sourceTemplateIds),
                inputDataJson: toNullableJsonInput({
                    ...previousInputData,
                    query,
                }),
                draftingPlanJson: toNullableJsonInput(draftingResult.plan),
                draftMarkdown: cleaned || rawMarkdown,
                draftHtml: html || null,
                editorJson: toNullableJsonInput(null),
                unresolvedPlaceholdersJson: toNullableJsonInput(unresolvedPlaceholders),
                status: existingDocument.status || "DRAFT",
            },
        });
        await tx.draftDocumentVersion.create({
            data: {
                draftDocumentId: updatedDocument.id,
                versionNumber: nextVersionNumber,
                title: updatedDocument.title,
                family: updatedDocument.family,
                subtype: updatedDocument.subtype,
                strategy: updatedDocument.strategy,
                matchLevel: updatedDocument.matchLevel,
                sourceTemplateIdsJson: toNullableJsonInput(updatedDocument.sourceTemplateIdsJson),
                inputDataJson: toNullableJsonInput(updatedDocument.inputDataJson),
                draftingPlanJson: toNullableJsonInput(updatedDocument.draftingPlanJson),
                draftMarkdown: updatedDocument.draftMarkdown,
                draftHtml: updatedDocument.draftHtml,
                editorJson: toNullableJsonInput(updatedDocument.editorJson),
                unresolvedPlaceholdersJson: toNullableJsonInput(updatedDocument.unresolvedPlaceholdersJson),
                createdByUserId: userId,
            },
        });
        return updatedDocument;
    });
    return updated;
}
async function saveDraftDocumentFromDraftingResult(params) {
    if (params.existingDocument?.id) {
        return updateDraftDocumentFromDraftingResult({
            existingDocument: params.existingDocument,
            userId: params.userId,
            query: params.query,
            title: params.title,
            draftingResult: params.draftingResult,
        });
    }
    return createDraftDocumentFromDraftingResult({
        userId: params.userId,
        conversationId: params.conversationId,
        title: params.title,
        query: params.query,
        draftingResult: params.draftingResult,
    });
}
function writeEvent(res, data) {
    if (res.writableEnded || res.destroyed)
        return;
    res.write(`${JSON.stringify(data)}\n`);
    if (typeof res.flush === "function") {
        res.flush();
    }
}
function citationRange(c) {
    if (c.paragraphStart == null || c.paragraphEnd == null)
        return "";
    if (c.paragraphStart === c.paragraphEnd)
        return `para ${c.paragraphStart}`;
    return `paras ${c.paragraphStart}-${c.paragraphEnd}`;
}
function chunkText(text, size = 6) {
    const parts = [];
    let i = 0;
    while (i < text.length) {
        parts.push(text.slice(i, i + size));
        i += size;
    }
    return parts;
}
function compact(value) {
    return String(value ?? "").trim();
}
function sanitizeDocumentTitle(title) {
    let t = String(title ?? "").trim();
    t = stripCodeFence(t) || t;
    if (!t)
        return t;
    t = t.replace(/^\s*#+\s*/, "").trim();
    t = t.replace(/^subject\s*[:\-]\s*/i, "").trim();
    t = t.replace(/^re\s*[:\-]\s*/i, "").trim();
    if (/^\[[^\]]+\]$/.test(t))
        return "";
    return t;
}
function stripCodeFence(md) {
    const trimmed = md.trimStart();
    const fenceMatch = trimmed.match(/^```(\w+)?\n([\s\S]*?)\n```\s*$/);
    if (fenceMatch)
        return fenceMatch[2];
    const leadingFenceMatch = trimmed.match(/^```(\w+)?\n([\s\S]*?)\n```\n?/);
    if (leadingFenceMatch)
        return trimmed.slice(leadingFenceMatch[0].length);
    return md;
}
function extractHeading(md) {
    const content = stripCodeFence(md || "");
    const m = content.match(/^\s*#{1,3}\s+(.+)\r?\n/);
    return m ? m[1].trim() : null;
}
function looksLikeAddress(text) {
    if (!text)
        return false;
    const t = String(text).toLowerCase();
    if (t.includes("address"))
        return true;
    if (/\b(street|st\.|road|rd\.|lane|ln\.|flat|apartment|apt|block|sector|no\.|number)\b/.test(t))
        return true;
    const commas = (t.match(/,/g) || []).length;
    if (commas >= 2)
        return true;
    if (/\d{1,5}\s+/.test(t) && /[a-z]/.test(t))
        return true;
    return false;
}
function extractFirstLine(text) {
    if (!text)
        return null;
    const cleaned = stripCodeFence(text || "");
    const lines = String(cleaned || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (!lines.length)
        return null;
    for (const line of lines.slice(0, 6)) {
        const m = line.match(/^#{1,3}\s*(.+)$/);
        if (m && m[1])
            return m[1].trim();
    }
    return lines[0] || null;
}
function stripLeadingAddressBlock(text) {
    if (!text)
        return text;
    const lines = String(text).replace(/\r/g, "").split("\n");
    let i = 0;
    const addrPatterns = [
        /\bemail\b/i,
        /@/,
        /\bphone\b/i,
        /\bdate\b/i,
        /\baddress\b/i,
        /^\[.*\]$/,
        /^\s*[A-Z][A-Za-z'\s,.-]{0,60}\s*$/,
    ];
    while (i < lines.length) {
        const line = (lines[i] || "").trim();
        if (!line) {
            i++;
            continue;
        }
        if (/^subject[:\-]/i.test(line) || /^dear\b/i.test(line))
            break;
        const looksAddr = addrPatterns.some((rx) => rx.test(line));
        if (looksAddr || /^\[.+\]$/.test(line) || /^[A-Z\s]{2,}$/.test(line)) {
            i++;
            continue;
        }
        if ((line.match(/,/g) || []).length >= 2) {
            i++;
            continue;
        }
        if (/\b(is|are|has|have|been|will|shall|must|should)\b/i.test(line) ||
            /\.$/.test(line))
            break;
        if (line.split(/\s+/).length >= 4)
            break;
        i++;
    }
    return lines.slice(i).join("\n").trim();
}
function findSubjectLine(text) {
    if (!text)
        return null;
    const cleaned = String(stripCodeFence(text || "") || "");
    const lines = cleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    for (const line of lines.slice(0, 12)) {
        const m = line.match(/^subject\s*[:\-]\s*(.+)$/i);
        if (m && m[1])
            return m[1].trim();
    }
    return null;
}
function capitalizeWords(s) {
    return String(s || "")
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
function synthesizeTitleFromPlan(plan, query, cleanedBody) {
    const q = String(plan?.resolvedQuery || query || "").toLowerCase();
    const objective = String(plan?.draftingObjective || "").toLowerCase();
    if ((q.includes("invoice") ||
        objective.includes("invoice") ||
        cleanedBody.toLowerCase().includes("invoice")) &&
        (q.includes("non") ||
            q.includes("unpaid") ||
            objective.includes("non") ||
            cleanedBody.toLowerCase().includes("non-payment") ||
            cleanedBody.toLowerCase().includes("unpaid"))) {
        return "Notice for Non-Payment of Invoice";
    }
    if (plan?.detectedFamily === "notice" ||
        q.includes("notice") ||
        objective.includes("notice")) {
        const excerpt = (plan?.resolvedQuery || query || cleanedBody || "")
            .split(/[.\n]/)[0]
            .trim()
            .slice(0, 60);
        if (excerpt)
            return `Legal Notice: ${capitalizeWords(excerpt)}`;
        return "Legal Notice";
    }
    const fam = String(plan?.detectedFamily || "")
        .replace(/_/g, " ")
        .trim();
    const short = (plan?.resolvedQuery || query || cleanedBody || "")
        .split(/[.\n]/)[0]
        .trim()
        .slice(0, 60);
    if (fam)
        return `${capitalizeWords(fam)}${short ? ": " + capitalizeWords(short) : ""}`;
    if (short)
        return capitalizeWords(short);
    return null;
}
function sanitizeSourceTitle(rawTitle, plan, query, cleanedBody) {
    let t = String(rawTitle ?? "").trim();
    if (!t) {
        const s = synthesizeTitleFromPlan(plan, query, cleanedBody);
        return s || "Document";
    }
    t = stripCodeFence(t) || t;
    const heading = extractHeading(t) || extractFirstLine(t);
    if (heading && !looksLikeAddress(heading) && !/template/i.test(heading)) {
        return sanitizeDocumentTitle(heading);
    }
    if (looksLikeAddress(t) || /^\s*template\b/i.test(t)) {
        const s = synthesizeTitleFromPlan(plan, query, cleanedBody);
        return sanitizeDocumentTitle(s || t.replace(/\[|\]/g, " ").trim() || "Document");
    }
    return sanitizeDocumentTitle(t);
}
function simpleMarkdownToHtml(md) {
    if (!md)
        return "";
    let out = String(md);
    out = out
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    out = out.replace(/```([\s\S]*?)```/g, (s, code) => `<pre><code>${code
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")}</code></pre>`);
    out = out.replace(/^###\s*(.+)$/gm, "<h3>$1</h3>");
    out = out.replace(/^##\s*(.+)$/gm, "<h2>$1</h2>");
    out = out.replace(/^#\s*(.+)$/gm, "<h1>$1</h1>");
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
        if (p.startsWith("<h") || p.startsWith("<pre"))
            return p;
        return `<p>${p.replace(/\n/g, "<br/>")}</p>`;
    })
        .join("\n");
    return out;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseChatMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "drafting_studio")
        return "DRAFTING_STUDIO";
    if (normalized === "argument")
        return "ARGUMENT";
    return "JUDGMENT";
}
function buildTrace(searchResult, originalQuery) {
    const routerCandidate = searchResult?.trace?.router ||
        searchResult?.classified ||
        searchResult?.classification ||
        searchResult?.router ||
        searchResult?.query ||
        {};
    const notes = [];
    if (searchResult?.mode) {
        notes.push(`Mode: ${searchResult.mode}`);
    }
    if (Array.isArray(searchResult?.trace?.notes)) {
        for (const note of searchResult.trace.notes.slice(0, 6)) {
            if (typeof note === "string" && note.trim()) {
                notes.push(note.trim());
            }
        }
    }
    return {
        originalQuery,
        effectiveQuery: compact(searchResult?.effectiveQuery) ||
            compact(searchResult?.normalizedQuery) ||
            compact(searchResult?.trace?.router?.resolvedQuery) ||
            originalQuery,
        router: routerCandidate,
        classifiedFallback: searchResult?.trace?.classifiedFallback || undefined,
        resolvedReference: searchResult?.trace?.resolvedReference ||
            searchResult?.resolvedReference ||
            undefined,
        filtersApplied: searchResult?.trace?.filtersApplied ||
            searchResult?.filtersApplied ||
            undefined,
        notes: [...new Set(notes)].slice(0, 8),
    };
}
function buildDraftingTrace(draftingResult, originalQuery) {
    return {
        originalQuery,
        effectiveQuery: draftingResult.plan.resolvedQuery || originalQuery,
        router: {
            answerType: draftingResult.answerType,
            intent: draftingResult.plan.intent,
            family: draftingResult.plan.detectedFamily,
            subtype: draftingResult.plan.detectedSubtype,
            strategy: draftingResult.plan.strategy,
            matchLevel: draftingResult.plan.matchLevel,
            matchedTemplateIds: draftingResult.plan.matchedTemplateIds,
            draftingObjective: draftingResult.plan.draftingObjective,
            extractedFacts: draftingResult.plan.extractedFacts,
            missingFields: draftingResult.plan.missingFields,
            shouldAskClarifyingQuestions: draftingResult.plan.shouldAskClarifyingQuestions,
            isFollowUp: draftingResult.plan.routerState.isFollowUp,
            shouldTreatAsAnswers: draftingResult.plan.routerState.shouldTreatAsAnswers,
            priorAnswerType: draftingResult.plan.routerState.priorAnswerType,
        },
        resolvedReference: undefined,
        filtersApplied: undefined,
        notes: draftingResult.plan.reasoningNotes,
    };
}
function parseCaseDigests(jsonValue) {
    if (!Array.isArray(jsonValue))
        return [];
    return jsonValue
        .map((item) => ({
        caseId: item?.caseId,
        title: compact(item?.title),
        citation: compact(item?.citation),
        summary: compact(item?.summary),
    }))
        .filter((item) => item.title || item.citation || item.summary);
}
function buildTurnsFromDbMessages(dbMessages) {
    return dbMessages
        .filter((message) => compact(message.content))
        .map((message) => ({
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
        caseDigests: message.role === "ASSISTANT"
            ? parseCaseDigests(message.caseDigestsJson)
            : undefined,
        trace: message.role === "ASSISTANT" && message.traceJson
            ? message.traceJson
            : null,
    }));
}
chatStreamRouter.use(optionalAuth);
chatStreamRouter.use(requireAuth);
chatStreamRouter.post("/stream", async (req, res, next) => {
    let clientClosed = false;
    const markClientClosed = () => {
        clientClosed = true;
    };
    req.on("aborted", markClientClosed);
    req.on("error", markClientClosed);
    res.on("close", () => {
        if (!res.writableEnded) {
            markClientClosed();
        }
    });
    try {
        const fallbackQuery = compact(req.body?.query).slice(0, 1000);
        const providedConversationId = compact(req.body?.conversationId);
        const requestedChatMode = parseChatMode(req.body?.chatMode);
        let query = fallbackQuery;
        if (!query && Array.isArray(req.body?.messages)) {
            const lastUser = [...req.body.messages]
                .reverse()
                .find((message) => message?.role === "user" && compact(message?.content));
            query = compact(lastUser?.content).slice(0, 1000);
        }
        if (!query) {
            return res.status(400).json({
                ok: false,
                error: "Query is required.",
            });
        }
        const consumed = await prisma.user.updateMany({
            where: { id: req.auth.userId, creditsRemaining: { gt: 0 } },
            data: { creditsRemaining: { decrement: 1 } },
        });
        if (consumed.count === 0) {
            return res
                .status(402)
                .json({ ok: false, error: "No credits remaining." });
        }
        let refreshedCredits = null;
        try {
            const refreshed = await prisma.user.findUnique({
                where: { id: req.auth.userId },
                select: { creditsRemaining: true },
            });
            refreshedCredits =
                typeof refreshed?.creditsRemaining === "number"
                    ? refreshed.creditsRemaining
                    : 0;
        }
        catch (err) {
            console.error("Failed to read back credits after decrement:", err);
        }
        let conversation = providedConversationId
            ? await prisma.conversation.findFirst({
                where: {
                    id: providedConversationId,
                    userId: req.auth.userId,
                    archivedAt: null,
                },
                select: {
                    id: true,
                    title: true,
                    chatMode: true,
                },
            })
            : null;
        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    userId: req.auth.userId,
                    title: deriveConversationTitle(query),
                    chatMode: requestedChatMode,
                },
                select: {
                    id: true,
                    title: true,
                    chatMode: true,
                },
            });
        }
        const activeChatMode = conversation.chatMode;
        const userMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                role: "USER",
                content: query,
            },
            select: {
                id: true,
            },
        });
        if (conversation.title === "New chat") {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    title: deriveConversationTitle(query),
                    updatedAt: new Date(),
                },
            });
        }
        const dbMessages = await prisma.message.findMany({
            where: {
                conversationId: conversation.id,
            },
            orderBy: {
                createdAt: "asc",
            },
            select: {
                role: true,
                content: true,
                caseDigestsJson: true,
                traceJson: true,
            },
        });
        const messages = buildTurnsFromDbMessages(dbMessages);
        const authUser = await prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: {
                authProvider: true,
                allowedCourtIdsJson: true,
            },
        });
        const availableCourts = normalizeAllowedCourts(authUser?.allowedCourtIdsJson);
        const allowedCourtIds = availableCourts.map((item) => item.id);
        if (authUser?.authProvider === "casefinder_hs256" &&
            !allowedCourtIds.length) {
            return res.status(403).json({
                ok: false,
                error: "No courts are assigned for this user.",
            });
        }
        const rawSelectedCourtIds = Array.isArray(req.body?.selectedCourtIds)
            ? req.body.selectedCourtIds
            : undefined;
        let selectedCourtIds = undefined;
        if (rawSelectedCourtIds) {
            const restricted = restrictSelectedCourtIds(rawSelectedCourtIds, allowedCourtIds);
            if (rawSelectedCourtIds.length > 0 && restricted.length === 0) {
                return res.status(400).json({
                    ok: false,
                    error: "Invalid court selection.",
                });
            }
            selectedCourtIds = restricted.length ? restricted : undefined;
        }
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Content-Encoding", "identity");
        res.flushHeaders?.();
        res.socket?.setNoDelay?.(true);
        if (refreshedCredits !== null) {
            writeEvent(res, {
                type: "credits",
                creditsRemaining: refreshedCredits,
                conversationId: providedConversationId || null,
            });
        }
        if (activeChatMode === "DRAFTING_STUDIO") {
            const shouldSaveDraftDocument = req.body?.saveDraftDocument === true;
            const requestedDocumentTitle = compact(req.body?.documentTitle);
            const requestedDraftDocumentId = compact(req.body?.draftDocumentId);
            const currentDraftText = typeof req.body?.currentDraftText === "string"
                ? req.body.currentDraftText
                : "";
            const currentDraftTitle = compact(req.body?.currentDraftTitle);
            let savedDraftDocumentId = null;
            const { document: activeDraftDocument, context: currentDocumentContext } = await loadCurrentDraftDocumentContext({
                userId: req.auth.userId,
                draftDocumentId: requestedDraftDocumentId,
                currentDraftText,
                currentDraftTitle,
            });
            writeEvent(res, {
                type: "status",
                phase: "Understanding drafting request",
                conversationId: conversation.id,
            });
            console.log("[chatStream] req.body.attachmentIds:", req.body?.attachmentIds);
            console.log("[chatStream] active draft context:", {
                draftDocumentId: requestedDraftDocumentId || activeDraftDocument?.id || null,
                hasCurrentDraftText: !!currentDraftText,
                hasContext: !!currentDocumentContext?.draftText,
                filledValues: Object.keys(currentDocumentContext?.filledValues || {}).length,
            });
            const draftingResult = await orchestrateDrafting({
                userId: req.auth.userId,
                query,
                messages,
                attachmentIds: Array.isArray(req.body?.attachmentIds)
                    ? req.body.attachmentIds
                        .map((item) => compact(item))
                        .filter(Boolean)
                    : [],
                currentDocumentContext,
            });
            try {
                console.log("[chatStream] draftingResult.plan summary:", {
                    detectedFamily: draftingResult.plan?.detectedFamily,
                    strategy: draftingResult.plan?.strategy,
                    matchLevel: draftingResult.plan?.matchLevel,
                    resolvedQuery: draftingResult.plan?.resolvedQuery,
                    extractedFacts: Object.keys(draftingResult.plan?.extractedFacts || {}),
                    templateCandidates: (draftingResult.plan?.templateCandidates || []).map((t) => ({
                        id: t.id,
                        title: t.title,
                        source: t.source,
                        score: t.score,
                    })),
                });
                console.log("[chatStream] draftingResult.summary (excerpt):", String(draftingResult.summary || "").slice(0, 800));
            }
            catch (err) {
                console.error("[chatStream] failed to log draftingResult:", err?.message || err);
            }
            if (clientClosed)
                return;
            const trace = buildDraftingTrace(draftingResult, query);
            const rawSources = Array.isArray(draftingResult.sources)
                ? draftingResult.sources
                : [];
            const sources = rawSources.map((s) => ({
                ...s,
                title: sanitizeSourceTitle(s?.title, draftingResult.plan, query, String(draftingResult.summary || "")),
            }));
            const caseDigests = [];
            const answerText = String(draftingResult.summary || "").trim();
            const previewCandidate = (() => {
                try {
                    return deriveStableDraftTitle({
                        requestedTitle: requestedDocumentTitle,
                        query,
                        draftingResult,
                        rawBody: answerText,
                    });
                }
                catch {
                    return null;
                }
            })();
            if (previewCandidate) {
                writeEvent(res, {
                    type: "preview",
                    preview: previewCandidate,
                    conversationId: conversation.id,
                });
            }
            writeEvent(res, {
                type: "status",
                phase: "Matching precedents",
                trace,
                conversationId: conversation.id,
            });
            writeEvent(res, {
                type: "meta",
                mode: "drafting_studio",
                sources,
                caseDigests,
                trace,
                conversationId: conversation.id,
            });
            writeEvent(res, {
                type: "status",
                phase: draftingResult.answerType === "drafting_questions"
                    ? "Collecting drafting facts"
                    : "Drafting document",
                trace,
                conversationId: conversation.id,
            });
            if (answerText) {
                writeEvent(res, {
                    type: "status",
                    phase: "Streaming answer",
                    trace,
                    conversationId: conversation.id,
                });
                const chunks = chunkText(answerText, 6);
                for (const part of chunks) {
                    if (clientClosed)
                        return;
                    writeEvent(res, {
                        type: "delta",
                        text: part,
                        conversationId: conversation.id,
                    });
                    await sleep(20);
                }
            }
            const assistantMessage = await prisma.message.create({
                data: {
                    conversationId: conversation.id,
                    role: "ASSISTANT",
                    content: answerText,
                    sourcesJson: sources,
                    caseDigestsJson: caseDigests,
                    traceJson: trace,
                },
                select: {
                    id: true,
                },
            });
            try {
                const sanitizedForMessage = (() => {
                    const withoutFences = stripCodeFence(answerText || "") || String(answerText || "");
                    const stripped = stripLeadingAddressBlock(withoutFences || "") || withoutFences;
                    return stripped.trim();
                })();
                if (sanitizedForMessage &&
                    sanitizedForMessage.length > 20 &&
                    sanitizedForMessage !== answerText) {
                    await prisma.message.update({
                        where: { id: assistantMessage.id },
                        data: { content: sanitizedForMessage },
                    });
                }
            }
            catch (err) {
                console.error("[chatStream] failed to sanitize stored assistant message:", err?.message || err);
            }
            await prisma.promptRun.create({
                data: {
                    userId: req.auth.userId,
                    conversationId: conversation.id,
                    userMessageId: userMessage.id,
                    assistantMessageId: assistantMessage.id,
                    originalQuery: query,
                    effectiveQuery: query,
                    mode: null,
                    chatMode: activeChatMode,
                    routerJson: toNullableJsonInput(trace.router || null),
                    filtersJson: toNullableJsonInput(null),
                    notesJson: toNullableJsonInput(trace.notes || null),
                    sourcesJson: toNullableJsonInput(sources),
                    caseDigestsJson: toNullableJsonInput(caseDigests),
                    confidence: draftingResult.confidence,
                },
            });
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { updatedAt: new Date() },
            });
            if (shouldSaveDraftDocument &&
                draftingResult.answerType === "drafting_draft" &&
                answerText) {
                let rawTitle = "";
                const requestedCandidate = requestedDocumentTitle &&
                    !/^(\s*template( content)?|untitled|new chat)\b/i.test(requestedDocumentTitle) &&
                    !looksLikeAddress(requestedDocumentTitle)
                    ? requestedDocumentTitle
                    : "";
                rawTitle =
                    requestedCandidate ||
                        draftingResult.plan.templateCandidates[0]?.title ||
                        "";
                const savedDocument = await saveDraftDocumentFromDraftingResult({
                    existingDocument: activeDraftDocument,
                    userId: req.auth.userId,
                    conversationId: conversation.id,
                    title: sanitizeDocumentTitle(rawTitle),
                    query,
                    draftingResult,
                });
                savedDraftDocumentId = savedDocument.id;
                try {
                    await prisma.conversation.update({
                        where: { id: conversation.id },
                        data: { title: savedDocument.title, updatedAt: new Date() },
                    });
                }
                catch (err) {
                    console.error("Failed to update conversation title after saving draft:", err?.message || err);
                }
            }
            writeEvent(res, {
                type: "done",
                answerType: draftingResult.answerType,
                confidence: draftingResult.confidence,
                conversationId: conversation.id,
                draftDocumentId: savedDraftDocumentId,
            });
            return res.end();
        }
        if (activeChatMode === "ARGUMENT") {
            const trace = {
                originalQuery: query,
                effectiveQuery: query,
                router: { mode: "argument" },
                notes: [
                    "argument mode backend scaffold exists but full orchestration is not enabled yet",
                ],
            };
            const answerText = "Argument mode has been scaffolded in the backend, but the full counsel/judge adversarial workflow is not enabled yet. Build Drafting Studio first, then wire the argument router next.";
            writeEvent(res, {
                type: "meta",
                mode: "argument",
                sources: [],
                caseDigests: [],
                trace,
                conversationId: conversation.id,
            });
            const chunks = chunkText(answerText, 6);
            for (const part of chunks) {
                if (clientClosed)
                    return;
                writeEvent(res, {
                    type: "delta",
                    text: part,
                    conversationId: conversation.id,
                });
                await sleep(20);
            }
            const assistantMessage = await prisma.message.create({
                data: {
                    conversationId: conversation.id,
                    role: "ASSISTANT",
                    content: answerText,
                    sourcesJson: [],
                    caseDigestsJson: [],
                    traceJson: trace,
                },
                select: {
                    id: true,
                },
            });
            await prisma.promptRun.create({
                data: {
                    userId: req.auth.userId,
                    conversationId: conversation.id,
                    userMessageId: userMessage.id,
                    assistantMessageId: assistantMessage.id,
                    originalQuery: query,
                    effectiveQuery: query,
                    mode: null,
                    chatMode: activeChatMode,
                    routerJson: toNullableJsonInput(trace.router),
                    filtersJson: toNullableJsonInput(null),
                    notesJson: toNullableJsonInput(trace.notes),
                    sourcesJson: toNullableJsonInput([]),
                    caseDigestsJson: toNullableJsonInput([]),
                    confidence: 0.35,
                },
            });
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { updatedAt: new Date() },
            });
            writeEvent(res, {
                type: "done",
                answerType: "argument_scaffold",
                confidence: 0.35,
                conversationId: conversation.id,
            });
            return res.end();
        }
        writeEvent(res, {
            type: "status",
            phase: "Understanding query",
            conversationId: conversation.id,
        });
        const searchResult = await orchestrateSearch({
            query,
            messages,
            allowedCourtIds,
            selectedCourtIds,
        });
        if (clientClosed)
            return;
        const trace = buildTrace(searchResult, query);
        writeEvent(res, {
            type: "status",
            phase: "Searching authorities",
            trace,
            conversationId: conversation.id,
        });
        writeEvent(res, {
            type: "meta",
            mode: searchResult?.mode,
            sources: [],
            caseDigests: [],
            trace,
            conversationId: conversation.id,
        });
        writeEvent(res, {
            type: "status",
            phase: "Drafting answer",
            trace,
            conversationId: conversation.id,
        });
        const answer = await composeAnswer({
            ...searchResult,
            messages,
        });
        if (clientClosed)
            return;
        const sources = (answer?.citations || [])
            .slice(0, 5)
            .map((c) => ({
            title: c.title,
            citation: c.citation,
            range: citationRange(c),
        }));
        const answerText = String(answer?.summary || "").trim();
        const caseDigests = (answer?.caseDigests || [])
            .slice(0, 5)
            .map((d) => ({
            caseId: d.caseId,
            title: d.title,
            citation: d.citation,
            summary: pickCaseDigestSummary(d, answerText),
        }));
        writeEvent(res, {
            type: "meta",
            mode: searchResult?.mode,
            sources,
            caseDigests,
            trace,
            conversationId: conversation.id,
        });
        if (answerText) {
            writeEvent(res, {
                type: "status",
                phase: "Streaming answer",
                trace,
                conversationId: conversation.id,
            });
            const chunks = chunkText(answerText, 6);
            for (const part of chunks) {
                if (clientClosed)
                    return;
                writeEvent(res, {
                    type: "delta",
                    text: part,
                    conversationId: conversation.id,
                });
                await sleep(20);
            }
        }
        const assistantMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                role: "ASSISTANT",
                content: answerText,
                sourcesJson: sources,
                caseDigestsJson: caseDigests,
                traceJson: trace,
            },
            select: {
                id: true,
            },
        });
        await prisma.promptRun.create({
            data: {
                userId: req.auth.userId,
                conversationId: conversation.id,
                userMessageId: userMessage.id,
                assistantMessageId: assistantMessage.id,
                originalQuery: query,
                effectiveQuery: trace.effectiveQuery || query,
                mode: searchResult?.mode || null,
                chatMode: activeChatMode,
                routerJson: toNullableJsonInput(trace.router || null),
                filtersJson: toNullableJsonInput(trace.filtersApplied || null),
                notesJson: toNullableJsonInput(trace.notes || null),
                sourcesJson: toNullableJsonInput(sources),
                caseDigestsJson: toNullableJsonInput(caseDigests),
                confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
            },
        });
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { updatedAt: new Date() },
        });
        writeEvent(res, {
            type: "done",
            answerType: answer?.answerType,
            confidence: answer?.confidence,
            conversationId: conversation.id,
        });
        res.end();
    }
    catch (error) {
        if (res.headersSent) {
            console.error("Error after headers sent in /stream:", error);
            try {
                if (!res.writableEnded)
                    res.end();
            }
            catch (e) {
            }
            return;
        }
        next(error);
    }
});
//# sourceMappingURL=chatStream.js.map