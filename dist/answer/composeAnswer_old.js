import { generateLlmAnswer } from "./llmAnswer.js";
function compact(text) {
    return (text || "").replace(/\s+/g, " ").trim();
}
function truncate(text, max = 700) {
    const clean = compact(text);
    if (clean.length <= max)
        return clean;
    return `${clean.slice(0, max).trim()}...`;
}
function normalizeLoose(text) {
    return (text || "")
        .toLowerCase()
        .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function makeCitation(group, chunk) {
    return {
        caseId: group.caseId,
        title: group.title,
        citation: group.citation,
        chunkId: chunk?.chunkId || "",
        paragraphStart: chunk?.paragraphStart ?? null,
        paragraphEnd: chunk?.paragraphEnd ?? null,
    };
}
function metadataLabel(field) {
    switch (field) {
        case "citation":
            return "Citation";
        case "equivalentCitations":
            return "Equivalent citations";
        case "court":
            return "Court";
        case "judges":
            return "Judges";
        case "dateOfDecision":
            return "Date of decision";
        case "caseNo":
            return "Case number";
        case "actsReferred":
            return "Acts referred";
        case "subject":
            return "Subject";
        case "finalDecision":
            return "Final decision";
        case "advocates":
            return "Advocates";
        case "caseType":
            return "Case type";
        default:
            return "Metadata";
    }
}
function formatMetadataValue(value) {
    if (value == null)
        return "";
    if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter(Boolean).join(", ");
    }
    return String(value).trim();
}
function buildDigest(group, summaryOverride, citationsOverride) {
    const firstChunk = group?.chunks?.[0];
    const citations = citationsOverride && citationsOverride.length
        ? citationsOverride
        : firstChunk
            ? [makeCitation(group, firstChunk)]
            : [];
    return {
        caseId: group?.caseId,
        title: group?.title,
        citation: group?.citation,
        summary: summaryOverride || truncate(firstChunk?.text || "No summary available."),
        citations,
    };
}
function fallbackAnswer(searchResult) {
    const warnings = ["No sufficiently relevant grouped cases were found."];
    const traceNotes = Array.isArray(searchResult?.trace?.notes)
        ? searchResult.trace.notes
        : [];
    if (traceNotes.some((note) => String(note || "").toLowerCase().includes("latest/recent"))) {
        warnings.push("Recency-aware retrieval is still heuristic because decision dates are parsed at runtime from text metadata.");
    }
    return {
        answerType: "hybrid_answer",
        summary: "No sufficiently relevant answer could be generated.",
        caseDigests: [],
        citations: [],
        confidence: 0.2,
        warnings,
    };
}
function buildMetadataAnswer(searchResult) {
    const top = searchResult.groupedCases?.[0];
    const topChunk = top?.chunks?.[0];
    const payload = topChunk?.payload || {};
    const field = searchResult?.query?.metadataField || "citation";
    const value = field === "citation" ? top?.citation : payload[field];
    const formatted = formatMetadataValue(value);
    const summary = `${top?.title || "This case"} ${metadataLabel(field)}: ${formatted || "Not available"}.`;
    const digest = buildDigest(top, summary);
    return {
        answerType: "metadata_lookup",
        summary,
        caseDigests: [digest],
        citations: digest.citations,
        confidence: formatted ? 0.9 : 0.72,
        warnings: formatted ? [] : ["Requested metadata field was not clearly available."],
    };
}
function buildFullJudgmentAnswer(searchResult) {
    const top = searchResult.groupedCases?.[0];
    const joined = (top?.chunks || [])
        .map((c) => compact(c.text || ""))
        .filter(Boolean)
        .join(" ");
    const summary = truncate(joined, 4000);
    const digest = buildDigest(top, summary);
    return {
        answerType: "full_judgment",
        summary,
        caseDigests: [digest],
        citations: digest.citations,
        confidence: joined ? 0.88 : 0.6,
        warnings: joined ? [] : ["Full judgment text could not be reconstructed completely."],
    };
}
function uniqueCitations(citations) {
    const seen = new Set();
    const out = [];
    for (const c of citations || []) {
        const key = `${c.caseId}|${c.chunkId}|${c.paragraphStart}|${c.paragraphEnd}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(c);
        }
    }
    return out;
}
function buildTopFiveDigests(groupedCases) {
    return (groupedCases || []).slice(0, 5).map((group) => {
        const bestChunk = group?.chunks?.[0];
        return {
            caseId: group?.caseId,
            title: group?.title,
            citation: group?.citation,
            summary: truncate(bestChunk?.text || "No summary available.", 420),
            citations: bestChunk ? [makeCitation(group, bestChunk)] : [],
        };
    });
}
function buildTopFiveCitations(groupedCases) {
    const out = [];
    for (const group of (groupedCases || []).slice(0, 5)) {
        const chunk = group?.chunks?.[0];
        if (chunk)
            out.push(makeCitation(group, chunk));
    }
    return out;
}
function scoreTextMatch(text, target) {
    const a = normalizeLoose(text);
    const b = normalizeLoose(target);
    if (!a || !b)
        return 0;
    if (a === b)
        return 6;
    if (a.includes(b) || b.includes(a))
        return 4;
    const aTokens = new Set(a.split(" ").filter(Boolean));
    const bTokens = b.split(" ").filter(Boolean);
    const overlap = bTokens.filter((tok) => aTokens.has(tok)).length;
    const ratio = overlap / Math.max(1, bTokens.length);
    if (ratio >= 0.85)
        return 3;
    if (ratio >= 0.65)
        return 2;
    if (ratio >= 0.45)
        return 1;
    return 0;
}
function scoreGroupAgainstDigest(group, digest) {
    if (!group || !digest)
        return 0;
    let score = 0;
    if (digest.title) {
        score += scoreTextMatch(group.title || "", digest.title) * 2;
    }
    if (digest.citation) {
        score += scoreTextMatch(group.citation || "", digest.citation) * 2;
    }
    return score;
}
function scoreGroupAgainstQueryTargets(group, query) {
    if (!group || !query)
        return 0;
    let score = 0;
    if (query.caseTarget) {
        score += scoreTextMatch(group.title || "", query.caseTarget) * 2;
    }
    for (const target of query.comparisonTargets || []) {
        score += scoreTextMatch(group.title || "", target);
    }
    for (const citation of query.citations || []) {
        score += scoreTextMatch(group.citation || "", citation);
    }
    return score;
}
function reorderGroupedCases(groupedCases = [], searchResult = {}) {
    const trace = searchResult.trace || {};
    const resolved = trace.resolvedReference || {};
    const query = searchResult.query || {};
    const resolvedDigests = Array.isArray(resolved.resolvedCaseDigests)
        ? resolved.resolvedCaseDigests
        : [];
    if (!groupedCases.length)
        return groupedCases;
    const scored = groupedCases.map((group, index) => {
        let score = 0;
        for (const digest of resolvedDigests) {
            score += scoreGroupAgainstDigest(group, digest);
        }
        score += scoreGroupAgainstQueryTargets(group, query);
        if (resolved.referenceType === "ordinal" || resolved.referenceType === "deictic") {
            score *= 1.4;
        }
        return {
            group,
            score,
            index,
        };
    });
    const hasMeaningfulSignal = scored.some((item) => item.score > 0);
    if (!hasMeaningfulSignal)
        return groupedCases;
    return scored
        .sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return a.index - b.index;
    })
        .map((item) => item.group);
}
function inferCourtCodeFromPayload(payload) {
    const fileName = String(payload?.fileName ?? "").trim();
    const court = String(payload?.court ?? "").toLowerCase();
    if (fileName.startsWith("1"))
        return "SC";
    if (fileName.startsWith("2"))
        return "DELHI_HC";
    if (fileName.startsWith("3"))
        return "BOMBAY_HC";
    if (fileName.startsWith("4"))
        return "GUJARAT_HC";
    if (court.includes("supreme court"))
        return "SC";
    if (court.includes("delhi"))
        return "DELHI_HC";
    if (court.includes("bombay"))
        return "BOMBAY_HC";
    if (court.includes("gujarat"))
        return "GUJARAT_HC";
    return null;
}
function parseDecisionTime(payload) {
    const candidates = [
        payload?.dateOfDecision,
        payload?.decisionDate,
        payload?.judgmentDate,
        payload?.date,
        payload?.year,
    ];
    for (const value of candidates) {
        if (value == null)
            continue;
        if (typeof value === "number" && Number.isFinite(value)) {
            if (value > 1800 && value < 3000) {
                return new Date(`${value}-01-01`).getTime();
            }
        }
        const text = String(value).trim();
        if (!text)
            continue;
        const yearOnly = text.match(/\b(19|20)\d{2}\b/);
        if (yearOnly && yearOnly[0].length === text.length) {
            return new Date(`${text}-01-01`).getTime();
        }
        const parsed = Date.parse(text);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    return null;
}
function groupBlob(group) {
    return [
        group?.title || "",
        group?.citation || "",
        ...((group?.chunks || []).map((c) => [
            c?.text || "",
            String(c?.payload?.court || ""),
            String(c?.payload?.courtName || ""),
            String(c?.payload?.jurisdiction || ""),
            String(c?.payload?.state || ""),
            String(c?.payload?.bench || ""),
            String(c?.payload?.subject || ""),
            String(c?.payload?.caseType || ""),
            Array.isArray(c?.payload?.actsReferred) ? c.payload.actsReferred.join(" ") : "",
            String(c?.payload?.dateOfDecision || ""),
        ].join(" "))),
    ]
        .join(" ")
        .toLowerCase();
}
function latestRetrievalPenalty(searchResult, warningsOut) {
    const query = searchResult?.query || {};
    if (query.intent !== "latest_cases")
        return 0;
    const filters = query.filters || {};
    const groupedCases = Array.isArray(searchResult?.groupedCases)
        ? searchResult.groupedCases
        : [];
    if (!groupedCases.length)
        return 0.18;
    let penalty = 0;
    const courts = (filters.courts || []).map((c) => normalizeLoose(c));
    const jurisdictions = (filters.jurisdiction || []).map((j) => normalizeLoose(j));
    const subjects = (filters.subjects || []).map((s) => normalizeLoose(s));
    const newestTime = Math.max(...groupedCases
        .map((group) => Math.max(0, ...((group.chunks || []).map((c) => parseDecisionTime(c.payload || {}) || 0))))
        .filter(Boolean));
    for (const group of groupedCases.slice(0, 5)) {
        const blob = groupBlob(group);
        const codes = new Set((group.chunks || [])
            .map((c) => inferCourtCodeFromPayload(c.payload || {}))
            .filter(Boolean));
        if (courts.length) {
            const courtOk = courts.every((court) => {
                if (court.includes("supreme"))
                    return codes.has("SC") || blob.includes("supreme court");
                if (court.includes("delhi"))
                    return codes.has("DELHI_HC") || blob.includes("delhi");
                if (court.includes("bombay"))
                    return codes.has("BOMBAY_HC") || blob.includes("bombay");
                if (court.includes("gujarat"))
                    return codes.has("GUJARAT_HC") || blob.includes("gujarat");
                return blob.includes(court);
            });
            if (!courtOk)
                penalty += 0.06;
        }
        if (jurisdictions.length) {
            const jurisdictionOk = jurisdictions.every((j) => blob.includes(j));
            if (!jurisdictionOk)
                penalty += 0.05;
        }
        if (subjects.length) {
            const subjectOk = subjects.some((s) => blob.includes(s));
            if (!subjectOk)
                penalty += 0.05;
        }
        const groupTime = Math.max(0, ...((group.chunks || []).map((c) => parseDecisionTime(c.payload || {}) || 0)));
        if (newestTime && groupTime && newestTime - groupTime > 1000 * 60 * 60 * 24 * 365 * 5) {
            penalty += 0.05;
        }
    }
    if (penalty >= 0.12) {
        warningsOut.push("Latest/recent retrieval still includes mixed or older results because decision dates are parsed heuristically from metadata strings.");
    }
    return penalty;
}
function citationResolutionPenalty(searchResult, warningsOut) {
    const notes = Array.isArray(searchResult?.trace?.notes) ? searchResult.trace.notes : [];
    let penalty = 0;
    if (notes.some((note) => String(note || "").toLowerCase().includes("citation-first resolution found no exact citation match"))) {
        penalty += 0.18;
        warningsOut.push("Direct citation resolution was not exact; the system used secondary evidence or citation-alias recovery.");
    }
    if (notes.some((note) => String(note || "").toLowerCase().includes("recovered citation alias"))) {
        penalty += 0.06;
    }
    return penalty;
}
function deriveWarnings(searchResult, llmText) {
    const warnings = [];
    const traceNotes = Array.isArray(searchResult?.trace?.notes)
        ? searchResult.trace.notes
        : [];
    if (!llmText) {
        warnings.push("LLM generation was unavailable, so a deterministic fallback was used.");
    }
    if (traceNotes.some((note) => String(note || "").toLowerCase().includes("router output was weak"))) {
        warnings.push("Router confidence was weak, so legacy classification fallback was used.");
    }
    if (traceNotes.some((note) => String(note || "").toLowerCase().includes("latest/recent case query"))) {
        warnings.push("Recency-aware retrieval is heuristic because decision dates are parsed at runtime from metadata strings.");
    }
    citationResolutionPenalty(searchResult, warnings);
    latestRetrievalPenalty(searchResult, warnings);
    return [...new Set(warnings)];
}
function deriveConfidence(searchResult, llmText, groupedCases) {
    let confidence = llmText ? 0.84 : 0.58;
    const routerConfidence = Number(searchResult?.trace?.router?.confidence);
    if (Number.isFinite(routerConfidence)) {
        confidence = llmText
            ? Math.min(0.92, 0.62 + routerConfidence * 0.3)
            : Math.min(0.72, 0.42 + routerConfidence * 0.25);
    }
    if (!groupedCases?.length) {
        confidence = Math.min(confidence, 0.25);
    }
    if (Array.isArray(searchResult?.trace?.notes) &&
        searchResult.trace.notes.some((note) => String(note || "").toLowerCase().includes("fallback"))) {
        confidence = Math.max(0.35, confidence - 0.08);
    }
    const penaltyWarnings = [];
    let penalty = 0;
    penalty += citationResolutionPenalty(searchResult, penaltyWarnings);
    penalty += latestRetrievalPenalty(searchResult, penaltyWarnings);
    confidence = Math.max(0.25, confidence - penalty);
    return Number(confidence.toFixed(2));
}
export async function composeAnswer(searchResult) {
    const { query, mode } = searchResult;
    const originalGroupedCases = Array.isArray(searchResult.groupedCases)
        ? searchResult.groupedCases
        : [];
    if (!originalGroupedCases.length) {
        return fallbackAnswer(searchResult);
    }
    const groupedCases = reorderGroupedCases(originalGroupedCases, searchResult);
    const effectiveSearchResult = {
        ...searchResult,
        groupedCases,
    };
    if (query.intent === "metadata_lookup" || mode === "metadata") {
        return buildMetadataAnswer(effectiveSearchResult);
    }
    if (query.intent === "full_judgment" || mode === "full_judgment") {
        return buildFullJudgmentAnswer(effectiveSearchResult);
    }
    const llm = await generateLlmAnswer(effectiveSearchResult);
    const summary = llm?.text ||
        truncate(groupedCases?.[0]?.chunks?.[0]?.text || "No answer available.", 900);
    const llmCitations = uniqueCitations(llm?.usedCitations || []);
    const warnings = deriveWarnings(effectiveSearchResult, llm?.text);
    const confidence = deriveConfidence(effectiveSearchResult, llm?.text, groupedCases);
    console.log("[composeAnswer] groupedCases:", groupedCases.length);
    console.log("[composeAnswer] llmCitations:", llmCitations.length);
    if (groupedCases.length === 1) {
        const top = groupedCases[0];
        const digest = buildDigest(top, summary, llmCitations.length ? llmCitations : undefined);
        return {
            answerType: "hybrid_answer",
            summary,
            caseDigests: [digest],
            citations: llmCitations.length ? llmCitations : digest.citations,
            confidence,
            warnings,
        };
    }
    return {
        answerType: "hybrid_answer",
        summary,
        caseDigests: buildTopFiveDigests(groupedCases),
        citations: llmCitations.length
            ? llmCitations
            : buildTopFiveCitations(groupedCases),
        confidence,
        warnings,
    };
}
//# sourceMappingURL=composeAnswer_old.js.map