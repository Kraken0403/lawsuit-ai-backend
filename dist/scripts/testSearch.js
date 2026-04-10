import { orchestrateSearch } from "../orchestrator/searchOrchestrator.js";
async function main() {
    const query = process.argv.slice(2).join(" ").trim();
    if (!query) {
        throw new Error('Usage: npm run test-search -- "your query"');
    }
    const result = await orchestrateSearch({ query });
    console.log("=".repeat(100));
    console.log("CLASSIFIED QUERY");
    console.log("=".repeat(100));
    console.dir(result.query, { depth: null });
    console.log("\n" + "=".repeat(100));
    console.log(`MODE: ${result.mode}`);
    console.log("=".repeat(100));
    console.log("\n" + "=".repeat(100));
    console.log("GROUPED CASES");
    console.log("=".repeat(100));
    for (const [index, group] of result.groupedCases.slice(0, 5).entries()) {
        console.log(`\nCase ${index + 1}`);
        console.log(`caseId     : ${group.caseId}`);
        console.log(`title      : ${group.title}`);
        console.log(`citation   : ${group.citation}`);
        console.log(`bestScore  : ${group.bestScore}`);
        for (const chunk of group.chunks.slice(0, 2)) {
            console.log(`  chunkId=${chunk.chunkId} paras=${chunk.paragraphStart}-${chunk.paragraphEnd}`);
            console.log(`  ${chunk.text.slice(0, 600)}\n`);
        }
    }
    console.log("\n" + "=".repeat(100));
    console.log("EVIDENCE");
    console.log("=".repeat(100));
    for (const ev of result.evidence.slice(0, 8)) {
        console.log(`[caseId=${ev.caseId}] ${ev.chunkId} paras=${ev.paragraphStart}-${ev.paragraphEnd}`);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=testSearch.js.map