import { canonicalizeCourt, getCourtIdsForFilter } from "../utils/courtResolver.js";
function unique(values) {
    return [...new Set(values)];
}
function extractYear(value) {
    const text = String(value || "").trim();
    if (!text)
        return null;
    const match = text.match(/\b(19|20)\d{2}\b/);
    if (!match)
        return null;
    const year = Number(match[0]);
    return Number.isFinite(year) ? year : null;
}
export function getRequestedCourtCodes(classified) {
    return unique((classified.filters?.courts || [])
        .map((court) => canonicalizeCourt({ court }).code)
        .filter((code) => Boolean(code)));
}
export function getRequestedCourtIds(classified) {
    return unique((classified.filters?.courts || []).flatMap((court) => getCourtIdsForFilter(court)));
}
function buildImplicitDecisionYearRange(classified) {
    const nowYear = new Date().getFullYear();
    if (classified.intent === "latest_cases") {
        return { gte: nowYear - 2, lte: nowYear };
    }
    if (classified.strategy === "recency_heavy") {
        return { gte: nowYear - 3, lte: nowYear };
    }
    return null;
}
export function buildDecisionYearRange(classified) {
    const explicitFrom = extractYear(classified.filters?.dateFrom || null);
    const explicitTo = extractYear(classified.filters?.dateTo || null);
    if (explicitFrom || explicitTo) {
        const range = {};
        if (explicitFrom)
            range.gte = explicitFrom;
        if (explicitTo)
            range.lte = explicitTo;
        return Object.keys(range).length ? range : null;
    }
    return buildImplicitDecisionYearRange(classified);
}
export function buildDecisionDateRange(classified) {
    const from = String(classified.filters?.dateFrom || "").trim();
    const to = String(classified.filters?.dateTo || "").trim();
    if (!from && !to)
        return null;
    const range = {};
    if (from)
        range.gte = from.includes("T") ? from : `${from}T00:00:00Z`;
    if (to)
        range.lte = to.includes("T") ? to : `${to}T23:59:59Z`;
    return Object.keys(range).length ? range : null;
}
export function buildQdrantPayloadFilter(classified) {
    const must = [];
    const requestedCourtIds = getRequestedCourtIds(classified);
    if (requestedCourtIds.length === 1) {
        must.push({
            key: "courtId",
            match: {
                value: requestedCourtIds[0],
            },
        });
    }
    else if (requestedCourtIds.length > 1) {
        must.push({
            should: requestedCourtIds.map((courtId) => ({
                key: "courtId",
                match: { value: courtId },
            })),
        });
    }
    const decisionYearRange = buildDecisionYearRange(classified);
    if (decisionYearRange) {
        must.push({
            key: "decisionYear",
            range: decisionYearRange,
        });
    }
    const decisionDateRange = buildDecisionDateRange(classified);
    if (decisionDateRange) {
        must.push({
            key: "decisionDate",
            range: decisionDateRange,
        });
    }
    if (!must.length)
        return undefined;
    return { must };
}
//# sourceMappingURL=payloadFilters.js.map