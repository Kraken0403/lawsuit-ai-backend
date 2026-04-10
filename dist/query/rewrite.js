function unique(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const v = String(value || "").trim();
        if (!v)
            continue;
        const key = v.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}
function normalizeLoose(text) {
    return (text || "")
        .toLowerCase()
        .replace(/\b(vs\.?|v\/s|versus)\b/g, " v ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function expandOriginJurisdictionTerms(origins = []) {
    const out = [];
    for (const raw of origins) {
        const t = normalizeLoose(raw);
        if (t === "gujarat") {
            out.push("Gujarat", "from Gujarat", "State of Gujarat", "Gujarat-origin", "Saurashtra", "Kutch");
            continue;
        }
        if (t === "maharashtra") {
            out.push("Maharashtra", "from Maharashtra", "State of Maharashtra", "Bombay", "Mumbai");
            continue;
        }
        if (t === "karnataka") {
            out.push("Karnataka", "from Karnataka", "State of Karnataka");
            continue;
        }
        if (t === "delhi") {
            out.push("Delhi", "from Delhi", "State of Delhi");
            continue;
        }
        if (t === "tamil nadu") {
            out.push("Tamil Nadu", "from Tamil Nadu", "Madras");
            continue;
        }
        out.push(raw, `from ${raw}`, `State of ${raw}`);
    }
    return unique(out);
}
function expandLowerCourtHints(lowerCourtHints = []) {
    const out = [];
    for (const raw of lowerCourtHints) {
        const hint = normalizeLoose(raw);
        if (hint.includes("civil court")) {
            out.push("civil court", "civil judge", "principal civil judge", "city civil court", "subordinate court");
            continue;
        }
        if (hint.includes("trial court")) {
            out.push("trial court", "trial judge", "sessions court", "district and sessions judge", "magistrate", "JMFC");
            continue;
        }
        if (hint.includes("subordinate")) {
            out.push("subordinate court", "trial court", "civil judge", "district judge", "sessions judge");
            continue;
        }
        out.push(raw);
    }
    return unique(out);
}
function buildIssueBoostTerms(query) {
    const q = normalizeLoose(query.normalizedQuery || query.originalQuery || "");
    const filters = query.filters || {};
    const out = [];
    if (/\bnon[\s-]?existent\b|\bdoes not exist\b|\bfabricated\b|\bfalse citation\b|\bfake citation\b|\bfake judgment\b|\bforged\b|\bfraud on court\b|\bbogus\b|\bimaginary\b/.test(q)) {
        out.push("fake Supreme Court judgment", "fabricated Supreme Court citation", "false citation", "non-existent judgment", "non-existent Supreme Court judgment", "forged Supreme Court order", "bogus precedent", "imaginary judgment", "fraud on court");
    }
    if (/\bsupreme court\b|\bsc\b/.test(q)) {
        out.push("Supreme Court judgment", "Supreme Court order", "Supreme Court precedent", "Supreme Court citation");
    }
    if (/\bmurder\b|\bhomicide\b/.test(q)) {
        out.push("murder", "homicide", "Section 302", "302 IPC");
    }
    if (/\brape\b/.test(q)) {
        out.push("rape", "sexual assault", "Section 376", "376 IPC");
    }
    if (/\bbail\b/.test(q)) {
        out.push("bail", "regular bail", "anticipatory bail", "CrPC bail");
    }
    if (/\barbitration\b/.test(q)) {
        out.push("arbitration", "arbitrator", "seat of arbitration", "venue of arbitration");
    }
    if (/\bcivil court\b|\btrial court\b|\bsubordinate court\b|\bcivil judge\b/.test(q)) {
        out.push("civil court", "trial court", "subordinate court", "civil judge", "district judge");
    }
    out.push(...(filters.subjects || []), ...(filters.courts || []), ...expandOriginJurisdictionTerms(filters.originJurisdiction || []), ...expandLowerCourtHints(filters.lowerCourtHints || []));
    return unique(out);
}
export function buildHybridQueryText(query) {
    const citations = query.citations || [];
    const comparisonTargets = query.comparisonTargets || [];
    const exactTerms = query.exactTerms || [];
    const filters = query.filters || {};
    switch (query.intent) {
        case "metadata_lookup":
        case "case_lookup":
        case "full_judgment":
            return unique([
                query.caseTarget,
                ...citations,
                ...exactTerms,
                query.normalizedQuery,
            ]).join(" ");
        case "holding_search":
            return unique([
                query.caseTarget,
                ...citations,
                query.normalizedQuery,
                "holding ratio decidendi held concluded",
            ]).join(" ");
        case "comparison":
            return unique([
                ...comparisonTargets,
                ...citations,
                query.normalizedQuery,
            ]).join(" ");
        case "latest_cases":
            return unique([
                ...(filters.jurisdiction || []),
                ...(filters.courts || []),
                ...(filters.subjects || []),
                ...(filters.statutes || []),
                ...(filters.sections || []),
                ...expandOriginJurisdictionTerms(filters.originJurisdiction || []),
                ...expandLowerCourtHints(filters.lowerCourtHints || []),
                query.normalizedQuery,
                "latest recent newest current recent judgment decision",
            ]).join(" ");
        case "issue_search":
        case "follow_up":
        case "unknown":
        default:
            return unique([
                query.caseTarget,
                ...comparisonTargets,
                ...citations,
                ...(filters.courts || []),
                ...(filters.subjects || []),
                ...(filters.statutes || []),
                ...(filters.sections || []),
                ...expandOriginJurisdictionTerms(filters.originJurisdiction || []),
                ...expandLowerCourtHints(filters.lowerCourtHints || []),
                ...buildIssueBoostTerms(query),
                query.normalizedQuery,
            ]).join(" ");
    }
}
//# sourceMappingURL=rewrite.js.map