import fs from "fs/promises";
import path from "path";

type LogEntry = {
  requestId?: string;
  timestamp?: string;
  conversationId?: string | null;
  query?: string;
  messages?: Array<{
    role?: string;
    content?: string;
    caseDigests?: Array<{
      caseId?: number;
      title?: string;
      citation?: string;
      summary?: string;
    }>;
  }>;
  latencyMs?: number;
  search?: {
    mode?: string | null;
    query?: {
      originalQuery?: string;
      normalizedQuery?: string;
      intent?: string;
      confidence?: number;
      caseTarget?: string | null;
      metadataField?: string | null;
      comparisonTargets?: string[];
      citations?: string[];
      followUpLikely?: boolean;
      strategy?: string;
      reasons?: string[];
      filters?: Record<string, unknown>;
    } | null;
    trace?: {
      originalQuery?: string;
      effectiveQuery?: string;
      router?: {
        version?: string;
        taskType?: string;
        userGoal?: string;
        isFollowUp?: boolean;
        followUpReferenceType?: string;
        resolvedQuery?: string;
        clarificationNeeded?: boolean;
        clarificationQuestion?: string | null;
        confidence?: number;
        reasons?: string[];
        retrievalPlan?: {
          strategy?: string;
          topK?: number;
          rerankTopN?: number;
        };
      } | null;
      classifiedFallback?: unknown;
      resolvedReference?: {
        referenceType?: string;
        usedPriorContext?: boolean;
        ordinalNumbers?: number[];
        resolvedCaseDigests?: Array<{
          caseId?: number;
          title?: string;
          citation?: string;
          summary?: string;
        }>;
        notes?: string[];
      } | null;
      filtersApplied?: Record<string, unknown> | null;
      notes?: string[];
    } | null;
    groupedCases?: Array<{
      caseId?: number;
      title?: string;
      citation?: string;
      bestScore?: number;
      chunkCount?: number;
      topChunks?: Array<{
        chunkId?: string;
        paragraphStart?: number | null;
        paragraphEnd?: number | null;
        score?: number;
        preview?: string;
      }>;
    }>;
    evidence?: Array<{
      caseId?: number;
      chunkId?: string;
      paragraphStart?: number | null;
      paragraphEnd?: number | null;
      score?: number;
      title?: string;
      citation?: string;
      preview?: string;
    }>;
  } | null;
  answer?: {
    answerType?: string;
    summary?: string;
    confidence?: number | null;
    warnings?: string[];
    citations?: Array<{
      caseId?: number;
      title?: string;
      citation?: string;
      chunkId?: string;
      paragraphStart?: number | null;
      paragraphEnd?: number | null;
    }>;
    caseDigests?: Array<{
      caseId?: number;
      title?: string;
      citation?: string;
      summary?: string;
    }>;
  } | null;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  } | null;
};

type Category =
  | "all"
  | "errors"
  | "weak-router"
  | "fallback"
  | "empty"
  | "latest"
  | "clarify"
  | "low-answer-confidence"
  | "follow-up";

type Options = {
  dir: string;
  file?: string;
  days?: number;
  limit: number;
  category: Category;
  summaryOnly: boolean;
};

function compact(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function truncate(text: string | null | undefined, max = 160): string {
  const clean = compact(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}...`;
}

function parseArgs(argv: string[]): Options {
  const defaultDir =
    process.env.SEARCH_LOG_DIR ||
    path.resolve(process.cwd(), "logs", "search-traces");

  const opts: Options = {
    dir: defaultDir,
    days: undefined,
    file: undefined,
    limit: 50,
    category: "all",
    summaryOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dir" && argv[i + 1]) {
      opts.dir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--file" && argv[i + 1]) {
      opts.file = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--days" && argv[i + 1]) {
      opts.days = Number(argv[i + 1]) || undefined;
      i += 1;
      continue;
    }

    if (arg === "--limit" && argv[i + 1]) {
      opts.limit = Math.max(1, Number(argv[i + 1]) || 50);
      i += 1;
      continue;
    }

    if (arg === "--category" && argv[i + 1]) {
      const value = argv[i + 1] as Category;
      opts.category = value;
      i += 1;
      continue;
    }

    if (arg === "--summary-only") {
      opts.summaryOnly = true;
      continue;
    }
  }

  return opts;
}

async function getTargetFiles(opts: Options): Promise<string[]> {
  if (opts.file) {
    return [path.isAbsolute(opts.file) ? opts.file : path.join(opts.dir, opts.file)];
  }

  const names = await fs.readdir(opts.dir);
  const files = names
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .reverse();

  if (!opts.days) {
    return files.map((name) => path.join(opts.dir, name));
  }

  return files.slice(0, opts.days).map((name) => path.join(opts.dir, name));
}

async function readJsonlFile(filePath: string): Promise<LogEntry[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const out: LogEntry[] = [];

  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch (error) {
      console.warn(`[reviewSearchLogs] skipped invalid JSON line in ${filePath}`);
    }
  }

  return out;
}

async function loadEntries(opts: Options): Promise<LogEntry[]> {
  const files = await getTargetFiles(opts);
  const all: LogEntry[] = [];

  for (const file of files) {
    try {
      const entries = await readJsonlFile(file);
      all.push(...entries);
    } catch (error: any) {
      console.warn(`[reviewSearchLogs] failed to read ${file}: ${error?.message || error}`);
    }
  }

  return all.sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return tb - ta;
  });
}

function traceNotes(entry: LogEntry): string[] {
  return Array.isArray(entry.search?.trace?.notes) ? entry.search!.trace!.notes! : [];
}

function answerWarnings(entry: LogEntry): string[] {
  return Array.isArray(entry.answer?.warnings) ? entry.answer!.warnings! : [];
}

function routerConfidence(entry: LogEntry): number | null {
  const value = entry.search?.trace?.router?.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function answerConfidence(entry: LogEntry): number | null {
  const value = entry.answer?.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function groupedCaseCount(entry: LogEntry): number {
  return Array.isArray(entry.search?.groupedCases) ? entry.search!.groupedCases!.length : 0;
}

function evidenceCount(entry: LogEntry): number {
  return Array.isArray(entry.search?.evidence) ? entry.search!.evidence!.length : 0;
}

function hasError(entry: LogEntry): boolean {
  return Boolean(entry.error?.message);
}

function usedFallback(entry: LogEntry): boolean {
  return Boolean(entry.search?.trace?.classifiedFallback) ||
    traceNotes(entry).some((note) =>
      compact(note).toLowerCase().includes("fallback")
    );
}

function isWeakRouter(entry: LogEntry): boolean {
  const confidence = routerConfidence(entry);
  if (confidence != null && confidence < 0.65) return true;

  return traceNotes(entry).some((note) =>
    compact(note).toLowerCase().includes("router output was weak")
  );
}

function isEmptyResult(entry: LogEntry): boolean {
  return groupedCaseCount(entry) === 0 || evidenceCount(entry) === 0;
}

function isLatestCaseIssue(entry: LogEntry): boolean {
  const taskType = entry.search?.trace?.router?.taskType || entry.search?.query?.intent || "";
  if (taskType === "latest_cases") return true;

  const q = compact(entry.query).toLowerCase();
  if (/\b(latest|recent|newest|today|current)\b/.test(q)) return true;

  return (
    traceNotes(entry).some((note) =>
      compact(note).toLowerCase().includes("latest/recent case query")
    ) ||
    answerWarnings(entry).some((warning) =>
      compact(warning).toLowerCase().includes("recency-aware retrieval")
    )
  );
}

function needsClarification(entry: LogEntry): boolean {
  return Boolean(entry.search?.trace?.router?.clarificationNeeded);
}

function isLowAnswerConfidence(entry: LogEntry): boolean {
  const confidence = answerConfidence(entry);
  return confidence != null && confidence < 0.6;
}

function isFollowUp(entry: LogEntry): boolean {
  return Boolean(entry.search?.trace?.router?.isFollowUp) ||
    Boolean(entry.search?.query?.followUpLikely) ||
    Boolean(entry.search?.trace?.resolvedReference?.usedPriorContext);
}

function matchesCategory(entry: LogEntry, category: Category): boolean {
  if (category === "all") return true;
  if (category === "errors") return hasError(entry);
  if (category === "weak-router") return isWeakRouter(entry);
  if (category === "fallback") return usedFallback(entry);
  if (category === "empty") return isEmptyResult(entry);
  if (category === "latest") return isLatestCaseIssue(entry);
  if (category === "clarify") return needsClarification(entry);
  if (category === "low-answer-confidence") return isLowAnswerConfidence(entry);
  if (category === "follow-up") return isFollowUp(entry);
  return true;
}

function formatEntry(entry: LogEntry, index: number): string {
  const notes = traceNotes(entry);
  const warnings = answerWarnings(entry);

  return [
    `#${index + 1}  ${entry.timestamp || "unknown-time"}  ${entry.requestId || "no-request-id"}`,
    `Query: ${truncate(entry.query, 220)}`,
    `Intent: ${entry.search?.trace?.router?.taskType || entry.search?.query?.intent || "unknown"} | Mode: ${entry.search?.mode || "unknown"} | Latency: ${entry.latencyMs ?? "?"}ms`,
    `Router confidence: ${routerConfidence(entry) ?? "n/a"} | Answer confidence: ${answerConfidence(entry) ?? "n/a"}`,
    `Grouped cases: ${groupedCaseCount(entry)} | Evidence: ${evidenceCount(entry)} | Follow-up: ${isFollowUp(entry) ? "yes" : "no"} | Fallback: ${usedFallback(entry) ? "yes" : "no"}`,
    entry.error?.message ? `Error: ${truncate(entry.error.message, 220)}` : "",
    notes.length ? `Trace notes: ${notes.join(" | ")}` : "",
    warnings.length ? `Warnings: ${warnings.join(" | ")}` : "",
    Array.isArray(entry.search?.groupedCases) && entry.search!.groupedCases!.length
      ? `Top cases: ${entry.search!.groupedCases!
          .slice(0, 3)
          .map((g) => compact(g.title || "Unknown case"))
          .filter(Boolean)
          .join(" | ")}`
      : "",
    entry.answer?.summary ? `Answer: ${truncate(entry.answer.summary, 260)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function printSummary(entries: LogEntry[]) {
  const stats = {
    total: entries.length,
    errors: entries.filter(hasError).length,
    weakRouter: entries.filter(isWeakRouter).length,
    fallback: entries.filter(usedFallback).length,
    empty: entries.filter(isEmptyResult).length,
    latest: entries.filter(isLatestCaseIssue).length,
    clarify: entries.filter(needsClarification).length,
    lowAnswerConfidence: entries.filter(isLowAnswerConfidence).length,
    followUp: entries.filter(isFollowUp).length,
  };

  console.log("\n=== Search Log Summary ===");
  console.log(`Total entries           : ${stats.total}`);
  console.log(`Errors                  : ${stats.errors}`);
  console.log(`Weak router             : ${stats.weakRouter}`);
  console.log(`Legacy fallback         : ${stats.fallback}`);
  console.log(`Empty results           : ${stats.empty}`);
  console.log(`Latest/recent queries   : ${stats.latest}`);
  console.log(`Clarification needed    : ${stats.clarify}`);
  console.log(`Low answer confidence   : ${stats.lowAnswerConfidence}`);
  console.log(`Follow-up queries       : ${stats.followUp}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const entries = await loadEntries(opts);

  if (!entries.length) {
    console.log(`No log entries found in: ${opts.dir}`);
    return;
  }

  printSummary(entries);

  const filtered = entries
    .filter((entry) => matchesCategory(entry, opts.category))
    .slice(0, opts.limit);

  console.log(`\n=== Showing ${filtered.length} entries for category: ${opts.category} ===`);

  if (opts.summaryOnly) return;

  if (!filtered.length) {
    console.log("No matching entries.");
    return;
  }

  filtered.forEach((entry, index) => {
    console.log("\n" + formatEntry(entry, index));
  });
}

main().catch((error) => {
  console.error("[reviewSearchLogs] fatal error:", error);
  process.exit(1);
});