import type { ChatTurn } from "../types/search.js";
import { loadDraftAttachments } from "./loadAttachments.js";
import { routeDraftingQuery } from "./router.js";
import { buildClarifyingResponse } from "./questionnaire.js";
import { generateDraftFromPlan } from "./generateDraft.js";
import type { DraftingExecutionResult } from "./types.js";

const DEBUG_DRAFTING = process.env.DEBUG_DRAFTING === "1";

type CurrentDraftContext = {
  id?: string | null;
  title?: string | null;
  draftText?: string | null;
  filledValues?: Record<string, string> | null;
};

type Input = {
  userId: string;
  query: string;
  messages?: ChatTurn[];
  attachmentIds?: string[];
  currentDocumentContext?: CurrentDraftContext | null;
};

export async function orchestrateDrafting({
  userId,
  query,
  messages = [],
  attachmentIds = [],
  currentDocumentContext = null,
}: Input): Promise<DraftingExecutionResult> {
  const cleanAttachmentIds = Array.isArray(attachmentIds)
    ? attachmentIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const attachments = await loadDraftAttachments({
    userId,
    attachmentIds: cleanAttachmentIds,
  });

  if (DEBUG_DRAFTING) {
    console.log("[drafting] attachmentIds:", cleanAttachmentIds);
    console.log("[drafting] loadedAttachments:", attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      hasText: !!a.extractedText,
      templateId: a.templateId,
    })));
  }
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

  if (DEBUG_DRAFTING) {
    console.log("[drafting] plan.summary", {
      resolvedQuery: plan.resolvedQuery,
      detectedFamily: plan.detectedFamily,
      strategy: plan.strategy,
      matchLevel: plan.matchLevel,
      templateCandidates:
        plan.templateCandidates?.map((t) => ({
          id: t.id,
          title: t.title,
          source: t.source,
          score: t.score,
        })) || [],
      extractedFactsKeys: Object.keys(plan.extractedFacts || {}),
    });
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
      confidence:
        plan.matchLevel === "exact"
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

  if (DEBUG_DRAFTING) {
    console.log("[drafting] generated summary (excerpt):", String(summary || "").slice(0, 800));
  }

  return {
    mode: "drafting_studio",
    answerType: "drafting_draft",
    summary,
    confidence:
      plan.matchLevel === "exact"
        ? 0.88
        : plan.matchLevel === "adjacent"
        ? 0.78
        : 0.63,
    sources,
    plan,
  };
}
