import { loadDraftAttachments } from "./loadAttachments.js";
import { routeDraftingQuery } from "./router.js";
import { buildClarifyingResponse } from "./questionnaire.js";
import { generateDraftFromPlan } from "./generateDraft.js";
export async function orchestrateDrafting({ userId, query, messages = [], attachmentIds = [], currentDocumentContext = null, }) {
    const cleanAttachmentIds = Array.isArray(attachmentIds)
        ? attachmentIds.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    const attachments = await loadDraftAttachments({
        userId,
        attachmentIds: cleanAttachmentIds,
    });
    console.log("[drafting] attachmentIds:", cleanAttachmentIds);
    console.log("[drafting] loadedAttachments:", attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        hasText: !!a.extractedText,
        templateId: a.templateId,
    })));
    const plan = await routeDraftingQuery({
        userId,
        query,
        messages,
        attachments: attachments.map((item) => ({
            id: item.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            extractedText: item.extractedText,
            conversationId: item.conversationId,
            templateId: item.templateId,
            parsedJson: item.parsedJson,
        })),
    });
    // Log plan summary for debugging title/template selection
    try {
        console.log("[drafting] plan.summary", {
            resolvedQuery: plan.resolvedQuery,
            detectedFamily: plan.detectedFamily,
            strategy: plan.strategy,
            matchLevel: plan.matchLevel,
            templateCandidates: plan.templateCandidates?.map((t) => ({ id: t.id, title: t.title, source: t.source, score: t.score })) || [],
            extractedFactsKeys: Object.keys(plan.extractedFacts || {}),
        });
    }
    catch (err) {
        console.error("[drafting] failed to log plan:", err?.message || err);
    }
    const sources = plan.templateCandidates.slice(0, 3).map((item) => ({
        title: item.title,
        citation: `${item.family}${item.subtype ? ` / ${item.subtype}` : ""}`,
        range: item.sourceRef || item.source.toLowerCase(),
    }));
    if (plan.shouldAskClarifyingQuestions) {
        return {
            mode: "drafting_studio",
            answerType: "drafting_questions",
            summary: buildClarifyingResponse(plan),
            confidence: plan.matchLevel === "exact"
                ? 0.72
                : plan.matchLevel === "adjacent"
                    ? 0.61
                    : 0.48,
            sources,
            plan,
        };
    }
    const summary = await generateDraftFromPlan({
        query,
        plan,
        messages,
        currentDocumentContext,
    });
    // Log draft summary excerpt
    try {
        console.log("[drafting] generated summary (excerpt):", String(summary || "").slice(0, 800));
    }
    catch (err) {
        console.error("[drafting] failed to log summary:", err?.message || err);
    }
    return {
        mode: "drafting_studio",
        answerType: "drafting_draft",
        summary,
        confidence: plan.matchLevel === "exact"
            ? 0.88
            : plan.matchLevel === "adjacent"
                ? 0.78
                : 0.63,
        sources,
        plan,
    };
}
//# sourceMappingURL=orchestrateDrafting.js.map