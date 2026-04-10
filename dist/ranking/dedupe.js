export function dedupeChunks(hits) {
    const seen = new Set();
    const output = [];
    for (const hit of hits) {
        const key = `${hit.caseId}:${hit.chunkId}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(hit);
    }
    return output;
}
//# sourceMappingURL=dedupe.js.map