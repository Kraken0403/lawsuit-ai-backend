import { compactWhitespace } from "../utils/text.js";
function cleanPart(text) {
    return compactWhitespace(text
        .replace(/^compare\s+/i, "")
        .replace(/\bon\b.*$/i, "")
        .replace(/\bwith\b.*$/i, "")
        .trim());
}
function looksLikeCaseFragment(text) {
    if (!text)
        return false;
    if (text.split(" ").length > 12)
        return false;
    return (/\bv\/s\b/i.test(text) ||
        /\bvs\.?\b/i.test(text) ||
        /\bversus\b/i.test(text) ||
        /^[a-z][a-z\s.&,'()-]+$/i.test(text));
}
export function extractComparisonTargets(query) {
    const normalized = compactWhitespace(query);
    if (!/\bcompare\b/i.test(normalized) && !/\bdifference between\b/i.test(normalized)) {
        return [];
    }
    const stripped = normalized
        .replace(/^compare\s+/i, "")
        .replace(/^difference between\s+/i, "")
        .trim();
    const parts = stripped.split(/\s+\band\b\s+|,/i).map(cleanPart).filter(Boolean);
    const targets = parts.filter(looksLikeCaseFragment);
    return [...new Set(targets)].slice(0, 4);
}
//# sourceMappingURL=extractComparisonTargets.js.map