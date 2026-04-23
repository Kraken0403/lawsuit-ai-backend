import express from "express";
import prisma from "../lib/prisma.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

export const conversationsRouter = express.Router();

function parseChatMode(value: unknown): "JUDGMENT" | "DRAFTING_STUDIO" | "ARGUMENT" | null {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "judgment") return "JUDGMENT";
  if (normalized === "drafting_studio") return "DRAFTING_STUDIO";
  if (normalized === "argument") return "ARGUMENT";

  return null;
}

conversationsRouter.use(optionalAuth);
conversationsRouter.use(requireAuth);

conversationsRouter.get("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const requestedChatMode = parseChatMode(req.query.chatMode);

    const conversations = await prisma.conversation.findMany({
      where: {
        userId: req.auth!.userId,
        archivedAt: null,
        ...(requestedChatMode ? { chatMode: requestedChatMode } : {}),
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        chatMode: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            content: true,
            role: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    res.status(200).json({
      ok: true,
      conversations: conversations.map((item) => ({
        id: item.id,
        title: item.title,
        chatMode: item.chatMode.toLowerCase(),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messageCount: item._count.messages,
        preview: item.messages[0]?.content || "",
        lastMessageRole: item.messages[0]
          ? item.messages[0].role === "USER"
            ? "user"
            : "assistant"
          : null,
        lastMessageAt: item.messages[0]?.createdAt || item.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post("/", async (req: AuthenticatedRequest, res, next) => {
  try {
    const title = String(req.body?.title || "").trim() || "New chat";
    const requestedChatMode = parseChatMode(req.body?.chatMode) || "JUDGMENT";

    const conversation = await prisma.conversation.create({
      data: {
        userId: req.auth!.userId,
        title,
        chatMode: requestedChatMode,
      },
      select: {
        id: true,
        title: true,
        chatMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({
      ok: true,
      conversation: {
        ...conversation,
        chatMode: conversation.chatMode.toLowerCase(),
      },
    });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.get("/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
        archivedAt: null,
      },
      select: {
        id: true,
        title: true,
        chatMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        error: "Conversation not found.",
      });
    }

    res.status(200).json({
      ok: true,
      conversation: {
        ...conversation,
        chatMode: conversation.chatMode.toLowerCase(),
      },
    });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.get("/:id/messages", async (req: AuthenticatedRequest, res, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
        archivedAt: null,
      },
      select: {
        id: true,
        title: true,
        chatMode: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        error: "Conversation not found.",
      });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        role: true,
        content: true,
        sourcesJson: true,
        caseDigestsJson: true,
        traceJson: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      ok: true,
      conversation: {
        ...conversation,
        chatMode: conversation.chatMode.toLowerCase(),
      },
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
        sources: message.sourcesJson || [],
        caseDigests: message.caseDigestsJson || [],
        trace: message.traceJson || null,
        createdAt: message.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.patch("/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const title = String(req.body?.title || "").trim();

    if (!title) {
      return res.status(400).json({
        ok: false,
        error: "Title is required.",
      });
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
        archivedAt: null,
      },
      select: { id: true, chatMode: true },
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "Conversation not found.",
      });
    }

    const updated = await prisma.conversation.update({
      where: { id: existing.id },
      data: { title },
      select: {
        id: true,
        title: true,
        chatMode: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      ok: true,
      conversation: {
        ...updated,
        chatMode: updated.chatMode.toLowerCase(),
      },
    });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.delete("/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const existing = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "Conversation not found.",
      });
    }

    await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        archivedAt: new Date(),
      },
    });

    res.status(200).json({
      ok: true,
      conversationId: existing.id,
    });
  } catch (error) {
    next(error);
  }
});