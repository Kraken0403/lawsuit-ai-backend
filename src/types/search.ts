export type QueryIntent =
  | "hybrid"
  | "case_lookup"
  | "metadata_lookup"
  | "full_judgment"
  | "comparison"
  | "issue_search"
  | "holding_search"
  | "latest_cases"
  | "follow_up"
  | "unknown";

export type MetadataField =
  | "citation"
  | "equivalentCitations"
  | "court"
  | "judges"
  | "dateOfDecision"
  | "caseNo"
  | "actsReferred"
  | "subject"
  | "finalDecision"
  | "advocates"
  | "caseType";

export type QueryStrategy =
  | "metadata_heavy"
  | "balanced"
  | "dense_heavy"
  | "sparse_heavy"
  | "full_judgment"
  | "recency_heavy"
  | "citation_heavy";

export type SearchMode =
  | "metadata"
  | "hybrid"
  | "full_judgment";

export type SearchInput = {
  query: string;
  messages?: ChatTurn[];
  conversationId?: string;
};

export type ChatCaseDigest = {
  caseId?: number;
  title: string;
  citation: string;
  summary: string;
};

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  caseDigests?: ChatCaseDigest[];
};

export type ConversationReferenceType =
  | "none"
  | "ordinal"
  | "deictic"
  | "comparison"
  | "continuation"
  | "implicit";

export type ResolvedReference = {
  referenceType: ConversationReferenceType;
  usedPriorContext: boolean;
  ordinalNumbers: number[];
  resolvedCaseDigests: ChatCaseDigest[];
  notes: string[];
};

export type ConversationState = {
  activeTopic?: string | null;
  activeCaseIds: number[];
  activeCaseTitles: string[];
  activeCitations: string[];
  activeJurisdiction?: string | null;
  activeCourts: string[];
  activeStatutes: string[];
  activeSections: string[];
  activeTimeScope?: string | null;
  lastAnswerType?: string | null;
  lastResultSet: Array<{
    rank: number;
    caseId?: number;
    title: string;
    citation?: string | null;
  }>;
};

export type RetrievalFilters = {
  jurisdiction?: string[];
  courts?: string[];
  statutes?: string[];
  sections?: string[];
  subjects?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  onlyReported?: boolean;

  // new structured signals
  originJurisdiction?: string[];
  lowerCourtHints?: string[];

  // optional normalized/internal fields for future use
  courtIds?: string[];
  decisionYearFrom?: number | null;
  decisionYearTo?: number | null;
};

export type RouterOutput = {
  version: "1.0";
  taskType: QueryIntent;
  userGoal: string;
  isFollowUp: boolean;
  followUpReferenceType: ConversationReferenceType;
  resolvedQuery: string;
  inheritFromState: {
    jurisdiction: boolean;
    court: boolean;
    statute: boolean;
    section: boolean;
    timeScope: boolean;
    resultSet: boolean;
  };
  entities: {
    caseTarget?: string | null;
    comparisonTargets: string[];
    citations: string[];
    metadataField?: MetadataField | null;
    jurisdiction: string[];
    courts: string[];
    statutes: string[];
    sections: string[];
    subjects: string[];
    timeQualifier?: "latest" | "recent" | "historical" | "none";

    // new
    originJurisdiction: string[];
    lowerCourtHints: string[];
  };
  retrievalPlan: {
    strategy: QueryStrategy;
    queryRewrites: string[];
    filters: RetrievalFilters;
    topK: number;
    rerankTopN: number;
    expandFullCase: boolean;
  };
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
  confidence: number;
  reasons: string[];
};

export type SearchPlan = {
  originalQuery: string;
  normalizedQuery: string;
  effectiveQuery: string;
  router: RouterOutput;
  state: ConversationState;
  resolvedReference: ResolvedReference;
};

export type ClassifiedQuery = {
  originalQuery: string;
  normalizedQuery: string;
  intent: QueryIntent;
  confidence: number;
  exactTerms: string[];
  citations: string[];
  caseHints: string[];
  caseTarget?: string | null;
  metadataField?: MetadataField | null;
  referenceTerms: string[];
  comparisonTargets: string[];
  followUpLikely: boolean;
  strategy: QueryStrategy;
  reasons: string[];
  filters?: RetrievalFilters;
};

export type RawChunkHit = {
  id: string | number;
  score: number;
  caseId: number;
  chunkId: string;
  title: string | null;
  citation: string | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  text: string;
  payload: Record<string, unknown>;
};

export type CaseGroup = {
  caseId: number;
  title: string | null;
  citation: string | null;
  bestScore: number;
  chunks: RawChunkHit[];
};

export type SearchTrace = {
  originalQuery: string;
  effectiveQuery: string;
  router?: RouterOutput;
  classifiedFallback?: ClassifiedQuery;
  resolvedReference?: ResolvedReference;
  filtersApplied?: RetrievalFilters;
  notes: string[];
};

export type OrchestratedSearchResult = {
  query: ClassifiedQuery;
  mode: SearchMode;
  groupedCases: CaseGroup[];
  evidence: RawChunkHit[];
  trace?: SearchTrace;
};
