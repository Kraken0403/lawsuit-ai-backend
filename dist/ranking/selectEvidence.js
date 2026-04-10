export function selectEvidence(groups, maxChunks = 6) {
    const output = [];
    for (const group of groups) {
        for (const chunk of group.chunks) {
            output.push(chunk);
            if (output.length >= maxChunks) {
                return output;
            }
        }
    }
    return output;
}
//# sourceMappingURL=selectEvidence.js.map