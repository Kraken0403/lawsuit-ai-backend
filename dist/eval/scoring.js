function compact(text) {
    return (text || "").replace(/\s+/g, " ").trim();
}
function normalizeLoose(text) {
    return (text || "")
        .toLowerCase()
        .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function includesLoose(haystack, needle) {
    const h = normalizeLoose(haystack);
    const n = normalizeLoose(needle);
    if (!h || !n)
        return false;
    return h.includes(n) || n.includes(h);
}
function chooseFailureBucket(params) {
    const { searchResult, answer, checks, latencyMs, maxLatencyMs } = params;
    if (typeof maxLatencyMs === "number" && latencyMs > maxLatencyMs) {
        return "latency_issue";
    }
    if (checks.intent === false) {
        return "router_failure";
    }
    const groupedCases = Array.isArray(searchResult?.groupedCases) ? searchResult.groupedCases : [];
    if (!groupedCases.length) {
        return "retrieval_failure";
    }
    if (checks.topCaseId === false ||
        checks.topCitationIncludes === false ||
        checks.topTitleIncludes === false ||
        checks.minGroupedCases === false) {
        return "ranking_failure";
    }
    if (checks.answerMustContain === false || checks.answerMustNotContain === false) {
        const query = String(searchResult?.query?.originalQuery || "").toLowerCase();
        if (query.includes("first case") ||
            query.includes("above case") ||
            query.includes("that case") ||
            query.includes("this case")) {
            return "follow_up_failure";
        }
        return "answer_generation_failure";
    }
    if (!answer) {
        return "answer_generation_failure";
    }
    return "unknown";
}
export function scoreEvalCase(params) {
    const { def, searchResult, answer, latencyMs } = params;
    const groupedCases = Array.isArray(searchResult?.groupedCases) ? searchResult.groupedCases : [];
    const top = groupedCases[0];
    const summary = compact(answer?.summary || "");
    const intent = searchResult?.query?.intent || null;
    const checks = {};
    if (def.expectation.expectedIntent) {
        checks.intent = intent === def.expectation.expectedIntent;
    }
    if (typeof def.expectation.topCaseId === "number") {
        checks.topCaseId = Number(top?.caseId) === def.expectation.topCaseId;
    }
    if (def.expectation.topCitationIncludes) {
        checks.topCitationIncludes = includesLoose(String(top?.citation || ""), def.expectation.topCitationIncludes);
    }
    if (def.expectation.topTitleIncludes) {
        checks.topTitleIncludes = includesLoose(String(top?.title || ""), def.expectation.topTitleIncludes);
    }
    if (typeof def.expectation.minGroupedCases === "number") {
        checks.minGroupedCases = groupedCases.length >= def.expectation.minGroupedCases;
    }
    if (Array.isArray(def.expectation.answerMustContain) && def.expectation.answerMustContain.length) {
        checks.answerMustContain = def.expectation.answerMustContain.every((piece) => includesLoose(summary, piece));
    }
    if (Array.isArray(def.expectation.answerMustNotContain) && def.expectation.answerMustNotContain.length) {
        checks.answerMustNotContain = def.expectation.answerMustNotContain.every((piece) => !includesLoose(summary, piece));
    }
    if (typeof def.expectation.maxLatencyMs === "number") {
        checks.maxLatencyMs = latencyMs <= def.expectation.maxLatencyMs;
    }
    const pass = Object.values(checks).every((value) => value !== false);
    return {
        id: def.id,
        category: def.category,
        query: def.query,
        pass,
        latencyMs,
        checks,
        expected: def.expectation,
        actual: {
            intent,
            groupedCasesCount: groupedCases.length,
            topCaseId: top?.caseId ?? null,
            topCitation: top?.citation ?? null,
            topTitle: top?.title ?? null,
            answerSummary: summary || null,
            warnings: Array.isArray(answer?.warnings) ? answer.warnings : [],
            traceNotes: Array.isArray(searchResult?.trace?.notes) ? searchResult.trace.notes : [],
        },
        failureBucket: pass
            ? "none"
            : chooseFailureBucket({
                searchResult,
                answer,
                checks,
                latencyMs,
                maxLatencyMs: def.expectation.maxLatencyMs,
            }),
    };
}
//# sourceMappingURL=scoring.js.map