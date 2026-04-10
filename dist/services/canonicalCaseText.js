import { createHash } from "node:crypto";
function normalizeWhitespace(text) {
    return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}
function findSuffixPrefixOverlap(a, b, minOverlap = 120) {
    const max = Math.min(a.length, b.length, 8000);
    for (let len = max; len >= minOverlap; len -= 1) {
        if (a.slice(-len) === b.slice(0, len)) {
            return len;
        }
    }
    return 0;
}
export function buildCanonicalCaseTextFromQdrant(fullCase) {
    const orderedChunks = [...fullCase.chunks].sort((a, b) => {
        const aIdx = a.chunkIndex ?? Number.MAX_SAFE_INTEGER;
        const bIdx = b.chunkIndex ?? Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx)
            return aIdx - bIdx;
        const aStart = a.paragraphStart ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.paragraphStart ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart)
            return aStart - bStart;
        const aEnd = a.paragraphEnd ?? Number.MAX_SAFE_INTEGER;
        const bEnd = b.paragraphEnd ?? Number.MAX_SAFE_INTEGER;
        return aEnd - bEnd;
    });
    let merged = "";
    const seenExactChunks = new Set();
    for (const chunk of orderedChunks) {
        const text = normalizeWhitespace(chunk.text || "");
        if (!text)
            continue;
        if (seenExactChunks.has(text)) {
            continue;
        }
        seenExactChunks.add(text);
        if (!merged) {
            merged = text;
            continue;
        }
        if (merged.includes(text)) {
            continue;
        }
        const overlap = findSuffixPrefixOverlap(merged, text, 120);
        if (overlap > 0) {
            merged += text.slice(overlap);
        }
        else {
            merged += `\n\n${text}`;
        }
    }
    const sourceHash = createHash("sha256").update(merged).digest("hex");
    return {
        caseId: fullCase.caseId,
        fileName: fullCase.fileName,
        title: fullCase.title,
        citation: fullCase.citation,
        text: merged,
        sourceHash,
    };
}
//# sourceMappingURL=canonicalCaseText.js.map