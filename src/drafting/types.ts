export type DocumentFamily =
  | "notice"
  | "petition"
  | "contract"
  | "deed"
  | "agreement"
  | "affidavit"
  | "undertaking"
  | "acknowledgement"
  | "application"
  | "reply"
  | "power_of_attorney"
  | "declaration"
  | "misc";

export type DraftingIntent =
  | "draft_from_library"
  | "draft_from_user_format"
  | "hybrid_draft"
  | "fresh_draft"
  | "revise_existing_draft"
  | "extract_template"
  | "save_template"
  | "compare_with_precedent";

export type DraftMatchLevel = "exact" | "adjacent" | "none";

export type DraftStrategy =
  | "exact_template"
  | "adjacent_template"
  | "hybrid_template"
  | "fresh_generation"
  | "user_format_override";

export type DraftingTone = "neutral" | "formal" | "strict" | "aggressive";

export type DraftTemplateCandidate = {
  id: string;
  source: "SYSTEM" | "FIRM" | "SESSION_UPLOAD";
  title: string;
  family: string;
  subtype: string | null;
  summary: string;
  tags: string[];
  rawText: string;
  normalizedText: string;
  placeholders: Array<Record<string, unknown>>;
  clauseBlocks: Array<Record<string, unknown>>;
  precedentStrength: "STRONG" | "STANDARD" | "BASIC" | "LEGACY";
  riskNotes: string[];
  sourceRef: string | null;
  score: number;
};

export type DraftingFieldMap = Record<string, string>;

export type DraftingRouterState = {
  isFollowUp: boolean;
  shouldTreatAsAnswers: boolean;
  priorAnswerType: "drafting_questions" | "drafting_draft" | null;
  lockedFamily: DocumentFamily | null;
  lockedSubtype: string | null;
  draftingObjective: string | null;
  preferredTone: DraftingTone;
  normalizedUserBrief: string;
  extractedFacts: DraftingFieldMap;
  missingFacts: string[];
  shouldGenerateNow: boolean;
  confidence: number;
  notes: string[];
};

export type DraftingPlan = {
  originalQuery: string;
  resolvedQuery: string;
  intent: DraftingIntent;
  detectedFamily: DocumentFamily | null;
  detectedSubtype: string | null;
  preferredTone: DraftingTone;
  matchLevel: DraftMatchLevel;
  strategy: DraftStrategy;
  matchedTemplateIds: string[];
  templateCandidates: DraftTemplateCandidate[];
  draftingObjective: string | null;
  extractedFacts: DraftingFieldMap;
  missingFields: string[];
  shouldAskClarifyingQuestions: boolean;
  shouldUseUserAttachmentFirst: boolean;
  reasoningNotes: string[];
  routerState: DraftingRouterState;
};

export type DraftingExecutionResult = {
  mode: "drafting_studio";
  answerType: "drafting_questions" | "drafting_draft";
  summary: string;
  confidence: number;
  sources: Array<{
    title: string;
    citation: string;
    range?: string;
  }>;
  plan: DraftingPlan;
};

export type DraftingAttachmentRef = {
  id: string;
  fileName: string;
  mimeType: string;
  extractedText: string;
  conversationId?: string | null;
  templateId?: string | null;
  parsedJson?: Record<string, unknown> | null;
};