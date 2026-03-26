import { orchestrateSearch } from "../orchestrator/searchOrchestrator.js";
import { composeAnswer } from "../answer/composeAnswer_old.js";
import { formatCitation } from "../answer/citations.js";

async function main() {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    console.error('Usage: npm run test-answer -- "your query here"');
    process.exit(1);
  }

  const searchResult = await orchestrateSearch({ query });
  const answer = await composeAnswer(searchResult);

  console.log("\n" + "=".repeat(100));
  console.log("COMPOSED ANSWER");
  console.log("=".repeat(100));
  console.dir(
    {
      answerType: answer.answerType,
      confidence: answer.confidence,
      warnings: answer.warnings,
    },
    { depth: null }
  );

  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log(answer.summary);

  console.log("\n" + "=".repeat(100));
  console.log("CASE DIGESTS");
  console.log("=".repeat(100));

  answer.caseDigests.forEach((digest, idx) => {
    console.log(`\nCase ${idx + 1}`);
    console.log(`caseId   : ${digest.caseId}`);
    console.log(`title    : ${digest.title}`);
    console.log(`citation : ${digest.citation}`);
    console.log(`summary  : ${digest.summary}`);

    if (digest.citations.length) {
      console.log("citations:");
      for (const c of digest.citations) {
        console.log(`  - ${formatCitation(c)}`);
      }
    }
  });

  console.log("\n" + "=".repeat(100));
  console.log("TOP CITATIONS");
  console.log("=".repeat(100));
  for (const c of answer.citations) {
    console.log(formatCitation(c));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});