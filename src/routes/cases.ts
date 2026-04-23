import express from "express";
import prisma from "../lib/prisma.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { fetchFullCaseFromQdrant } from "../services/qdrantCaseService.js";
import { fetchFullCaseHtmlFromSql } from "../services/sqlCaseService.js";
import {
  getOrCreateDetailedCaseSummary,
  streamDetailedCaseSummary,
} from "../services/caseSummaryService.js";
import {
  askCaseOnlyChat,
  streamCaseOnlyChat,
} from "../services/caseChatService.js";

export const casesRouter = express.Router();

casesRouter.use(optionalAuth);
casesRouter.use(requireAuth);

function normalizeCaseFeedback(
  value: unknown
): "up" | "down" | null | "INVALID" {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized || normalized === "null" || normalized === "none" || normalized === "clear") {
    return null;
  }

  if (normalized === "up" || normalized === "like") {
    return "up";
  }

  if (normalized === "down" || normalized === "dislike") {
    return "down";
  }

  return "INVALID";
}

function normalizeOptionalString(value: unknown, maxLength = 200) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return normalized.slice(0, maxLength);
}

casesRouter.get(
  "/:caseId/qdrant",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = await fetchFullCaseFromQdrant(req.params.caseId);

      res.status(200).json({
        ok: true,
        source: "qdrant",
        case: data,
      });
    } catch (error) {
      next(error);
    }
  }
);

casesRouter.get(
  "/:caseId/sql",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = await fetchFullCaseHtmlFromSql(req.params.caseId);

      res.status(200).json({
        ok: true,
        source: "sql",
        case: data,
      });
    } catch (error) {
      next(error);
    }
  }
);

casesRouter.get("/:caseId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const caseId = req.params.caseId;

    const [qdrantResult, sqlResult] = await Promise.allSettled([
      fetchFullCaseFromQdrant(caseId),
      fetchFullCaseHtmlFromSql(caseId),
    ]);

    res.status(200).json({
      ok: true,
      caseId,
      qdrant:
        qdrantResult.status === "fulfilled"
          ? qdrantResult.value
          : { error: qdrantResult.reason?.message || "Qdrant fetch failed" },
      sql:
        sqlResult.status === "fulfilled"
          ? sqlResult.value
          : { error: sqlResult.reason?.message || "SQL fetch failed" },
    });
  } catch (error) {
    next(error);
  }
});

casesRouter.get(
  "/:caseId/summary/detailed",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await getOrCreateDetailedCaseSummary(req.params.caseId);

      res.status(200).json({
        ok: true,
        summaryType: "detailed_v1",
        cached: result.cached,
        summary: result.summary,
      });
    } catch (error) {
      next(error);
    }
  }
);

casesRouter.post(
  "/:caseId/summary/detailed",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const html =
        typeof req.body?.html === "string" ? req.body.html : undefined;

      const result = await getOrCreateDetailedCaseSummary(req.params.caseId, {
        html,
      });

      res.status(200).json({
        ok: true,
        summaryType: "detailed_v1",
        cached: result.cached,
        summary: result.summary,
      });
    } catch (error) {
      next(error);
    }
  }
);

casesRouter.post(
  "/:caseId/summary/detailed/stream",
  async (req: AuthenticatedRequest, res, next) => {
    let clientClosed = false;

    const markClosed = () => {
      clientClosed = true;
    };

    req.on("aborted", markClosed);
    req.on("error", markClosed);
    res.on("close", () => {
      if (!res.writableEnded) {
        markClosed();
      }
    });

    const writeEvent = (data: unknown) => {
      if (clientClosed || res.writableEnded || res.destroyed) return;

      res.write(`${JSON.stringify(data)}\n`);

      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    };

    try {
      const html =
        typeof req.body?.html === "string" ? req.body.html : undefined;

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      await streamDetailedCaseSummary(req.params.caseId, { html }, writeEvent);

      if (!res.writableEnded) {
        res.end();
      }
    } catch (error: any) {
      if (res.headersSent) {
        writeEvent({
          type: "error",
          message: error?.message || "Detailed summary stream failed.",
        });

        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      next(error);
    }
  }
);

casesRouter.post(
  "/:caseId/chat/stream",
  async (req: AuthenticatedRequest, res, next) => {
    let clientClosed = false;

    const markClosed = () => {
      clientClosed = true;
    };

    req.on("aborted", markClosed);
    req.on("error", markClosed);
    res.on("close", () => {
      if (!res.writableEnded) {
        markClosed();
      }
    });

    const writeEvent = (data: unknown) => {
      if (clientClosed || res.writableEnded || res.destroyed) return;

      res.write(`${JSON.stringify(data)}\n`);

      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    };

    try {
      const rawMessages = Array.isArray(req.body?.messages)
        ? req.body.messages
        : [];

      const messages = rawMessages.map((message: any) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: String(message?.content ?? "").trim(),
      }));

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      await streamCaseOnlyChat(req.params.caseId, messages, writeEvent);

      if (!res.writableEnded) {
        res.end();
      }
    } catch (error: any) {
      if (res.headersSent) {
        writeEvent({
          type: "error",
          message: error?.message || "Case chat stream failed.",
        });

        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      next(error);
    }
  }
);

casesRouter.post(
  "/:caseId/chat",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const rawMessages = Array.isArray(req.body?.messages)
        ? req.body.messages
        : [];

      const messages = rawMessages.map((message: any) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: String(message?.content ?? "").trim(),
      }));

      const result = await askCaseOnlyChat(req.params.caseId, messages);

      res.status(200).json({
        ok: true,
        caseId: result.caseId,
        title: result.title,
        citation: result.citation,
        answer: result.answer,
      });
    } catch (error) {
      next(error);
    }
  }
);

casesRouter.get(
  "/:caseId/feedback",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const caseId = req.params.caseId;
      const assistantMessageId = normalizeOptionalString(
        req.query.assistantMessageId,
        191
      );

      if (!assistantMessageId) {
        return res.status(400).json({
          ok: false,
          error: "assistantMessageId is required.",
        });
      }

      const existing = await prisma.suggestedCaseFeedback.findFirst({
        where: {
          userId: req.auth!.userId,
          caseId,
          assistantMessageId,
        },
      });

      res.status(200).json({
        ok: true,
        feedback: existing
          ? {
              id: existing.id,
              caseId: existing.caseId,
              fingerprint: existing.fingerprint,
              feedback: existing.feedback,
              comment: existing.comment || "",
              userMessageId: existing.userMessageId,
              assistantMessageId: existing.assistantMessageId,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
            }
          : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

casesRouter.post(
  "/:caseId/feedback",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const caseId = req.params.caseId;
      const raw = req.body || {};

      const feedback = normalizeCaseFeedback(raw.feedback);
      const fingerprint = normalizeOptionalString(raw.fingerprint, 100);
      const comment = normalizeOptionalString(raw.comment, 200);
      const userMessageId = normalizeOptionalString(raw.userMessageId, 191);
      const assistantMessageId = normalizeOptionalString(
        raw.assistantMessageId,
        191
      );

      if (feedback === "INVALID") {
        return res.status(400).json({
          ok: false,
          error: "feedback must be 'up', 'down', or null.",
        });
      }

      if (!assistantMessageId) {
        return res.status(400).json({
          ok: false,
          error: "assistantMessageId is required.",
        });
      }

      const existing = await prisma.suggestedCaseFeedback.findFirst({
        where: {
          userId: req.auth!.userId,
          caseId,
          assistantMessageId,
        },
      });

      if (!feedback && !comment) {
        if (existing) {
          await prisma.suggestedCaseFeedback.delete({
            where: {
              id: existing.id,
            },
          });
        }

        return res.status(200).json({
          ok: true,
          removed: true,
          feedback: null,
        });
      }

      const payload = {
        userId: req.auth!.userId,
        caseId,
        fingerprint,
        feedback: feedback || "up",
        comment,
        userMessageId,
        assistantMessageId,
      };

      const saved = existing
        ? await prisma.suggestedCaseFeedback.update({
            where: {
              id: existing.id,
            },
            data: payload,
          })
        : await prisma.suggestedCaseFeedback.create({
            data: payload,
          });

      res.status(200).json({
        ok: true,
        removed: false,
        feedback: {
          id: saved.id,
          caseId: saved.caseId,
          fingerprint: saved.fingerprint,
          feedback: saved.feedback,
          comment: saved.comment || "",
          userMessageId: saved.userMessageId,
          assistantMessageId: saved.assistantMessageId,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

