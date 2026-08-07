export type AnswerCitation = {
    caseId: number;
    title: string | null;
    citation: string | null;
    chunkId: string;
    paragraphStart: number | null;
    paragraphEnd: number | null;
  };
  
  export type CaseDigest = {
    caseId: number;
    title: string | null;
    citation: string | null;
    summary: string;
    court?: string | null;
    dateOfDecision?: string | null;
    equivalentCitations?: string[];
    citations: AnswerCitation[];
  };
  
  export type ComposedAnswer = {
    answerType:
      | "comparison"
      | "issue_summary"
      | "case_summary"
      | "metadata_lookup"
      | "exact_reference"
      | "full_judgment"
      | "fallback";
    summary: string;
    caseDigests: CaseDigest[];
    citations: AnswerCitation[];
    confidence: number;
    warnings: string[];
  };
