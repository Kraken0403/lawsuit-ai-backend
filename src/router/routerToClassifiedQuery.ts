import type {
    ClassifiedQuery,
    RouterOutput,
  } from "../types/search.js";
  import { normalizeQuery } from "../query/normalize.js";
  
  function unique(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
  
    for (const value of values) {
      const v = String(value || "").trim();
      if (!v) continue;
      if (seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
    }
  
    return out;
  }
  
  function buildExactTerms(router: RouterOutput): string[] {
    return unique([
      router.entities.caseTarget,
      ...router.entities.citations,
      ...router.entities.comparisonTargets,
    ]);
  }
  
  function buildReferenceTerms(router: RouterOutput): string[] {
  return unique([
    router.resolvedQuery,
    router.entities.caseTarget,
    ...router.entities.comparisonTargets,
    ...router.entities.citations,
    ...router.entities.statutes,
    ...router.entities.sections,
    ...router.entities.subjects,
    ...router.entities.jurisdiction,
    ...router.entities.courts,
    ...router.entities.originJurisdiction,
    ...router.entities.lowerCourtHints,
  ]);
}
  
  export function routerToClassifiedQuery(params: {
    originalQuery: string;
    router: RouterOutput;
  }): ClassifiedQuery {
    const { originalQuery, router } = params;
    const normalizedQuery = normalizeQuery(router.resolvedQuery || originalQuery);
  
    return {
      originalQuery,
      normalizedQuery,
      intent: router.taskType,
      confidence: router.confidence,
      exactTerms: buildExactTerms(router),
      citations: router.entities.citations,
      caseHints: unique([
        router.entities.caseTarget,
        ...router.entities.comparisonTargets,
      ]),
      caseTarget: router.entities.caseTarget || null,
      metadataField: router.entities.metadataField || null,
      referenceTerms: buildReferenceTerms(router),
      comparisonTargets: router.entities.comparisonTargets,
      followUpLikely: router.isFollowUp,
      strategy: router.retrievalPlan.strategy,
      reasons: router.reasons,
      filters: router.retrievalPlan.filters,
    };
  }