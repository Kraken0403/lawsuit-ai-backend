export function toCitation(hit) {
    return {
        caseId: hit.caseId,
        title: hit.title,
        citation: hit.citation,
        chunkId: hit.chunkId,
        paragraphStart: hit.paragraphStart,
        paragraphEnd: hit.paragraphEnd,
    };
}
export function formatCitation(citation) {
    const title = citation.title || `Case ${citation.caseId}`;
    const cite = citation.citation ? `, ${citation.citation}` : "";
    if (citation.paragraphStart != null &&
        citation.paragraphEnd != null &&
        citation.paragraphStart !== citation.paragraphEnd) {
        return `${title}${cite}, paras ${citation.paragraphStart}-${citation.paragraphEnd}`;
    }
    if (citation.paragraphStart != null) {
        return `${title}${cite}, para ${citation.paragraphStart}`;
    }
    return `${title}${cite}`;
}
export function uniqueCitations(citations) {
    const seen = new Set();
    const out = [];
    for (const c of citations) {
        const key = `${c.caseId}|${c.chunkId}|${c.paragraphStart}|${c.paragraphEnd}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(c);
    }
    return out;
}
//# sourceMappingURL=citations.js.map