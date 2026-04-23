import express from "express";
import prisma from "../lib/prisma.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

export const feedbackRouter = express.Router();

feedbackRouter.use(optionalAuth);
feedbackRouter.use(requireAuth);

function normalizeAssistantReaction(
  value: unknown
): "UP" | "DOWN" | null | "INVALID" {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized || normalized === "null" || normalized === "none" || normalized === "clear") {
    return null;
  }

  if (normalized === "up" || normalized === "like") {
    return "UP";
  }

  if (normalized === "down" || normalized === "dislike") {
    return "DOWN";
  }

  return "INVALID";
}

function normalizeOptionalString(value: unknown, maxLength = 5000) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return normalized.slice(0, maxLength);
}

function normalizeMode(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "case_modal") return "case_modal";
  if (normalized === "judgment_mode") return "judgment_mode";
  if (normalized === "drafting_mode") return "drafting_mode";

  return null;
}

feedbackRouter.get(
  "/assistant-message/:assistantMessageId",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const assistantMessageId = String(req.params.assistantMessageId || "").trim();

      if (!assistantMessageId) {
        return res.status(400).json({
          ok: false,
          error: "assistantMessageId is required.",
        });
      }

      const existing = await prisma.assistantMessageFeedback.findFirst({
        where: {
          userId: req.auth!.userId,
          assistantMessageId,
        },
      });

      res.status(200).json({
        ok: true,
        feedback: existing
          ? {
              id: existing.id,
              userId: existing.userId,
              conversationId: existing.conversationId,
              mode: existing.mode,
              caseId: existing.caseId,
              userMessageId: existing.userMessageId,
              assistantMessageId: existing.assistantMessageId,
              reaction: existing.reaction ? existing.reaction.toLowerCase() : null,
              comment: existing.comment || "",
              fingerprint: existing.fingerprint || null,
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

feedbackRouter.post(
  "/assistant-message",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const raw = req.body || {};

      const assistantMessageId = String(raw.assistantMessageId || "").trim();
      const userMessageId = normalizeOptionalString(raw.userMessageId, 191);
      const conversationId = normalizeOptionalString(raw.conversationId, 191);
      const caseId = normalizeOptionalString(raw.caseId, 64);
      const fingerprint = normalizeOptionalString(raw.fingerprint, 500);
      const comment = normalizeOptionalString(raw.comment, 5000);
      const reaction = normalizeAssistantReaction(raw.reaction);
      const mode = normalizeMode(raw.mode);

      if (!assistantMessageId) {
        return res.status(400).json({
          ok: false,
          error: "assistantMessageId is required.",
        });
      }

      if (!mode) {
        return res.status(400).json({
          ok: false,
          error: "mode must be either 'judgment_mode' or 'case_modal'.",
        });
      }

      if (reaction === "INVALID") {
        return res.status(400).json({
          ok: false,
          error: "reaction must be 'up', 'down', or null.",
        });
      }

      if (!reaction && !comment) {
        const existing = await prisma.assistantMessageFeedback.findFirst({
          where: {
            userId: req.auth!.userId,
            assistantMessageId,
          },
        });

        if (existing) {
          await prisma.assistantMessageFeedback.delete({
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

      const existing = await prisma.assistantMessageFeedback.findFirst({
        where: {
          userId: req.auth!.userId,
          assistantMessageId,
        },
      });

      const payload = {
        userId: req.auth!.userId,
        conversationId,
        mode,
        caseId,
        userMessageId,
        assistantMessageId,
        reaction,
        comment,
        fingerprint,
      };

      const saved = existing
        ? await prisma.assistantMessageFeedback.update({
            where: { id: existing.id },
            data: payload,
          })
        : await prisma.assistantMessageFeedback.create({
            data: payload,
          });

      res.status(200).json({
        ok: true,
        removed: false,
        feedback: {
          id: saved.id,
          userId: saved.userId,
          conversationId: saved.conversationId,
          mode: saved.mode,
          caseId: saved.caseId,
          userMessageId: saved.userMessageId,
          assistantMessageId: saved.assistantMessageId,
          reaction: saved.reaction ? saved.reaction.toLowerCase() : null,
          comment: saved.comment || "",
          fingerprint: saved.fingerprint || null,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);