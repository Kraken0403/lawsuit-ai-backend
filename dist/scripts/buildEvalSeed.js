import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
function slug(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
const courts = [
    {
        name: "Supreme Court",
        courtExpectation: "Supreme Court",
        latestYearMin: 2022,
        subjects: ["bail", "murder", "arbitration", "service law"],
    },
    {
        name: "Delhi High Court",
        courtExpectation: "Delhi",
        latestYearMin: 2021,
        subjects: ["bail", "arbitration", "service law", "contract dispute"],
    },
    {
        name: "Gujarat High Court",
        courtExpectation: "Gujarat",
        latestYearMin: 2023,
        subjects: ["bail", "murder", "service law", "land acquisition"],
    },
    {
        name: "Karnataka High Court",
        courtExpectation: "Karnataka",
        latestYearMin: 2021,
        subjects: ["bail", "service law", "civil procedure", "judicial misconduct"],
    },
    {
        name: "Bombay High Court",
        courtExpectation: "Bombay",
        latestYearMin: 2021,
        subjects: ["bail", "arbitration", "service law", "company law"],
    },
];
const goldCases = [
    {
        id: "citation_exact_sc_1950_lawsuit_47",
        category: "citation_lookup",
        query: "1950 LawSuit(SC) 47",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 100001,
            topCitationIncludes: "1950",
            topTitleIncludes: "Janardhan Reddy",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_del_2022_182",
        category: "citation_lookup",
        query: "2022 LawSuit(Del) 182",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 299798,
            topCitationIncludes: "2022",
            topTitleIncludes: "Kanodia Technoplast",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "metadata_date_del_2022_182",
        category: "metadata_lookup",
        query: "date of decision of 2022 LawSuit(Del) 182",
        expectation: {
            expectedIntent: "metadata_lookup",
            topCaseId: 299798,
            topCitationIncludes: "2022 LawSuit(Del) 182",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "metadata_court_del_2022_182",
        category: "metadata_lookup",
        query: "court of 2022 LawSuit(Del) 182",
        expectation: {
            expectedIntent: "metadata_lookup",
            topCaseId: 299798,
            topCourtIncludes: "Delhi",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "metadata_judges_sc_1950_47",
        category: "metadata_lookup",
        query: "judges in 1950 LawSuit(SC) 47",
        expectation: {
            expectedIntent: "metadata_lookup",
            topCaseId: 100001,
            topCourtIncludes: "Supreme Court",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_del_2021_1806",
        category: "citation_lookup",
        query: "2021 LawSuit(Del) 1806",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 299148,
            topTitleIncludes: "Vivek Slaria",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_del_2021_1598",
        category: "citation_lookup",
        query: "2021 LawSuit(Del) 1598",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 298938,
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_del_2021_614",
        category: "citation_lookup",
        query: "2021 LawSuit(Del) 614",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 297772,
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_del_2021_508",
        category: "citation_lookup",
        query: "2021 LawSuit(Del) 508",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 297659,
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_guj_2024_1930",
        category: "citation_lookup",
        query: "2024 LawSuit(Guj) 1930",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 467615,
            topCourtIncludes: "Gujarat",
            maxLatencyMs: 15000,
        },
    },
    {
        id: "citation_exact_guj_2026_570",
        category: "citation_lookup",
        query: "2026 LawSuit(Guj) 570",
        expectation: {
            expectedIntent: "case_lookup",
            topCaseId: 472761,
            topCourtIncludes: "Gujarat",
            topDecisionYearMin: 2026,
            maxLatencyMs: 15000,
        },
    },
    {
        id: "latest_arbitration_delhi",
        category: "latest_cases",
        query: "latest arbitration cases in Delhi High Court",
        expectation: {
            expectedIntent: "latest_cases",
            topCourtIncludes: "Delhi",
            topDecisionYearMin: 2021,
            minGroupedCases: 2,
            topNContainsCaseIdsAny: [299798, 299148, 298938, 297772, 297659],
            topN: 5,
            maxLatencyMs: 20000,
        },
    },
    {
        id: "recent_bail_gujarat",
        category: "latest_cases",
        query: "recent bail cases in Gujarat High Court",
        expectation: {
            expectedIntent: "latest_cases",
            topCourtIncludes: "Gujarat",
            topDecisionYearMin: 2023,
            minGroupedCases: 2,
            topNContainsCaseIdsAny: [470170, 467615, 466559, 465798, 464397],
            topN: 5,
            maxLatencyMs: 20000,
        },
    },
    {
        id: "year_2026_bail_gujarat",
        category: "issue_search",
        query: "year 2026+ bail cases in Gujarat High Court",
        expectation: {
            expectedIntent: "issue_search",
            topCourtIncludes: "Gujarat",
            topDecisionYearMin: 2026,
            minGroupedCases: 2,
            topNContainsCaseIdsAny: [472761, 472371, 472770, 472774, 472224],
            topN: 5,
            maxLatencyMs: 20000,
        },
    },
    {
        id: "followup_summarize_first_gujarat_murder",
        category: "follow_up",
        query: "summarize the first case",
        messages: [
            {
                role: "user",
                content: "Latest murder cases in Gujarat",
            },
            {
                role: "assistant",
                content: "The newest visible Gujarat murder decision in the supplied evidence is Raval Shaileshbhai Rameshbhai Virchandbhai v. State of Gujarat, followed by Pintubhai @ Kaliyo Dolubhai Vasava v. State of Gujarat and Raju @ Rajubhai Haribhai Gohel v. State of Gujarat.",
                caseDigests: [
                    {
                        caseId: 472507,
                        title: "RAVAL SHAILESHBHAI RAMESHBHAI VIRCHANDBHAI V/S STATE OF GUJARAT",
                        citation: "2026 LawSuit(Guj) 327",
                        summary: "Fatal stabbing case after quarrel.",
                    },
                    {
                        caseId: 472490,
                        title: "PINTUBHAI @ KALIO DOLUBHAI VASAVA V/S STATE OF GUJARAT",
                        citation: "2026 LawSuit(Guj) 310",
                        summary: "Conviction under Sections 302/114 IPC.",
                    },
                    {
                        caseId: 471813,
                        title: "RAJU @ RAJUBHAI HARIBHAI GOHEL V/S STATE OF GUJARAT",
                        citation: "2025 LawSuit(Guj) 3107",
                        summary: "Rajkot murder dispute.",
                    },
                ],
            },
        ],
        expectation: {
            topCaseId: 472507,
            topCitationIncludes: "2026 LawSuit(Guj) 327",
            maxLatencyMs: 20000,
        },
    },
    {
        id: "followup_citation_first_gujarat_murder",
        category: "follow_up",
        query: "what is the citation of the first case",
        messages: [
            {
                role: "user",
                content: "Latest murder cases in Gujarat",
            },
            {
                role: "assistant",
                content: "The newest visible Gujarat murder decision in the supplied evidence is Raval Shaileshbhai Rameshbhai Virchandbhai v. State of Gujarat, followed by Pintubhai @ Kaliyo Dolubhai Vasava v. State of Gujarat and Raju @ Rajubhai Haribhai Gohel v. State of Gujarat.",
                caseDigests: [
                    {
                        caseId: 472507,
                        title: "RAVAL SHAILESHBHAI RAMESHBHAI VIRCHANDBHAI V/S STATE OF GUJARAT",
                        citation: "2026 LawSuit(Guj) 327",
                        summary: "Fatal stabbing case after quarrel.",
                    },
                    {
                        caseId: 472490,
                        title: "PINTUBHAI @ KALIO DOLUBHAI VASAVA V/S STATE OF GUJARAT",
                        citation: "2026 LawSuit(Guj) 310",
                        summary: "Conviction under Sections 302/114 IPC.",
                    },
                ],
            },
        ],
        expectation: {
            topCaseId: 472507,
            topCitationIncludes: "2026 LawSuit(Guj) 327",
            maxLatencyMs: 20000,
        },
    },
];
function buildLatestSmokeCases() {
    const out = [];
    for (const court of courts) {
        for (const subject of court.subjects) {
            out.push({
                id: `latest_${slug(subject)}_${slug(court.name)}`,
                category: "latest_cases",
                query: `latest ${subject} cases in ${court.name}`,
                expectation: {
                    expectedIntent: "latest_cases",
                    topCourtIncludes: court.courtExpectation,
                    topDecisionYearMin: court.latestYearMin,
                    minGroupedCases: 1,
                    maxLatencyMs: 20000,
                },
            });
            out.push({
                id: `recent_${slug(subject)}_${slug(court.name)}`,
                category: "latest_cases",
                query: `recent ${subject} cases in ${court.name}`,
                expectation: {
                    expectedIntent: "latest_cases",
                    topCourtIncludes: court.courtExpectation,
                    topDecisionYearMin: court.latestYearMin,
                    minGroupedCases: 1,
                    maxLatencyMs: 20000,
                },
            });
        }
    }
    return out;
}
function buildDateSmokeCases() {
    const out = [];
    for (const court of courts) {
        for (const subject of court.subjects.slice(0, 3)) {
            out.push({
                id: `from_2024_${slug(subject)}_${slug(court.name)}`,
                category: "issue_search",
                query: `${subject} cases in ${court.name} from 2024 onward`,
                expectation: {
                    expectedIntent: "issue_search",
                    topCourtIncludes: court.courtExpectation,
                    topDecisionYearMin: 2024,
                    minGroupedCases: 1,
                    maxLatencyMs: 20000,
                },
            });
            out.push({
                id: `year_2025_plus_${slug(subject)}_${slug(court.name)}`,
                category: "issue_search",
                query: `year 2025+ ${subject} cases in ${court.name}`,
                expectation: {
                    expectedIntent: "issue_search",
                    topCourtIncludes: court.courtExpectation,
                    topDecisionYearMin: 2025,
                    minGroupedCases: 1,
                    maxLatencyMs: 20000,
                },
            });
        }
    }
    return out;
}
function buildIssueSmokeCases() {
    return [
        {
            id: "issue_fake_citation_karnataka",
            category: "issue_search",
            query: "Judgements on Karnataka High Court orders actions against a civil court for citing non-existant supreme court judgement",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Karnataka",
                minGroupedCases: 1,
                maxLatencyMs: 25000,
            },
            notes: "Hard case. Court filter must hold even if ranking is still imperfect.",
        },
        {
            id: "issue_fake_citation_karnataka_rewrite_1",
            category: "issue_search",
            query: "Karnataka High Court civil judge cited non-existent Supreme Court judgment",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Karnataka",
                minGroupedCases: 1,
                maxLatencyMs: 25000,
            },
        },
        {
            id: "issue_fake_citation_karnataka_rewrite_2",
            category: "issue_search",
            query: "Karnataka High Court strictures against trial court for fabricated Supreme Court citation",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Karnataka",
                minGroupedCases: 1,
                maxLatencyMs: 25000,
            },
        },
        {
            id: "issue_arbitration_seat_delhi",
            category: "issue_search",
            query: "Delhi High Court cases on seat versus venue in arbitration",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Delhi",
                minGroupedCases: 1,
                maxLatencyMs: 20000,
            },
        },
        {
            id: "issue_bail_delay_gujarat",
            category: "issue_search",
            query: "Gujarat High Court cases where delay in trial was considered for bail",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Gujarat",
                minGroupedCases: 1,
                maxLatencyMs: 20000,
            },
        },
        {
            id: "issue_service_law_karnataka",
            category: "issue_search",
            query: "Karnataka High Court judgments on disciplinary proceedings and service law",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Karnataka",
                minGroupedCases: 1,
                maxLatencyMs: 20000,
            },
        },
        {
            id: "issue_contract_arbitration_bombay",
            category: "issue_search",
            query: "Bombay High Court judgments on arbitration clause and contract dispute",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Bombay",
                minGroupedCases: 1,
                maxLatencyMs: 20000,
            },
        },
        {
            id: "issue_murder_circumstantial_sc",
            category: "issue_search",
            query: "Supreme Court murder conviction based on circumstantial evidence",
            expectation: {
                expectedIntent: "issue_search",
                topCourtIncludes: "Supreme Court",
                minGroupedCases: 1,
                maxLatencyMs: 20000,
            },
        },
    ];
}
function buildComparisonCases() {
    return [
        {
            id: "comparison_named_basic_structure",
            category: "comparison",
            query: "compare Kesavananda Bharati and Minerva Mills",
            expectation: {
                expectedIntent: "comparison",
                minGroupedCases: 2,
                maxLatencyMs: 25000,
            },
        },
        {
            id: "comparison_named_arbitration",
            category: "comparison",
            query: "compare Indus Mobile and BGS SGS on seat of arbitration",
            expectation: {
                expectedIntent: "comparison",
                minGroupedCases: 2,
                maxLatencyMs: 25000,
            },
        },
    ];
}
function buildFollowUpCases() {
    const delhiAssistantMessage = {
        role: "assistant",
        content: "The newest visible Delhi arbitration cases include M/S Kanodia Technoplast Limited v. M/S A P Trading Company, Vivek Slaria v. Neeraj Tyagi, and S P Singla Constructions Private Limited v. Construction and Design Services.",
        caseDigests: [
            {
                caseId: 299798,
                title: "M/S KANODIA TECHNOPLAST LIMITED V/S M/S A P TRADING COMPANY",
                citation: "2022 LawSuit(Del) 182",
                summary: "Sole arbitrator appointed; DIAC arbitration directed.",
            },
            {
                caseId: 299148,
                title: "VIVEK SLARIA V/S NEERAJ TYAGI",
                citation: "2021 LawSuit(Del) 1806",
                summary: "Arbitrator appointment and DIAC directions.",
            },
            {
                caseId: 298938,
                title: "S P SINGLA CONSTRUCTIONS PRIVATE LIMITED V/S CONSTRUCTION AND DESIGN SERVICES, UTTAR PRADESH JAL NIGAM",
                citation: "2021 LawSuit(Del) 1598",
                summary: "Seat versus venue and arbitration jurisdiction discussion.",
            },
        ],
    };
    return [
        {
            id: "followup_delhi_arbitration_first_case_summary",
            category: "follow_up",
            query: "summarize the first case",
            messages: [
                { role: "user", content: "latest arbitration cases in Delhi High Court" },
                delhiAssistantMessage,
            ],
            expectation: {
                topCaseId: 299798,
                topCitationIncludes: "2022 LawSuit(Del) 182",
                maxLatencyMs: 20000,
            },
        },
        {
            id: "followup_delhi_arbitration_first_case_citation",
            category: "follow_up",
            query: "what is the citation of the first case",
            messages: [
                { role: "user", content: "latest arbitration cases in Delhi High Court" },
                delhiAssistantMessage,
            ],
            expectation: {
                topCaseId: 299798,
                topCitationIncludes: "2022 LawSuit(Del) 182",
                maxLatencyMs: 20000,
            },
        },
        {
            id: "followup_delhi_arbitration_compare_first_second",
            category: "comparison",
            query: "compare the first case and second case",
            messages: [
                { role: "user", content: "latest arbitration cases in Delhi High Court" },
                delhiAssistantMessage,
            ],
            expectation: {
                minGroupedCases: 2,
                topNContainsCaseIdsAny: [299798, 299148],
                topN: 3,
                maxLatencyMs: 25000,
            },
        },
    ];
}
async function main() {
    const latestSmoke = buildLatestSmokeCases();
    const dateSmoke = buildDateSmokeCases();
    const issueSmoke = buildIssueSmokeCases();
    const comparisons = buildComparisonCases();
    const followUps = buildFollowUpCases();
    const seed = [
        ...goldCases,
        ...latestSmoke,
        ...dateSmoke,
        ...issueSmoke,
        ...comparisons,
        ...followUps,
    ];
    const deduped = new Map();
    for (const item of seed) {
        deduped.set(item.id, item);
    }
    const finalSeed = [...deduped.values()];
    const outputPath = path.resolve(projectRoot, "eval/cases.seed.json");
    await fs.writeFile(outputPath, JSON.stringify(finalSeed, null, 2), "utf8");
    console.log(`Wrote ${finalSeed.length} eval cases to eval/cases.seed.json`);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=buildEvalSeed.js.map