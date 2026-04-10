import { compact } from "./utils.js";
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function normalizePlaceholderKey(value) {
    return compact(value)
        .toLowerCase()
        .replace(/^add\s+/i, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
export function extractUnresolvedPlaceholders(text) {
    const source = String(text || "");
    const found = new Set();
    for (const match of source.matchAll(/\[([^\]\n]{1,120})\]/g)) {
        const raw = compact(match[1]);
        if (!raw)
            continue;
        if (/^add\s+/i.test(raw)) {
            found.add(normalizePlaceholderKey(raw));
        }
    }
    return Array.from(found);
}
export function applyFieldValuesToMarkdown(markdown, values) {
    let result = String(markdown || "");
    for (const [key, rawValue] of Object.entries(values || {})) {
        const value = compact(rawValue);
        if (!value)
            continue;
        const normalizedKey = normalizePlaceholderKey(key);
        const label = normalizedKey.replace(/_/g, " ").toUpperCase();
        const patterns = [
            new RegExp(`\\[ADD\\s+${escapeRegExp(label)}\\]`, "gi"),
            new RegExp(`\\[${escapeRegExp(label)}\\]`, "gi"),
            new RegExp(`\\[ADD\\s+${escapeRegExp(normalizedKey.replace(/_/g, " ")).replace(/\s+/g, "\\s+")}\\]`, "gi"),
        ];
        for (const pattern of patterns) {
            result = result.replace(pattern, value);
        }
    }
    return result;
}
//# sourceMappingURL=placeholders.js.map