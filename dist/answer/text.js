export function compactWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}
export function truncate(text, maxLen = 420) {
    const clean = compactWhitespace(text);
    if (clean.length <= maxLen)
        return clean;
    return `${clean.slice(0, maxLen).trimEnd()}...`;
}
export function splitIntoSentences(text) {
    return text
        .split(/(?<=[.?!])\s+/)
        .map((s) => compactWhitespace(s))
        .filter(Boolean);
}
export function firstUsefulSentence(text) {
    const sentences = splitIntoSentences(text);
    for (const s of sentences) {
        if (s.length >= 40)
            return s;
    }
    return truncate(text, 240);
}
export function displayCaseTitle(title) {
    if (!title)
        return "Unknown case";
    return truncate(compactWhitespace(title), 180);
}
//# sourceMappingURL=text.js.map