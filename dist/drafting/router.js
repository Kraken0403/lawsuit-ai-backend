import { searchDraftTemplates } from "./templateSearch.js";
import { buildAttachmentTemplateCandidates } from "./loadAttachments.js";
import { resolveDraftingRouterState } from "./llmRouter.js";
import { compact, normalizeText, uniqueStrings } from "./utils.js";
const FAMILY_KEYWORDS = {
    notice: ["legal notice", "demand notice", "show cause", "cease and desist"],
    petition: ["petition", "writ", "plaint", "grounds", "prayer"],
    contract: [
        "contract",
        "services contract",
        "service contract",
        "employment contract",
        "nda",
        "msa",
        "vendor contract",
        "software development contract",
    ],
    deed: ["deed", "sale deed", "gift deed", "release deed", "mortgage deed"],
    agreement: [
        "agreement",
        "service agreement",
        "consulting agreement",
        "employment agreement",
        "shareholders agreement",
        "founders agreement",
        "subscription agreement",
        "memorandum of understanding",
        "mou",
        "term sheet",
    ],
    affidavit: ["affidavit", "sworn statement", "verification affidavit"],
    undertaking: ["undertaking", "undertake", "assurance"],
    acknowledgement: [
        "acknowledgement",
        "acknowledgment",
        "iou",
        "debt acknowledgement",
        "part payment",
    ],
    application: ["application", "interim application", "misc application"],
    reply: ["reply", "response", "rejoinder", "written reply"],
    power_of_attorney: ["power of attorney", "poa", "authorisation"],
    declaration: ["declaration", "declare that"],
    misc: [],
};
const FIELD_ALIASES = {
    sender_details: ["party_one_details", "executant_details", "deponent_details"],
    recipient_details: ["party_two_details", "beneficiary_details", "respondent_details"],
    factual_background: ["facts", "background"],
    grievance_or_default: ["default", "breach", "dispute"],
    amount_or_claim: ["amount", "claim_amount", "subject_matter"],
    deadline: ["date", "dates"],
    core_request_or_purpose: [
        "what_you_want_the_document_to_achieve",
        "demands",
        "prayers",
    ],
};
function inferFamilyFromQuery(query) {
    const q = normalizeText(query);
    if (q.includes("service agreement") ||
        q.includes("consulting agreement") ||
        q.includes("employment agreement") ||
        q.includes("subscription agreement") ||
        q.includes("shareholders agreement") ||
        q.includes("agreement between") ||
        q.includes("draft an agreement") ||
        q.includes("draft agreement")) {
        return "agreement";
    }
    if (q.includes("service contract") ||
        q.includes("employment contract") ||
        q.includes("software development contract") ||
        q.includes("vendor contract") ||
        q.includes("draft a contract") ||
        q.includes("draft contract")) {
        return "contract";
    }
    if (q.includes("legal notice") ||
        q.includes("demand notice") ||
        q.includes("show cause") ||
        q.includes("cease and desist") ||
        q.includes("notice for")) {
        return "notice";
    }
    for (const [family, keywords] of Object.entries(FAMILY_KEYWORDS)) {
        if (family === "notice" || family === "agreement" || family === "contract") {
            continue;
        }
        if (keywords.some((keyword) => q.includes(normalizeText(keyword)))) {
            return family;
        }
    }
    return null;
}
function directUseAttachmentRequested(query) {
    const q = normalizeText(query);
    return (q.includes("use attached") ||
        q.includes("use the attached") ||
        q.includes("same format") ||
        q.includes("same structure") ||
        q.includes("as per attached") ||
        q.includes("based on attached") ||
        q.includes("use uploaded format") ||
        q.includes("use attachment") ||
        q.includes("use the uploaded format") ||
        q.includes("use the attached format"));
}
function inferIntent(query, hasAttachments) {
    const q = normalizeText(query);
    if (hasAttachments && directUseAttachmentRequested(query)) {
        return "draft_from_user_format";
    }
    if (q.includes("revise") || q.includes("redraft") || q.includes("improve")) {
        return "revise_existing_draft";
    }
    if (q.includes("extract template") || q.includes("make this a template")) {
        return "extract_template";
    }
    if (q.includes("save this template") || q.includes("save as template")) {
        return "save_template";
    }
    if (q.includes("compare with precedent") || q.includes("compare with format")) {
        return "compare_with_precedent";
    }
    return "draft_from_library";
}
function inferTone(query) {
    const q = normalizeText(query);
    if (q.includes("aggressive") || q.includes("strongly worded"))
        return "aggressive";
    if (q.includes("strict"))
        return "strict";
    if (q.includes("formal"))
        return "formal";
    return "neutral";
}
function collectRecentUserContext(messages = [], query = "") {
    const priorUser = messages
        .filter((message) => message.role === "user")
        .slice(-4)
        .map((message) => compact(message.content));
    return uniqueStrings([...priorUser, compact(query)]).join("\n");
}
function hasEnoughFacts(query, messages = [], hasAttachments = false) {
    const combined = collectRecentUserContext(messages, query);
    if (hasAttachments && combined.length >= 80) {
        return true;
    }
    let signalCount = 0;
    const checks = [
        /\bdated\b/i,
        /\brs\.?|\brupees\b|\bamount\b|₹|inr/i,
        /\baddress|residing|registered office\b/i,
        /\bpetitioner|respondent|plaintiff|defendant|debtor|creditor|party|client|service provider|sender|recipient\b/i,
        /\bwhereas|therefore|prayer|relief|default|scope|fee|payment|termination|invoice\b/i,
        /[:\n]/,
    ];
    for (const check of checks) {
        if (check.test(combined))
            signalCount += 1;
    }
    return combined.length >= 220 && signalCount >= 3;
}
function getGenericFields(family) {
    switch (family) {
        case "notice":
            return [
                "sender_details",
                "recipient_details",
                "subject",
                "factual_background",
                "grievance_or_default",
                "demands",
                "deadline",
            ];
        case "petition":
            return [
                "court_or_forum",
                "petitioner_details",
                "respondent_details",
                "facts",
                "grounds",
                "prayers",
                "interim_relief",
            ];
        case "contract":
        case "agreement":
            return [
                "party_one_details",
                "party_two_details",
                "effective_date",
                "scope",
                "consideration",
                "term",
                "termination",
                "governing_law",
            ];
        case "deed":
            return [
                "executant_details",
                "beneficiary_details",
                "subject_matter",
                "recitals",
                "operative_terms",
                "execution_details",
            ];
        case "acknowledgement":
            return [
                "debtor_or_executant_details",
                "creditor_or_beneficiary_details",
                "amount",
                "basis_of_acknowledgement",
                "date",
            ];
        case "affidavit":
            return [
                "deponent_details",
                "facts",
                "verification_place",
                "verification_date",
            ];
        default:
            return [
                "document_title",
                "party_details",
                "facts",
                "core_request_or_purpose",
            ];
    }
}
function getFieldsFromTopTemplate(placeholders) {
    const keys = placeholders
        .map((item) => {
        const key = item?.key;
        return typeof key === "string" ? compact(key) : "";
    })
        .filter(Boolean);
    return uniqueStrings(keys);
}
function factSatisfiesField(field, facts) {
    if (facts[field])
        return true;
    const aliases = FIELD_ALIASES[field] || [];
    return aliases.some((alias) => !!facts[alias]);
}
export async function routeDraftingQuery({ userId, query, messages = [], attachments = [], }) {
    const heuristicFamily = inferFamilyFromQuery(query);
    const heuristicTone = inferTone(query);
    const routerState = await resolveDraftingRouterState({
        query,
        messages,
        attachments,
        inferredFamily: heuristicFamily,
        inferredTone: heuristicTone,
    });
    const resolvedFamily = routerState.lockedFamily || heuristicFamily;
    const preferredTone = routerState.preferredTone || heuristicTone;
    const explicitAttachmentOverride = attachments.length > 0 && directUseAttachmentRequested(query);
    const resolvedQuery = compact(routerState.normalizedUserBrief) ||
        collectRecentUserContext(messages, query) ||
        compact(query);
    const dbTemplateCandidates = await searchDraftTemplates({
        userId,
        query: resolvedQuery,
        familyHint: resolvedFamily,
        limit: 5,
    });
    const attachmentCandidates = buildAttachmentTemplateCandidates({
        attachments,
        query: resolvedQuery,
        familyHint: resolvedFamily,
        directUseRequested: explicitAttachmentOverride,
    });
    const templateCandidates = [...attachmentCandidates, ...dbTemplateCandidates]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    const top = templateCandidates[0] || null;
    let resolvedIntent = inferIntent(resolvedQuery, attachments.length > 0);
    let matchLevel = "none";
    if (top?.score != null && top.score >= 0.78) {
        matchLevel = "exact";
    }
    else if (top?.score != null && top.score >= 0.42) {
        matchLevel = "adjacent";
    }
    let strategy = attachments.length > 0
        ? "user_format_override"
        : matchLevel === "exact"
            ? "exact_template"
            : matchLevel === "adjacent"
                ? "adjacent_template"
                : "fresh_generation";
    if (top &&
        top.source === "SESSION_UPLOAD" &&
        (explicitAttachmentOverride ||
            /use (the )?(attached|uploaded) format|same format|same structure|based on attached/i.test(resolvedQuery))) {
        resolvedIntent = "draft_from_user_format";
        strategy = "user_format_override";
        if (matchLevel === "none") {
            matchLevel = "adjacent";
        }
    }
    const detectedFamily = resolvedFamily || (top?.family ?? null);
    const detectedSubtype = routerState.lockedSubtype || top?.subtype || null;
    const templateFields = top ? getFieldsFromTopTemplate(top.placeholders) : [];
    const requiredFields = templateFields.length
        ? templateFields
        : getGenericFields(top?.family || detectedFamily);
    const extractedFacts = routerState.extractedFacts || {};
    const missingFields = uniqueStrings((routerState.missingFacts || []).concat(requiredFields.filter((field) => !factSatisfiesField(field, extractedFacts))));
    const enoughFactsNow = routerState.shouldGenerateNow ||
        hasEnoughFacts(resolvedQuery, messages, attachments.length > 0);
    const shouldAskClarifyingQuestions = !enoughFactsNow;
    const reasoningNotes = [];
    if (detectedFamily) {
        reasoningNotes.push(`resolved family: ${detectedFamily}`);
    }
    else {
        reasoningNotes.push("family could not be confidently inferred from conversation");
    }
    if (routerState.isFollowUp) {
        reasoningNotes.push("router detected drafting follow-up context");
    }
    if (routerState.shouldTreatAsAnswers) {
        reasoningNotes.push("latest user turn treated as answers to intake questions");
    }
    if (routerState.draftingObjective) {
        reasoningNotes.push(`drafting objective: ${routerState.draftingObjective}`);
    }
    if (top) {
        reasoningNotes.push(`top template candidate: ${top.title} (${top.family}${top.subtype ? ` / ${top.subtype}` : ""})`);
        reasoningNotes.push(`match level: ${matchLevel} (score ${top.score.toFixed(2)})`);
    }
    else {
        reasoningNotes.push("no template candidate found in current library");
    }
    if (attachments.length > 0) {
        reasoningNotes.push(`user supplied attachment(s): ${attachments.length}`);
    }
    if (explicitAttachmentOverride) {
        reasoningNotes.push("query explicitly requests using attached/uploaded format first");
    }
    if (top?.source === "SESSION_UPLOAD" && strategy === "user_format_override") {
        reasoningNotes.push("saved uploaded template promoted to governing user-format scaffold");
    }
    if (shouldAskClarifyingQuestions) {
        reasoningNotes.push("insufficient drafting facts detected; intake questions required");
    }
    else {
        reasoningNotes.push("enough drafting context detected to produce a first draft");
    }
    if (routerState.notes.length) {
        reasoningNotes.push(...routerState.notes);
    }
    return {
        originalQuery: compact(query),
        resolvedQuery,
        intent: resolvedIntent,
        detectedFamily,
        detectedSubtype,
        preferredTone,
        matchLevel,
        strategy,
        matchedTemplateIds: templateCandidates.map((item) => item.id),
        templateCandidates,
        draftingObjective: routerState.draftingObjective,
        extractedFacts,
        missingFields,
        shouldAskClarifyingQuestions,
        shouldUseUserAttachmentFirst: explicitAttachmentOverride ||
            attachments.length > 0 ||
            (top?.source === "SESSION_UPLOAD" && strategy === "user_format_override"),
        reasoningNotes: uniqueStrings(reasoningNotes),
        routerState,
    };
}
//# sourceMappingURL=router.js.map