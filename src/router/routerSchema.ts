import type { MetadataField, QueryIntent, QueryStrategy, RouterOutput } from "../types/search.js";

export const ROUTER_VERSION = "1.0" as const;

export const ROUTER_SYSTEM_PROMPT = `
You are the legal query router for a legal RAG system.
Your job is to return ONLY structured JSON matching the provided schema.

Rules:
- Do not answer the user's legal question.
- Do not summarize cases.
- Only determine task type, follow-up status, entities, filters, and retrieval plan.
- Prefer precise structured extraction over guessy interpretation.
- If the user message depends on prior chat context, mark isFollowUp = true.
- If the query asks for latest or recent authorities, set timeQualifier accordingly and choose recency_heavy.
- If the query asks for full text / complete judgment, set expandFullCase = true and strategy = full_judgment.
- If the query asks for citation / court / judges / date / subject / advocates / case number etc, use metadata_lookup.
- If the query is ambiguous and cannot be safely resolved from the provided state, set clarificationNeeded = true.
- Confidence must be between 0 and 1.
`;

export const routerJsonSchema = {
  name: "legal_query_router",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "version",
      "taskType",
      "userGoal",
      "isFollowUp",
      "followUpReferenceType",
      "resolvedQuery",
      "inheritFromState",
      "entities",
      "retrievalPlan",
      "clarificationNeeded",
      "clarificationQuestion",
      "confidence",
      "reasons",
    ],
    properties: {
      version: {
        type: "string",
        enum: ["1.0"],
      },
      taskType: {
        type: "string",
        enum: [
          "case_lookup",
          "metadata_lookup",
          "full_judgment",
          "comparison",
          "issue_search",
          "holding_search",
          "latest_cases",
          "follow_up",
          "unknown",
        ] satisfies QueryIntent[],
      },
      userGoal: {
        type: "string",
      },
      isFollowUp: {
        type: "boolean",
      },
      followUpReferenceType: {
        type: "string",
        enum: ["none", "ordinal", "deictic", "comparison", "continuation", "implicit"],
      },
      resolvedQuery: {
        type: "string",
      },
      inheritFromState: {
        type: "object",
        additionalProperties: false,
        required: ["jurisdiction", "court", "statute", "section", "timeScope", "resultSet"],
        properties: {
          jurisdiction: { type: "boolean" },
          court: { type: "boolean" },
          statute: { type: "boolean" },
          section: { type: "boolean" },
          timeScope: { type: "boolean" },
          resultSet: { type: "boolean" },
        },
      },
      entities: {
        type: "object",
        additionalProperties: false,
        required: [
          "caseTarget",
          "comparisonTargets",
          "citations",
          "metadataField",
          "jurisdiction",
          "courts",
          "statutes",
          "sections",
          "subjects",
          "timeQualifier",
        ],
        properties: {
          caseTarget: {
            type: ["string", "null"],
          },
          comparisonTargets: {
            type: "array",
            items: { type: "string" },
          },
          citations: {
            type: "array",
            items: { type: "string" },
          },
          metadataField: {
            anyOf: [
              {
                type: "string",
                enum: [
                  "citation",
                  "equivalentCitations",
                  "court",
                  "judges",
                  "dateOfDecision",
                  "caseNo",
                  "actsReferred",
                  "subject",
                  "finalDecision",
                  "advocates",
                  "caseType",
                ] satisfies MetadataField[],
              },
              { type: "null" },
            ],
          },
          jurisdiction: {
            type: "array",
            items: { type: "string" },
          },
          courts: {
            type: "array",
            items: { type: "string" },
          },
          statutes: {
            type: "array",
            items: { type: "string" },
          },
          sections: {
            type: "array",
            items: { type: "string" },
          },
          subjects: {
            type: "array",
            items: { type: "string" },
          },
          timeQualifier: {
            type: "string",
            enum: ["latest", "recent", "historical", "none"],
          },
        },
      },
      retrievalPlan: {
        type: "object",
        additionalProperties: false,
        required: ["strategy", "queryRewrites", "filters", "topK", "rerankTopN", "expandFullCase"],
        properties: {
          strategy: {
            type: "string",
            enum: [
              "metadata_heavy",
              "balanced",
              "dense_heavy",
              "sparse_heavy",
              "full_judgment",
              "recency_heavy",
              "citation_heavy",
            ] satisfies QueryStrategy[],
          },
          queryRewrites: {
            type: "array",
            items: { type: "string" },
          },
          filters: {
            type: "object",
            additionalProperties: false,
            required: [
              "jurisdiction",
              "courts",
              "statutes",
              "sections",
              "subjects",
              "dateFrom",
              "dateTo",
              "onlyReported",
            ],
            properties: {
              jurisdiction: {
                type: "array",
                items: { type: "string" },
              },
              courts: {
                type: "array",
                items: { type: "string" },
              },
              statutes: {
                type: "array",
                items: { type: "string" },
              },
              sections: {
                type: "array",
                items: { type: "string" },
              },
              subjects: {
                type: "array",
                items: { type: "string" },
              },
              dateFrom: {
                type: ["string", "null"],
              },
              dateTo: {
                type: ["string", "null"],
              },
              onlyReported: {
                type: "boolean",
              },
            },
          },
          topK: {
            type: "number",
          },
          rerankTopN: {
            type: "number",
          },
          expandFullCase: {
            type: "boolean",
          },
        },
      },
      clarificationNeeded: {
        type: "boolean",
      },
      clarificationQuestion: {
        type: ["string", "null"],
      },
      confidence: {
        type: "number",
      },
      reasons: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

export function assertRouterOutput(value: RouterOutput): RouterOutput {
  return value;
}