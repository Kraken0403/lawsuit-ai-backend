import OpenAI from "openai";
import { compact, normalizeText } from "./utils.js";
const routerClient = process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        ...(process.env.OPENAI_BASE_URL
            ? { baseURL: process.env.OPENAI_BASE_URL }
            : {}),
    })
    : null;
const ALLOWED_FAMILIES = [
    "notice",
    "petition",
    "contract",
    "deed",
    "agreement",
    "affidavit",
    "undertaking",
    "acknowledgement",
    "application",
    "reply",
    "power_of_attorney",
    "declaration",
    "misc",
];
function cleanText(value) {
    return compact(String(value || "").replace(/\s+/g, " "));
}
function asTone(value) {
    const tone = String(value || "").trim().toLowerCase();
    if (tone === "formal" || tone === "strict" || tone === "aggressive") {
        return tone;
    }
    return "neutral";
}
function asFamily(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return ALLOWED_FAMILIES.includes(normalized)
        ? normalized
        : null;
}
function extractJsonObject(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch { }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
        const slice = trimmed.slice(start, end + 1);
        try {
            return JSON.parse(slice);
        }
        catch { }
    }
    return null;
}
function getLastAssistant(messages = []) {
    return [...messages].reverse().find((item) => item.role === "assistant") || null;
}
function getLastAssistantRouter(messages = []) {
    const lastAssistant = getLastAssistant(messages);
    const router = lastAssistant?.trace?.router;
    return router && typeof router === "object" ? router : null;
}
function detectPriorAnswerType(messages = []) {
    const router = getLastAssistantRouter(messages);
    const answerType = String(router?.answerType || "").trim();
    if (answerType === "drafting_questions" || answerType === "drafting_draft") {
        return answerType;
    }
    const lastAssistant = getLastAssistant(messages);
    const content = normalizeText(lastAssistant?.content || "");
    if (content.includes("before i draft this properly") ||
        content.includes("reply in this format") ||
        content.includes("send me these details")) {
        return "drafting_questions";
    }
    return null;
}
function detectLockedFamily(messages = [], fallback) {
    const router = getLastAssistantRouter(messages);
    const familyFromTrace = asFamily(router?.family);
    if (familyFromTrace)
        return familyFromTrace;
    const lastAssistant = getLastAssistant(messages);
    const content = lastAssistant?.content || "";
    const familyMatch = content.match(/Detected family:\s*([a-z_]+)/i);
    if (familyMatch?.[1]) {
        const parsed = asFamily(familyMatch[1]);
        if (parsed)
            return parsed;
    }
    return fallback || null;
}
function collectRecentUserTurns(messages = [], query = "") {
    return [...messages.filter((item) => item.role === "user").slice(-4), {
            role: "user",
            content: query,
        }];
}
function inferObjectiveFromText(text) {
    const q = normalizeText(text);
    if (q.includes("non payment of invoice") ||
        q.includes("non-payment of invoice") ||
        q.includes("outstanding invoice") ||
        q.includes("invoice remains unpaid") ||
        q.includes("amount remains outstanding")) {
        return "recover unpaid invoice amount through a legal demand notice";
    }
    if (q.includes("breach")) {
        return "address breach and demand compliance";
    }
    if (q.includes("cease and desist")) {
        return "stop the complained conduct immediately";
    }
    return null;
}
function extractFactsHeuristically(query, messages = []) {
    const combined = collectRecentUserTurns(messages, query)
        .map((item) => cleanText(item.content))
        .filter(Boolean)
        .join("\n");
    const facts = {};
    const q = combined;
    const senderRep = q.match(/\b(?:i am|i'm|i represent|i am a representative of|i a representative of)\s+([A-Za-z0-9&.,' -]{2,80})/i);
    if (senderRep?.[1]) {
        facts.sender_details = cleanText(senderRep[1]);
        facts.party_one_details = cleanText(senderRep[1]);
    }
    const recipient = q.match(/\b(?:invoice to|sent an invoice to|against|upon)\s+([A-Za-z0-9&.,' -]{2,80})/i);
    if (recipient?.[1]) {
        facts.recipient_details = cleanText(recipient[1]);
        facts.party_two_details = cleanText(recipient[1]);
    }
    const amount = q.match(/\b(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s*(?:lakh|lakhs|crore|crores))?)/i);
    if (amount?.[0]) {
        facts.amount_or_claim = cleanText(amount[0]);
        facts.amount = cleanText(amount[0]);
        facts.subject_matter = cleanText(amount[0]);
    }
    const dueDate = q.match(/\b(?:deadline was|due(?: date)? was|payment due on|was due by|due by)\s+([A-Za-z0-9, -]{4,40})/i);
    if (dueDate?.[1]) {
        facts.deadline = cleanText(dueDate[1]);
        facts.date = cleanText(dueDate[1]);
    }
    if (/website/i.test(q) && /(build|development|develop|service)/i.test(q)) {
        facts.subject = "Non-payment for website development services";
        facts.scope = "Website development services";
        facts.subject_matter = facts.subject_matter
            ? `${facts.subject_matter}; Website development services`
            : "Website development services";
    }
    if (/half.*paid/i.test(q) ||
        /only half.*paid/i.test(q) ||
        /remaining.*outstanding/i.test(q) ||
        /outstanding/i.test(q) ||
        /default/i.test(q)) {
        facts.grievance_or_default =
            "The full agreed invoice amount has not been paid and the balance remains outstanding despite the due date having passed.";
        facts.demands =
            "Immediate payment of the outstanding invoice amount with applicable interest and/or costs, failing which legal action may be initiated.";
    }
    const explicitTone = q.match(/\b(formal|strict|aggressive)\b/i);
    if (explicitTone?.[1]) {
        facts.tone = explicitTone[1].toLowerCase();
    }
    if (q) {
        facts.factual_background = cleanText(q);
        facts.facts = cleanText(q);
    }
    const objective = inferObjectiveFromText(q);
    if (objective) {
        facts.core_request_or_purpose = objective;
        facts.what_you_want_the_document_to_achieve = objective;
    }
    return Object.fromEntries(Object.entries(facts).filter(([, value]) => cleanText(value)));
}
function buildNormalizedBrief(query, messages = []) {
    const recentUsers = collectRecentUserTurns(messages, query)
        .map((item) => cleanText(item.content))
        .filter(Boolean);
    return Array.from(new Set(recentUsers)).join("\n\n");
}
function heuristicResolve(input) {
    const { query, messages = [], inferredFamily, inferredTone } = input;
    const priorAnswerType = detectPriorAnswerType(messages);
    const lockedFamily = detectLockedFamily(messages, inferredFamily);
    const extractedFacts = extractFactsHeuristically(query, messages);
    const normalizedUserBrief = buildNormalizedBrief(query, messages);
    const noteList = [];
    const isFollowUp = messages.some((item) => item.role === "assistant");
    const shouldTreatAsAnswers = priorAnswerType === "drafting_questions" &&
        Object.keys(extractedFacts).length >= 2;
    const draftingObjective = extractedFacts.what_you_want_the_document_to_achieve ||
        extractedFacts.core_request_or_purpose ||
        inferObjectiveFromText(normalizedUserBrief) ||
        null;
    const confidence = shouldTreatAsAnswers || Object.keys(extractedFacts).length >= 4 ? 0.72 : 0.46;
    const shouldGenerateNow = shouldTreatAsAnswers ||
        (normalizedUserBrief.length >= 160 && Object.keys(extractedFacts).length >= 3);
    if (lockedFamily) {
        noteList.push(`locked family from context: ${lockedFamily}`);
    }
    if (priorAnswerType) {
        noteList.push(`prior drafting state: ${priorAnswerType}`);
    }
    if (shouldTreatAsAnswers) {
        noteList.push("latest user turn looks like answers to drafting intake questions");
    }
    return {
        isFollowUp,
        shouldTreatAsAnswers,
        priorAnswerType,
        lockedFamily,
        lockedSubtype: null,
        draftingObjective,
        preferredTone: asTone(extractedFacts.tone || inferredTone),
        normalizedUserBrief,
        extractedFacts,
        missingFacts: [],
        shouldGenerateNow,
        confidence,
        notes: noteList,
    };
}
export async function resolveDraftingRouterState(input) {
    const heuristic = heuristicResolve(input);
    if (!routerClient) {
        return heuristic;
    }
    try {
        const attachmentSummary = (input.attachments || [])
            .slice(0, 4)
            .map((item) => ({
            fileName: item.fileName,
            mimeType: item.mimeType,
            hasText: !!cleanText(item.extractedText),
            templateId: item.templateId || null,
        }));
        const recentMessages = (input.messages || []).slice(-6).map((item) => ({
            role: item.role,
            content: cleanText(item.content).slice(0, 1400),
            trace: item?.trace || null,
        }));
        const response = await routerClient.responses.create({
            model: process.env.OPENAI_DRAFT_ROUTER_MODEL ||
                process.env.OPENAI_DRAFTING_MODEL ||
                process.env.OPENAI_ANSWER_MODEL ||
                "gpt-4.1-mini",
            store: false,
            input: [
                {
                    role: "system",
                    content: [
                        "You are a drafting router for an Indian legal drafting assistant.",
                        "Return JSON only.",
                        "Your job is to decide whether the latest user turn is a fresh drafting request or a follow-up answer to previously requested drafting details.",
                        "If the prior drafting family is clear, lock it unless the user explicitly changes document type.",
                        "Never switch family just because the newest message contains facts but omits the earlier document type.",
                        "Allowed families:",
                        ALLOWED_FAMILIES.join(", "),
                    ].join(" "),
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        latestQuery: input.query,
                        heuristic,
                        inferredFamily: input.inferredFamily || null,
                        inferredTone: input.inferredTone || "neutral",
                        recentMessages,
                        attachments: attachmentSummary,
                        requiredOutputShape: {
                            isFollowUp: true,
                            shouldTreatAsAnswers: true,
                            priorAnswerType: "drafting_questions | drafting_draft | null",
                            lockedFamily: "notice | petition | contract | deed | agreement | affidavit | undertaking | acknowledgement | application | reply | power_of_attorney | declaration | misc | null",
                            lockedSubtype: "string | null",
                            draftingObjective: "string | null",
                            preferredTone: "neutral | formal | strict | aggressive",
                            normalizedUserBrief: "string",
                            extractedFacts: {
                                sender_details: "optional string",
                                recipient_details: "optional string",
                                subject: "optional string",
                                factual_background: "optional string",
                                grievance_or_default: "optional string",
                                demands: "optional string",
                                deadline: "optional string",
                                amount_or_claim: "optional string",
                            },
                            missingFacts: ["array of missing fields"],
                            shouldGenerateNow: true,
                            confidence: 0.0,
                            notes: ["array of short notes"],
                        },
                    }, null, 2),
                },
            ],
        });
        const parsed = extractJsonObject(String(response.output_text || ""));
        if (!parsed || typeof parsed !== "object") {
            return heuristic;
        }
        const mergedFacts = {
            ...heuristic.extractedFacts,
            ...parsed.extractedFacts,
        };
        return {
            isFollowUp: typeof parsed.isFollowUp === "boolean"
                ? parsed.isFollowUp
                : heuristic.isFollowUp,
            shouldTreatAsAnswers: typeof parsed.shouldTreatAsAnswers === "boolean"
                ? parsed.shouldTreatAsAnswers
                : heuristic.shouldTreatAsAnswers,
            priorAnswerType: parsed.priorAnswerType === "drafting_questions" ||
                parsed.priorAnswerType === "drafting_draft"
                ? parsed.priorAnswerType
                : heuristic.priorAnswerType,
            lockedFamily: asFamily(parsed.lockedFamily) || heuristic.lockedFamily,
            lockedSubtype: cleanText(parsed.lockedSubtype) || null,
            draftingObjective: cleanText(parsed.draftingObjective) || heuristic.draftingObjective,
            preferredTone: asTone(parsed.preferredTone || heuristic.preferredTone),
            normalizedUserBrief: cleanText(parsed.normalizedUserBrief) || heuristic.normalizedUserBrief,
            extractedFacts: Object.fromEntries(Object.entries(mergedFacts).filter(([, value]) => cleanText(value))),
            missingFacts: Array.isArray(parsed.missingFacts)
                ? parsed.missingFacts
                    .map((item) => cleanText(item))
                    .filter(Boolean)
                : heuristic.missingFacts,
            shouldGenerateNow: typeof parsed.shouldGenerateNow === "boolean"
                ? parsed.shouldGenerateNow
                : heuristic.shouldGenerateNow,
            confidence: typeof parsed.confidence === "number"
                ? Math.max(0, Math.min(1, parsed.confidence))
                : heuristic.confidence,
            notes: Array.from(new Set([
                ...heuristic.notes,
                ...(Array.isArray(parsed.notes)
                    ? parsed.notes
                    : []).map((item) => cleanText(item)),
            ].filter(Boolean))).slice(0, 10),
        };
    }
    catch (error) {
        console.error("[drafting-router] llm router failed, using heuristic fallback", error);
        return heuristic;
    }
}
//# sourceMappingURL=llmRouter.js.map