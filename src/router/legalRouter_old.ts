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
    return assertRouterOutput(parsed);
  } catch (error) {
    console.error("[legalRouter] routing failed:", error);
    return buildFallbackRouterOutput(params.query);
  }
}