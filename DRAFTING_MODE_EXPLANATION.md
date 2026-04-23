**Overview**
- **Purpose**: Explain how the system creates legal drafts and templates ("drafting mode").

**High-level architecture (drafting)**
- Drafting is driven by a router + planner that picks a drafting strategy (use uploaded format, match a stored template, or generate fresh text with LLM). See: [be/src/drafting/orchestrateDrafting.ts](be/src/drafting/orchestrateDrafting.ts#L1).
- The drafting generation uses the hosted LLM (OpenAI Responses API) when available; otherwise a local fallback scaffold is used. See generator: [be/src/drafting/generateDraft.ts](be/src/drafting/generateDraft.ts#L1).
- Template search and session-upload attachments are stored in Prisma and retrieved by template search and attachment loaders: [be/src/drafting/templateSearch.ts](be/src/drafting/templateSearch.ts#L1) and [be/src/drafting/loadAttachments.ts](be/src/drafting/loadAttachments.ts#L1).

**Data used for drafting**
- Sources include:
  - **System / firm templates** stored in DB (`draftTemplate` via Prisma) — searchable by `searchDraftTemplates`.
  - **Session uploads / attachments** stored with `extractedText` and optional `parsedJson` (these can be used directly as template candidates). Loader: [be/src/drafting/loadAttachments.ts](be/src/drafting/loadAttachments.ts#L1).
  - **Conversation context**: recent chat messages are included to preserve continuity.

**Preprocessing & template matching**
- Templates and attachments are normalized (`normalizedText`) and scored against the resolved user brief using simple lexical heuristics and token overlap in `searchDraftTemplates` ([be/src/drafting/templateSearch.ts](be/src/drafting/templateSearch.ts#L1)).
- Attachments are converted into in-memory template candidates by `buildAttachmentTemplateCandidates` (scoring favors direct-use requests) in [be/src/drafting/loadAttachments.ts](be/src/drafting/loadAttachments.ts#L1).

**Draft planning & decision logic**
- `routeDraftingQuery()` (in `router.ts`) collects:
  - heuristic family (notice, contract, petition, etc.), tone, and whether the user asked to use attached format;
  - router state from `resolveDraftingRouterState` (LLM-based router) which can normalize the brief and lock family/subtype;
  - template candidates from DB and attachments; then chooses `strategy` and `matchLevel` (`exact`, `adjacent`, `none`). See [be/src/drafting/router.ts](be/src/drafting/router.ts#L1).
- Required fields are inferred from template placeholders or generic family fields. If clarifying questions are required, the system returns `drafting_questions` with structured prompts built by `questionnaire.ts`.

**Draft generation & LLM prompts**
- If LLM access is available the system builds a careful prompt with:
  - System instructions locking document family and style,
  - Resolved brief, extracted facts, prior chat context,
  - Primary template scaffold (if matched) and unresolved placeholders,
  - Secondary template references.
- The call to OpenAI Responses API is in [be/src/drafting/generateDraft.ts](be/src/drafting/generateDraft.ts#L1). If the LLM is unavailable, a fallback scaffold generator constructs a best-effort draft from available facts.

**Placeholders, attachments & materialization**
- Templates are materialized into scaffolds and placeholders are detected; unresolved placeholders are preserved and returned for follow-up.
- The function `materializeTemplateCandidate` (referenced in `generateDraft.ts`) prepares the scaffold passed to the LLM.

**Where drafting intersects retrieval / embeddings**
- Drafting may use precedent templates stored locally; it does not call the Qdrant retrieval path for legal judgments except when the flow explicitly requests precedent comparison.
- Attachments are used as first-class template sources (session uploads are preferred when user requests direct use).

**Drafting-mode request flow (step-by-step)**
- 1) `orchestrateDrafting()` is called from request handlers with `userId`, `query`, optional `messages`, and `attachmentIds`.
- 2) Attachments are loaded from DB (`loadDraftAttachments`) and turned into template candidates.
- 3) `routeDraftingQuery()` resolves router state (LLM helper), searches templates, combines attachment candidates, infers family/tone, and selects `plan`.
- 4) If `plan.shouldAskClarifyingQuestions` is true, return structured clarifying questions.
- 5) Otherwise, `generateDraftFromPlan()` composes a prompt and calls the LLM to create the draft (or falls back to scaffold builder).
- 6) The result is returned as `drafting_draft` with `summary`, `sources`, `confidence` and the `plan` (for traceability).

**Where to look in code**
- Draft orchestration: [be/src/drafting/orchestrateDrafting.ts](be/src/drafting/orchestrateDrafting.ts#L1)
- Draft generation & LLM prompt: [be/src/drafting/generateDraft.ts](be/src/drafting/generateDraft.ts#L1)
- Template search (DB): [be/src/drafting/templateSearch.ts](be/src/drafting/templateSearch.ts#L1)
- Attachment loader: [be/src/drafting/loadAttachments.ts](be/src/drafting/loadAttachments.ts#L1)
- Draft router / intent heuristics: [be/src/drafting/router.ts](be/src/drafting/router.ts#L1)

**Notes & caveats**
- Drafting relies on templates and uploaded text in the DB; the quality of output depends on the `plan` and the matched template scaffold.
- The system uses an LLM without fine-tuning; all instruction tuning is via careful prompt construction.
- If you want full tracing of which exact templates and tokens are passed to the LLM, inspect the `generateDraftFromPlan()` prompt composition in [be/src/drafting/generateDraft.ts](be/src/drafting/generateDraft.ts#L1).

