import { compactWhitespace } from "../utils/text.js";
const PREFIX_PATTERNS = [
    /^show full judgment of\s+/i,
    /^show complete judgment of\s+/i,
    /^full judgment of\s+/i,
    /^complete judgment of\s+/i,
    /^show full case text of\s+/i,
    /^case summary of\s+/i,
    /^summary of\s+/i,
    /^brief of\s+/i,
    /^summari[sz]e\s+/i,
    /^explain\s+/i,
    /^give me full case of\s+/i,
    /^give me the full case of\s+/i,
    /^give full case of\s+/i,
    /^full case of\s+/i,
    /^give me case of\s+/i,
    /^give me the case of\s+/i,
    /^show case of\s+/i,
    /^what did the court hold in\s+/i,
    /^what was held in\s+/i,
    /^holding in\s+/i,
    /^holding of\s+/i,
    /^ratio of\s+/i,
    /^ratio decidendi of\s+/i,
];
const SUFFIX_PATTERNS = [
    /\s+case$/i,
    /\s+judgment$/i,
    /\s+judgement$/i,
    /\s+full judgment$/i,
    /\s+complete judgment$/i,
    /\s+full case$/i,
    /\s+complete case$/i,
];
const METADATA_CASE_PATTERNS = [
    /\b(?:citation|court|judges|judge|bench|date of decision|date decided|case number|case no|acts referred|acts|act referred|subject|final decision|advocates|advocate|case type|equivalent citation|equivalent citations)\s+(?:for|of)\s+(.+)$/i,
    /\bwhich court decided\s+(.+)$/i,
    /\bwhat is the citation of\s+(.+)$/i,
    /\bwhat is the court for\s+(.+)$/i,
    /\bgive me the citation and court for\s+(.+)$/i,
    /\bgive me citation and court for\s+(.+)$/i,
    /\bgive the citation and court for\s+(.+)$/i,
];
function normalizeLoose(text) {
    return compactWhitespace(text
        .replace(/[.,"'`?]+/g, " ")
        .replace(/\s+/g, " ")
        .trim());
}
function looksLikeCaseName(text) {
    if (!text)
        return false;
    if (text.split(" ").length > 20)
        return false;
    return (/\bv\/s\b/i.test(text) ||
        /\bvs\.?\b/i.test(text) ||
        /\bversus\b/i.test(text) ||
        /\b\d{4}\s+lawsuit\b/i.test(text) ||
        /\bair\s*\d{4}/i.test(text) ||
        /\b\d{4}\s+scc\s+\d+/i.test(text) ||
        /^[a-z][a-z\s.&,'()-]+$/i.test(text));
}
function rejectTopicalPhrase(text) {
    return /\b(doctrine|evolution|history|development|jurisprudence|principle|constitutional framework|basic structure)\b/i.test(text);
}
export function extractCaseTarget(query) {
    let q = compactWhitespace(query.trim());
    for (const rx of METADATA_CASE_PATTERNS) {
        const match = q.match(rx);
        if (match?.[1]) {
            const candidate = normalizeLoose(match[1]);
            if (candidate && looksLikeCaseName(candidate) && !rejectTopicalPhrase(candidate)) {
                return candidate;
            }
        }
    }
    for (const rx of PREFIX_PATTERNS) {
        q = q.replace(rx, "");
    }
    for (const rx of SUFFIX_PATTERNS) {
        q = q.replace(rx, "");
    }
    q = normalizeLoose(q);
    if (!q)
        return null;
    if (rejectTopicalPhrase(q))
        return null;
    if (!looksLikeCaseName(q))
        return null;
    return q;
}
//# sourceMappingURL=extractCaseTarget.js.map