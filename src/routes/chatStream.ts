import express from "express";
import prisma from "../lib/prisma.js";
import { orchestrateSearch } from "../orchestrator/searchOrchestrator.js";
import { composeAnswer } from "../answer/composeAnswer.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { deriveConversationTitle } from "../utils/auth.js";

export const chatStreamRouter = express.Router();

type SourceItem = {
  title: string;
  citation: string;
  range?: string;
};

type CaseDigest = {
  caseId?: number;
  title: string;
  citation: string;
  summary: string;
};

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  caseDigests?: CaseDigest[];
};

function writeEvent(res: express.Response, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`${JSON.stringify(data)}\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

function citationRange(c: {
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
}) {
  if (c.paragraphStart == null || c.paragraphEnd == null) return "";
  if (c.paragraphStart === c.paragraphEnd) return `para ${c.paragraphStart}`;
  return `paras ${c.paragraphStart}-${c.paragraphEnd}`;
}

function chunkText(text: string, size = 6) {
  const parts: string[] = [];
  let i = 0;

  while (i < text.length) {
    parts.push(text.slice(i, i + size));
    i += size;
  }

  return parts;
}

function compact(value: unknown) {
  return String(value ?? "").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTrace(searchResult: any, originalQuery: string) {
  const routerCandidate =
    searchResult?.trace?.router ||
    searchResult?.classified ||
    searchResult?.classification ||
    searchResult?.router ||
    searchResult?.query ||
    {};

  const notes: string[] = [];

  if (searchResult?.mode) {
    notes.push(`Mode: ${searchResult.mode}`);
  }

  if (Array.isArray(searchResult?.trace?.notes)) {
    for (const note of searchResult.trace.notes.slice(0, 6)) {
      if (typeof note === "string" && note.trim()) {
        notes.push(note.trim());
      }
    }
  }

  return {
    originalQuery,
    effectiveQuery:
      compact(searchResult?.effectiveQuery) ||
      compact(searchResult?.normalizedQuery) ||
      compact(searchResult?.trace?.router?.resolvedQuery) ||
      originalQuery,
    router: routerCandidate,
    classifiedFallback: searchResult?.trace?.classifiedFallback || undefined,
    resolvedReference:
      searchResult?.trace?.resolvedReference ||
      searchResult?.resolvedReference ||
      undefined,
    filtersApplied:
      searchResult?.trace?.filtersApplied ||
      searchResult?.filtersApplied ||
      undefined,
    notes: [...new Set(notes)].slice(0, 8),
  };
}

function parseCaseDigests(jsonValue: unknown): CaseDigest[] {
  if (!Array.isArray(jsonValue)) return [];
  return jsonValue
    .map((item: any) => ({
      caseId: item?.caseId,
      title: compact(item?.title),
      citation: compact(item?.citation),
      summary: compact(item?.summary),
    }))
    .filter((item) => item.title || item.citation || item.summary);
}

function buildTurnsFromDbMessages(
  dbMessages: Array<{
    role: "USER" | "ASSISTANT";
    content: string;
    caseDigestsJson: unknown;
  }>
): ChatTurn[] {
  return dbMessages
    .filter((message) => compact(message.content))
    .map((message) => ({
      role: message.role === "USER" ? "user" : "assistant",
      content: message.content,
      caseDigests:
        message.role === "ASSISTANT"
          ? parseCaseDigests(message.caseDigestsJson)
          : undefined,
    }));
}

chatStreamRouter.use(optionalAuth);
chatStreamRouter.use(requireAuth);

chatStreamRouter.post("/stream", async (req: AuthenticatedRequest, res, next) => {
  let clientClosed = false;

  req.on("close", () => {
    clientClosed = true;
  });

  try {
    const fallbackQuery = compact(req.body?.query).slice(0, 1000);
    const providedConversationId = compact(req.body?.conversationId);

    let query = fallbackQuery;

    if (!query && Array.isArray(req.body?.messages)) {
      const lastUser = [...req.body.messages]
        .reverse()
        .find((message: any) => message?.role === "user" && compact(message?.content));

      query = compact(lastUser?.content).slice(0, 1000);
    }

    if (!query) {
      return res.status(400).json({
        ok: false,
        error: "Query is required.",
      });
    }

    let conversation = providedConversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: providedConversationId,
            userId: req.auth!.userId,
            archivedAt: null,
          },
          select: {
            id: true,
            title: true,
          },
        })
      : null;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId: req.auth!.userId,
          title: deriveConversationTitle(query),
        },
        select: {
          id: true,
          title: true,
        },
      });
    }

    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: query,
      },
      select: {
        id: true,
      },
    });

    if (conversation.title === "New chat") {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          title: deriveConversationTitle(query),
          updatedAt: new Date(),
        },
      });
    }

    const dbMessages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        role: true,
        content: true,
        caseDigestsJson: true,
      },
    });

    const messages = buildTurnsFromDbMessages(dbMessages);

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Content-Encoding", "identity");
    res.flushHeaders?.();
    res.socket?.setNoDelay?.(true);

    writeEvent(res, {
      type: "status",
      phase: "Understanding query",
      conversationId: conversation.id,
    });

    const searchResult = await orchestrateSearch({
      query,
      messages,
    });

    if (clientClosed) return;

    const trace = buildTrace(searchResult, query);

    writeEvent(res, {
      type: "status",
      phase: "Searching authorities",
      trace,
      conversationId: conversation.id,
    });

    writeEvent(res, {
      type: "meta",
      mode: searchResult?.mode,
      sources: [],
      caseDigests: [],
      trace,
      conversationId: conversation.id,
    });

    writeEvent(res, {
      type: "status",
      phase: "Drafting answer",
      trace,
      conversationId: conversation.id,
    });

    const answer = await composeAnswer({
      ...searchResult,
      messages,
    });

    if (clientClosed) return;

    const sources: SourceItem[] = (answer?.citations || [])
      .slice(0, 5)
      .map((c: any) => ({
        title: c.title,
        citation: c.citation,
        range: citationRange(c),
      }));

    const caseDigests = (answer?.caseDigests || [])
      .slice(0, 5)
      .map((d: any) => ({
        caseId: d.caseId,
        title: d.title,
        citation: d.citation,
        summary: d.summary,
      }));

    writeEvent(res, {
      type: "meta",
      mode: searchResult?.mode,
      sources,
      caseDigests,
      trace,
      conversationId: conversation.id,
    });

    const answerText = String(answer?.summary || "").trim();

    if (answerText) {
      writeEvent(res, {
        type: "status",
        phase: "Streaming answer",
        trace,
        conversationId: conversation.id,
      });

      const chunks = chunkText(answerText, 6);

      for (const part of chunks) {
        if (clientClosed) return;
        writeEvent(res, {
          type: "delta",
          text: part,
          conversationId: conversation.id,
        });
        await sleep(20);
      }
    }

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: answerText,
        sourcesJson: sources,
        caseDigestsJson: caseDigests,
        traceJson: trace,
      },
      select: {
        id: true,
      },
    });

    await prisma.promptRun.create({
      data: {
        userId: req.auth!.userId,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        originalQuery: query,
        effectiveQuery: trace.effectiveQuery || query,
        mode: searchResult?.mode || null,
        routerJson: trace.router || null,
        filtersJson: trace.filtersApplied || null,
        notesJson: trace.notes || null,
        sourcesJson: sources,
        caseDigestsJson: caseDigests,
        confidence:
          typeof answer?.confidence === "number" ? answer.confidence : null,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    writeEvent(res, {
      type: "done",
      answerType: answer?.answerType,
      confidence: answer?.confidence,
      conversationId: conversation.id,
    });

    res.end();
  } catch (error) {
    next(error);
  }
});