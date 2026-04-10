import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreEvalCase } from "../eval/scoring.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const ORCHESTRATOR_IMPORT_CANDIDATES = [
    "../orchestrator/searchOrchestrator.js",
    "../search/searchOrchestrator.js",
    "../searchOrchestrator.js",
];
const COMPOSE_IMPORT_CANDIDATES = [
    "../answer/composeAnswer.js",
    "../answers/composeAnswer.js",
    "../composeAnswer.js",
];
async function importFirst(candidates, exportName, required = true) {
    for (const candidate of candidates) {
        try {
            const href = new URL(candidate, import.meta.url).href;
            const mod = await import(href);
            if (mod && typeof mod[exportName] === "function") {
                return { fn: mod[exportName], source: candidate };
            }
        }
        catch {
            // ignore and continue
        }
    }
    if (!required)
        return { fn: null, source: null };
    throw new Error(`Could not find export "${exportName}". Tried:\n${candidates.join("\n")}\n\nUpdate the candidate paths in src/scripts/runEval.ts.`);
}
function formatMs(ms) {
    return `${ms.toFixed(0)}ms`;
}
function nowRunId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return [
        d.getUTCFullYear(),
        pad(d.getUTCMonth() + 1),
        pad(d.getUTCDate()),
        "-",
        pad(d.getUTCHours()),
        pad(d.getUTCMinutes()),
        pad(d.getUTCSeconds()),
    ].join("");
}
async function loadEvalCases(filepath) {
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error(`Eval file must contain a JSON array: ${filepath}`);
    }
    return parsed;
}
function summarize(report) {
    const bucketCounts = new Map();
    for (const result of report.results) {
        bucketCounts.set(result.failureBucket, (bucketCounts.get(result.failureBucket) || 0) + 1);
    }
    const orderedBuckets = [...bucketCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log("");
    console.log("=== Eval Summary ===");
    console.log(`Run ID   : ${report.runId}`);
    console.log(`Total    : ${report.total}`);
    console.log(`Passed   : ${report.passed}`);
    console.log(`Failed   : ${report.failed}`);
    console.log(`Pass rate: ${(report.passRate * 100).toFixed(1)}%`);
    if (orderedBuckets.length) {
        console.log("");
        console.log("Failure buckets:");
        for (const [bucket, count] of orderedBuckets) {
            console.log(`- ${bucket}: ${count}`);
        }
    }
    const failed = report.results.filter((r) => !r.pass).slice(0, 10);
    if (failed.length) {
        console.log("");
        console.log("Top failing cases:");
        for (const result of failed) {
            console.log(`- ${result.id} | ${result.failureBucket} | ${result.query} | top=${result.actual.topTitle || "NONE"} | latency=${formatMs(result.latencyMs)}`);
        }
    }
}
async function main() {
    const evalFileArg = process.argv[2] || "eval/cases.seed.json";
    const evalFilePath = path.resolve(projectRoot, evalFileArg);
    const { fn: orchestrateSearch, source: orchestratorSource } = await importFirst(ORCHESTRATOR_IMPORT_CANDIDATES, "orchestrateSearch", true);
    const { fn: composeAnswer, source: composeSource } = await importFirst(COMPOSE_IMPORT_CANDIDATES, "composeAnswer", false);
    console.log(`Loaded orchestrateSearch from ${orchestratorSource}`);
    if (composeAnswer) {
        console.log(`Loaded composeAnswer from ${composeSource}`);
    }
    else {
        console.log("composeAnswer not found; running search-only eval");
    }
    const cases = await loadEvalCases(evalFilePath);
    const runId = nowRunId();
    const createdAt = new Date().toISOString();
    const results = [];
    for (const def of cases) {
        const started = Date.now();
        let searchResult = null;
        let answer = null;
        try {
            searchResult = await orchestrateSearch({
                query: def.query,
                messages: def.messages || [],
            });
            if (composeAnswer) {
                answer = await composeAnswer(searchResult);
            }
            const latencyMs = Date.now() - started;
            const scored = scoreEvalCase({
                def,
                searchResult,
                answer,
                latencyMs,
            });
            results.push(scored);
            console.log(`[${scored.pass ? "PASS" : "FAIL"}] ${def.id} | ${def.query} | ${formatMs(latencyMs)} | top=${scored.actual.topTitle || "NONE"}`);
        }
        catch (error) {
            const latencyMs = Date.now() - started;
            results.push({
                id: def.id,
                category: def.category,
                query: def.query,
                pass: false,
                latencyMs,
                checks: {},
                expected: def.expectation,
                actual: {
                    intent: null,
                    groupedCasesCount: 0,
                    topCaseId: null,
                    topCitation: null,
                    topTitle: null,
                    answerSummary: error?.message || "Unhandled eval error",
                    warnings: [],
                    traceNotes: [],
                },
                failureBucket: "unknown",
            });
            console.error(`[ERROR] ${def.id} | ${def.query} | ${error?.message || error}`);
        }
    }
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    const report = {
        runId,
        createdAt,
        total: results.length,
        passed,
        failed,
        passRate: results.length ? passed / results.length : 0,
        results,
    };
    const outputDir = path.resolve(projectRoot, "eval/runs");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.resolve(outputDir, `eval-run-${runId}.json`);
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    summarize(report);
    console.log("");
    console.log(`Saved report: ${path.relative(projectRoot, outputPath)}`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=runEval.js.map