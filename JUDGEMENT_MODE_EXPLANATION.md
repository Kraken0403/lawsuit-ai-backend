**Overview**
- **Purpose**: Explain how the system answers legal queries ("judgement mode").

**High-level architecture**
- **LLM and embeddings**: Uses hosted APIs (OpenAI). See [be/src/config/env.ts](be/src/config/env.ts#L1) and [be/src/embeddings/embed.ts](be/src/embeddings/embed.ts#L1).
- **Vector store / retrieval**: Qdrant is the vector DB used for dense + sparse hybrid retrieval. Client config: [be/src/qdrant/client.ts](be/src/qdrant/client.ts#L1).
- **Orchestration**: Query classification, hybrid retrieval, grouping, re-ranking and final answer composition are orchestrated by [be/src/orchestrator/searchOrchestrator.ts](be/src/orchestrator/searchOrchestrator.ts#L1) and the answer builder [be/src/answer/composeAnswer.js](be/src/answer/composeAnswer.js#L1).

**Data sources**
- Primary retrieval data is pre-indexed legal text (split into "chunks") stored in Qdrant. Payloads include metadata like `caseId`, `chunkId`, `title`, `citation`, `court`, etc. See Qdrant payload filtering logic in [be/src/qdrant/payloadFilters.ts](be/src/qdrant/payloadFilters.ts#L1).
- Additional data used at runtime includes user session uploads (draft attachments) stored via Prisma (`draftAttachment`) and templates (`draftTemplate`), used mainly by drafting. See attachment loader: [be/src/drafting/loadAttachments.ts](be/src/drafting/loadAttachments.ts#L1) and template DB search: [be/src/drafting/templateSearch.ts](be/src/drafting/templateSearch.ts#L1).

**How LLMs are used (training / models)**
- There is no in-repo model training. The code calls hosted LLM and embedding endpoints (OpenAI-compatible). Models and API keys are provided by environment variables (`EMBEDDING_API_KEY`, `OPENAI_API_KEY`, etc.). See [be/src/config/env.ts](be/src/config/env.ts#L1).
- For generation, the code uses the OpenAI Responses API (`responses.create`) via their SDK in drafting and constructs requests directly for embeddings in [be/src/embeddings/embed.ts](be/src/embeddings/embed.ts#L1).

**Preprocessing & ingestion (summary)**
- Ingestion into the vector DB is not performed by the request-time code paths shown — indexing is done offline by ingestion scripts or data pipelines (not included or located elsewhere). The runtime code assumes point documents (chunks) already exist in Qdrant with structured payloads.
- Uploaded session attachments and templates are stored in Prisma (database). Attachments include `extractedText` and optional `parsedJson` used as direct template candidates ([be/src/drafting/loadAttachments.ts](be/src/drafting/loadAttachments.ts#L1)).

**Embedding / encoding**
- Queries are encoded with `embedQuery(text)` which POSTs to the embeddings endpoint (`/embeddings`) with configured model ([be/src/embeddings/embed.ts](be/src/embeddings/embed.ts#L1)).
- Dense retrieval uses those vectors; sparse retrieval uses BM25-like text indexing via Qdrant (`Qdrant/bm25`) performed within hybrid query prefetch in [be/src/qdrant/hybridSearch.ts](be/src/qdrant/hybridSearch.ts#L1).

**Retrieval architecture (hybrid)**
- `runHybridSearch()` constructs a multi-stage query:
  - A sparse (text) prefetch using `Qdrant/bm25` over a hybrid text built from the query ([be/src/qdrant/hybridSearch.ts](be/src/qdrant/hybridSearch.ts#L1)).
  - A dense prefetch using the embedding vector from `embedQuery()` unless the query strategy disables dense search.
  - Fusion/combination of sparse+dense results via Qdrant `fusion: "rrf"` and returning top points with payloads.
- After Qdrant returns points, each hit is converted to an internal `RawChunkHit` and re-scored via `postScoreHit()` which applies many heuristics (citation matches, title strength, court/jurisdiction filters, recency boosts, issue-specific boosts, etc.). See scoring logic in [be/src/qdrant/hybridSearch.ts](be/src/qdrant/hybridSearch.ts#L1).

**Post-retrieval processing & answer composition**
- Hits are deduped and grouped into case groups (`groupHitsByCase`) and ranked (group-level signals, see [be/src/orchestrator/searchOrchestrator.ts](be/src/orchestrator/searchOrchestrator.ts#L1)).
- Case reconstruction helpers can fetch preview chunks or all chunks for a case (see `fetchPreviewChunksForCase` / `fetchAllChunksForCase` uses in the orchestrator). Grouping and evidence selection is in `ranking/*` modules referenced by the orchestrator.
- The final answer type is chosen in `composeAnswer.js` which supports metadata lookups, full judgment reconstruction, or hybrid answers with summaries and citations ([be/src/answer/composeAnswer.js](be/src/answer/composeAnswer.js#L1)).

**Judgement-mode request flow (step-by-step)**
- 1) Incoming user query enters route handling (e.g., the chat stream route). See [be/src/routes/chatStream.ts](be/src/routes/chatStream.ts#L1).
- 2) `searchOrchestrator` classifies the query (`classifyQuery`) into intents like `issue_search`, `case_lookup`, `full_judgment`, `metadata_lookup` and picks a retrieval strategy.
- 3) The orchestrator calls `runHybridSearch()` (dense + sparse) and `runMetadataSearch()` as applicable.
- 4) Results are post-scored, deduped, grouped by `caseId`, and re-ranked considering query targets, citations, recency, and other heuristics.
- 5) `composeAnswer` builds a final response object with `answerType`, `summary`, `caseDigests`, `citations`, `confidence` and `warnings`.
- 6) If LLM summarization is required (e.g., to synthesize answers), the code calls the configured LLM (OpenAI) to generate text.

**Where to look next in code**
- Query orchestration: [be/src/orchestrator/searchOrchestrator.ts](be/src/orchestrator/searchOrchestrator.ts#L1)
- Hybrid retrieval and scoring: [be/src/qdrant/hybridSearch.ts](be/src/qdrant/hybridSearch.ts#L1)
- Embeddings: [be/src/embeddings/embed.ts](be/src/embeddings/embed.ts#L1)
- Qdrant client config: [be/src/qdrant/client.ts](be/src/qdrant/client.ts#L1)
- Answer composition: [be/src/answer/composeAnswer.js](be/src/answer/composeAnswer.js#L1)

**Notes & caveats**
- The code uses heuristics heavily for scoring and decision-making — not model training.
- Indexing / ingestion pipelines (document splitting, embedding generation, point insertion to Qdrant) are not present in request-time modules and likely live in separate scripts or ETL jobs outside these files.

