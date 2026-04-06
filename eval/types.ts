export type EvalCategory =
  | "citation_lookup"
  | "metadata_lookup"
  | "fuzzy_metadata_lookup"
  | "latest_cases"
  | "follow_up"
  | "summary"
  | "comparison"
  | "issue_search"
  | "holding_search"
  | "other";

export type EvalExpectation = {
  expectedIntent?: string;

  topCaseId?: number;
  topCaseIdsAny?: number[];

  topCitationIncludes?: string;
  topCitationIncludesAny?: string[];

  topTitleIncludes?: string;
  topTitleIncludesAny?: string[];

  topCourtIncludes?: string;
  topCourtIncludesAny?: string[];

  topDecisionYearMin?: number;
  topDecisionYearMax?: number;

  minGroupedCases?: number;

  topN?: number;
  topNContainsCaseIdsAny?: number[];

  answerMustContain?: string[];
  answerMustNotContain?: string[];

  maxLatencyMs?: number;
};

export type EvalCase = {
  id: string;
  category: EvalCategory;
  query: string;
  messages?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    caseDigests?: Array<{
      caseId?: number;
      title?: string;
      citation?: string;
      summary?: string;
    }>;
  }>;
  expectation: EvalExpectation;
  notes?: string;
};

export type EvalCaseResult = {
  id: string;
  category: EvalCategory;
  query: string;
  pass: boolean;
  latencyMs: number;
  checks: {
    intent?: boolean;

    topCaseId?: boolean;
    topCaseIdsAny?: boolean;

    topCitationIncludes?: boolean;
    topCitationIncludesAny?: boolean;

    topTitleIncludes?: boolean;
    topTitleIncludesAny?: boolean;

    topCourtIncludes?: boolean;
    topCourtIncludesAny?: boolean;

    topDecisionYearMin?: boolean;
    topDecisionYearMax?: boolean;

    minGroupedCases?: boolean;

    topNContainsCaseIdsAny?: boolean;

    answerMustContain?: boolean;
    answerMustNotContain?: boolean;

    maxLatencyMs?: boolean;
  };
  expected: EvalExpectation;
  actual: {
    intent?: string | null;
    groupedCasesCount: number;
    topCaseId?: number | null;
    topCitation?: string | null;
    topTitle?: string | null;
    topCourt?: string | null;
    topDecisionYear?: number | null;
    answerSummary?: string | null;
    warnings?: string[];
    traceNotes?: string[];
  };
  failureBucket:
    | "none"
    | "router_failure"
    | "retrieval_failure"
    | "ranking_failure"
    | "follow_up_failure"
    | "answer_generation_failure"
    | "latency_issue"
    | "unknown";
};

export type EvalRunReport = {
  runId: string;
  createdAt: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: EvalCaseResult[];
};