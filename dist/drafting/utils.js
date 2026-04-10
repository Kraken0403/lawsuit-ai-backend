export function compact(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}
export function normalizeText(value) {
    return compact(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export function tokenize(value) {
    return normalizeText(value)
        .split(" ")
        .filter((token) => token.length >= 3);
}
export function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const v = compact(value);
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
export function toStringArray(value) {
    if (Array.isArray(value)) {
        return uniqueStrings(value.map((item) => (typeof item === "string" ? item : String(item ?? ""))));
    }
    if (typeof value === "string") {
        const trimmed = compact(value);
        return trimmed ? [trimmed] : [];
    }
    return [];
}
export function overlapRatio(a, b) {
    if (!a.length || !b.length)
        return 0;
    const bSet = new Set(b);
    let matches = 0;
    for (const token of a) {
        if (bSet.has(token))
            matches += 1;
    }
    return matches / Math.max(1, a.length);
}
//# sourceMappingURL=utils.js.map