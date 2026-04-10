export const ROUTER_VERSION = "1.0";
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
- If the user explicitly names a court or forum (for example Supreme Court, Delhi High Court, Gujarat High Court), copy it into entities.courts and retrievalPlan.filters.courts.
- Never broaden an explicit court constraint. If the query says Supreme Court, do not generalize it to all courts or to India generally.
- For latest/recent queries with an explicit court constraint, preserve the court constraint and apply recency through filters/strategy, not by dropping the court.
- If the query distinguishes the final deciding court from the originating state or lower forum, preserve both.
- For phrases such as "from Gujarat", "happened in Gujarat", "arising from Gujarat", "originating in Gujarat", "went to Supreme Court from Gujarat", put "Gujarat" into entities.originJurisdiction and retrievalPlan.filters.originJurisdiction.
- Do not replace an explicit origin state like Gujarat with "India".
- For phrases such as "trial court", "civil court", "subordinate court", "sessions court", "district court", "judicial officer", copy those hints into entities.lowerCourtHints and retrievalPlan.filters.lowerCourtHints.
- If the deciding court is Supreme Court and the origin is Gujarat, preserve both: courts=["Supreme Court"], originJurisdiction=["Gujarat"].
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
                ],
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
                    "originJurisdiction",
                    "lowerCourtHints",
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
                                ],
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
                    originJurisdiction: {
                        type: "array",
                        items: { type: "string" },
                    },
                    lowerCourtHints: {
                        type: "array",
                        items: { type: "string" },
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
                        ],
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
                            "originJurisdiction",
                            "lowerCourtHints",
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
                            originJurisdiction: {
                                type: "array",
                                items: { type: "string" },
                            },
                            lowerCourtHints: {
                                type: "array",
                                items: { type: "string" },
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
};
export function assertRouterOutput(value) {
    return value;
}
//# sourceMappingURL=routerSchema.js.map