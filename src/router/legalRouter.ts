import OpenAI from "openai";
import type {
  ChatTurn,
  ConversationState,
  RouterOutput,
} from "../types/search.js";
import { env } from "../config/env.js";
import {
  ROUTER_SYSTEM_PROMPT,
  ROUTER_VERSION,
  assertRouterOutput,
  routerJsonSchema,
} from "./routerSchema.js";

const openai = new OpenAI({
  apiKey: env.llm.apiKey,
  baseURL: env.llm.baseUrl,
});

const DEBUG_ROUTER = process.env.DEBUG_ROUTER === "1";

function compact(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeLoose(text: string | null | undefined): string {
  return (text || "")
    .toLowerCase()
    .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimMessages(messages: ChatTurn[] = [], limit = 8): ChatTurn[] {
  return messages
    .slice(-limit)
    .map((m) => ({
      role: m.role,
      content: compact(m.content),
      caseDigests: Array.isArray(m.caseDigests)
        ? m.caseDigests.slice(0, 5).map((d) => ({
            caseId: d.caseId,
            title: compact(d.title),
            citation: compact(d.citation),
            summary: compact(d.summary),
          }))
        : [],
    }))
    .filter((m) => m.content.length > 0);
}

function buildRouterInput(params: {
  query: string;
  messages?: ChatTurn[];
  state?: ConversationState;
}) {
  const { query, messages = [], state } = params;

  return {
    query: compact(query),
    recentMessages: trimMessages(messages, 8),
    conversationState: state ?? {
      activeTopic: null,
      activeCaseIds: [],
      activeCaseTitles: [],
      activeCitations: [],
      activeJurisdiction: null,
      activeCourts: [],
      activeStatutes: [],
      activeSections: [],
      activeTimeScope: null,
      lastAnswerType: null,
      lastResultSet: [],
    },
  };
}

function buildFallbackRouterOutput(query: string): RouterOutput {
  return {
    version: ROUTER_VERSION,
    taskType: "unknown",
    userGoal: query,
    isFollowUp: false,
    followUpReferenceType: "none",
    resolvedQuery: query,
    inheritFromState: {
      jurisdiction: false,
      court: false,
      statute: false,
      section: false,
      timeScope: false,
      resultSet: false,
    },
    entities: {
      caseTarget: null,
      comparisonTargets: [],
      citations: [],
      metadataField: null,
      jurisdiction: [],
      courts: [],
      statutes: [],
      sections: [],
      subjects: [],
      timeQualifier: "none",
    },
    retrievalPlan: {
      strategy: "balanced",
      queryRewrites: [query],
      filters: {
        jurisdiction: [],
        courts: [],
        statutes: [],
        sections: [],
        subjects: [],
        dateFrom: null,
        dateTo: null,
        onlyReported: false,
      },
      topK: 24,
      rerankTopN: 12,
      expandFullCase: false,
    },
    clarificationNeeded: false,
    clarificationQuestion: null,
    confidence: 0.35,
    reasons: ["router fallback used after model failure"],
  };
}

function hasExplicitFollowUpCue(query: string): boolean {
  const q = query.toLowerCase();

  return (
    /\b(that case|this case|that judgment|this judgment|that one|this one|it|same case|same judgment|the above case|the above judgment|former|latter)\b/.test(
      q
    ) ||
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(case|one|judgment|decision)\b/.test(
      q
    ) ||
    /\b(compare them|compare those|difference between them|distinguish them)\b/.test(q)
  );
}

function queryReferencesConversationState(
  query: string,
  state?: ConversationState
): boolean {
  if (!state) return false;
  const q = normalizeLoose(query);

  for (const title of state.activeCaseTitles || []) {
    const t = normalizeLoose(title);
    if (t && (q.includes(t) || t.includes(q))) return true;
  }

  for (const citation of state.activeCitations || []) {
    const c = normalizeLoose(citation);
    if (c && q.includes(c)) return true;
  }

  return false;
}

function routerCarriesStateInheritance(router: RouterOutput): boolean {
  const inherit = router.inheritFromState || {
    jurisdiction: false,
    court: false,
    statute: false,
    section: false,
    timeScope: false,
    resultSet: false,
  };

  return Object.values(inherit).some(Boolean);
}

function routerLooksLikeFreshQuery(router: RouterOutput): boolean {
  return Boolean(
    router.entities.caseTarget ||
      router.entities.citations?.length ||
      router.entities.comparisonTargets?.length ||
      router.entities.subjects?.length ||
      router.entities.courts?.length ||
      router.entities.statutes?.length ||
      router.entities.sections?.length
  );
}

function sanitizeRouterFollowUp(params: {
  query: string;
  state?: ConversationState;
  router: RouterOutput;
}): RouterOutput {
  const { query, state, router } = params;

  if (!router.isFollowUp) return router;

  const explicitCue = hasExplicitFollowUpCue(query);
  const referencesState = queryReferencesConversationState(query, state);
  const inheritsState = routerCarriesStateInheritance(router);
  const looksFresh = routerLooksLikeFreshQuery(router);

  if (!explicitCue && !referencesState && !inheritsState && looksFresh) {
    return {
      ...router,
      isFollowUp: false,
      followUpReferenceType: "none",
      inheritFromState: {
        jurisdiction: false,
        court: false,
        statute: false,
        section: false,
        timeScope: false,
        resultSet: false,
      },
      reasons: [...(router.reasons || []), "follow-up flag cleared by post-router topic-shift guard"],
    };
  }

  if (
    !explicitCue &&
    !referencesState &&
    router.followUpReferenceType === "continuation" &&
    looksFresh
  ) {
    return {
      ...router,
      isFollowUp: false,
      followUpReferenceType: "none",
      inheritFromState: {
        jurisdiction: false,
        court: false,
        statute: false,
        section: false,
        timeScope: false,
        resultSet: false,
      },
      reasons: [...(router.reasons || []), "continuation downgraded to fresh query by post-router guard"],
    };
  }

  return router;
}

export async function routeLegalQuery(params: {
  query: string;
  messages?: ChatTurn[];
  state?: ConversationState;
}): Promise<RouterOutput> {
  const input = buildRouterInput(params);

  if (DEBUG_ROUTER) {
    console.log("[legalRouter] input:");
    console.log(JSON.stringify(input, null, 2));
  }

  try {
    const response = await openai.responses.create({
      model: env.llm.routerModel,
      input: [
        {
          role: "system",
          content: ROUTER_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...routerJsonSchema,
        },
      },
    });

    const jsonText = response.output_text || "";

    if (DEBUG_ROUTER) {
      console.log("[legalRouter] raw structured output:");
      console.log(jsonText || "<empty>");
    }

    if (!jsonText) {
      return buildFallbackRouterOutput(params.query);
    }

    const parsed = JSON.parse(jsonText) as RouterOutput;

    if (DEBUG_ROUTER) {
      console.log("[legalRouter] parsed router JSON:");
      console.log(JSON.stringify(parsed, null, 2));
    }

    const sanitized = sanitizeRouterFollowUp({
      query: params.query,
      state: params.state,
      router: parsed,
    });

    if (DEBUG_ROUTER && sanitized.isFollowUp !== parsed.isFollowUp) {
      console.log("[legalRouter] sanitized follow-up flag:");
      console.log(JSON.stringify(sanitized, null, 2));
    }

    return assertRouterOutput(sanitized);
  } catch (error) {
    console.error("[legalRouter] routing failed:", error);
    return buildFallbackRouterOutput(params.query);
  }
}