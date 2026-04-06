import express from "express";
import type { RequestHandler } from "express";
import prisma from "../lib/prisma.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { searchDraftTemplates } from "../drafting/templateSearch.js";
import {
  compact,
  normalizeText,
  toStringArray,
} from "../drafting/utils.js";
import {
  applyFieldValuesToMarkdown,
  extractUnresolvedPlaceholders,
} from "../drafting/placeholders.js";

import { regenerateDraftSection } from "../drafting/regenerateSection.js";
import {
  buildPublicAssetUrl,
  createDraftingSettingsAssetUpload,
  deleteLocalAssetByPublicUrl,
  getDraftingSettingsFieldForKind,
  type DraftingAssetKind,
} from "../lib/settingsAssetStorage.js";

import { generateDraftPdfBuffer } from "../drafting/pdfExport.js";

import { generateDraftDocxBuffer } from "../drafting/docxExport.js";

import multer from "multer";
import { transcribeAudioBuffer } from "../services/audioTranscriptionService.js";

export const draftingRouter = express.Router();

draftingRouter.use(optionalAuth);
draftingRouter.use(requireAuth);

async function resolveOwnedConversationId(
  req: AuthenticatedRequest,
  conversationId: unknown
) {
  const id = compact(conversationId);
  if (!id) return null;

  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: req.auth!.userId,
      archivedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!conversation) {
    const error = new Error("Conversation not found.");
    (error as any).status = 404;
    throw error;
  }

  return conversation.id;
}

const draftingSettingsAssetUpload = createDraftingSettingsAssetUpload();

const uploadSingleImage = draftingSettingsAssetUpload.single(
  "file"
) as unknown as RequestHandler;

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/m4a",
  "audio/aac",
  "video/webm",
  "application/octet-stream",
]);

const speechUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_AUDIO_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new Error(
          "Only WEBM, MP4, MP3, WAV, OGG, M4A, or AAC audio files are allowed."
        )
      );
    }

    cb(null, true);
  },
}).single("file") as unknown as RequestHandler;

function normalizeDraftBrandingMode(value: unknown) {
  const normalized = compact(value).toUpperCase();

  if (
    normalized === "NONE" ||
    normalized === "HEADER_FOOTER" ||
    normalized === "LETTERHEAD"
  ) {
    return normalized as "NONE" | "HEADER_FOOTER" | "LETTERHEAD";
  }

  return "NONE";
}

function parseNullableInt(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.round(parsed));
}

function parseNullableBoolean(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;

  return null;
}

function setNullableStringField(
  target: Record<string, unknown>,
  body: any,
  key: string
) {
  if (Object.prototype.hasOwnProperty.call(body, key)) {
    target[key] = compact(body?.[key]) || null;
  }
}

function buildFirmSettingsPayload(body: any) {
  const payload: Record<string, unknown> = {};
  const lockBranding = parseNullableBoolean(body?.draftingLockBranding);

  setNullableStringField(payload, body, "firmName");
  setNullableStringField(payload, body, "advocateName");
  setNullableStringField(payload, body, "enrollmentNumber");
  setNullableStringField(payload, body, "address");
  setNullableStringField(payload, body, "email");
  setNullableStringField(payload, body, "phone");
  setNullableStringField(payload, body, "website");
  setNullableStringField(payload, body, "logoUrl");
  setNullableStringField(payload, body, "headerText");
  setNullableStringField(payload, body, "footerText");
  setNullableStringField(payload, body, "signatureText");

  if (Object.prototype.hasOwnProperty.call(body, "draftingBrandingMode")) {
    payload.draftingBrandingMode = normalizeDraftBrandingMode(
      body?.draftingBrandingMode
    );
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingHeaderImageUrl")) {
    payload.draftingHeaderImageUrl = compact(body?.draftingHeaderImageUrl) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingFooterImageUrl")) {
    payload.draftingFooterImageUrl = compact(body?.draftingFooterImageUrl) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingLetterheadImageUrl")) {
    payload.draftingLetterheadImageUrl =
      compact(body?.draftingLetterheadImageUrl) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingSignatureImageUrl")) {
    payload.draftingSignatureImageUrl =
      compact(body?.draftingSignatureImageUrl) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingHeaderHeightPx")) {
    payload.draftingHeaderHeightPx = parseNullableInt(body?.draftingHeaderHeightPx);
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingFooterHeightPx")) {
    payload.draftingFooterHeightPx = parseNullableInt(body?.draftingFooterHeightPx);
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingLetterheadHeightPx")) {
    payload.draftingLetterheadHeightPx = parseNullableInt(
      body?.draftingLetterheadHeightPx
    );
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingLockBranding")) {
    payload.draftingLockBranding = lockBranding == null ? true : lockBranding;
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingDefaultTone")) {
    payload.draftingDefaultTone = compact(body?.draftingDefaultTone) || null;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "draftingDefaultJurisdiction")
  ) {
    payload.draftingDefaultJurisdiction =
      compact(body?.draftingDefaultJurisdiction) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "draftingDefaultForum")) {
    payload.draftingDefaultForum = compact(body?.draftingDefaultForum) || null;
  }

  return payload;
}

draftingRouter.get("/settings", async (req: AuthenticatedRequest, res, next) => {
  try {
    const settings = await prisma.firmSettings.findUnique({
      where: { userId: req.auth!.userId },
    });

    res.status(200).json({
      ok: true,
      settings,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.put("/settings", async (req: AuthenticatedRequest, res, next) => {
  try {
    const data = buildFirmSettingsPayload(req.body || {});

    const settings = await prisma.firmSettings.upsert({
      where: { userId: req.auth!.userId },
      create: {
        userId: req.auth!.userId,
        draftingBrandingMode: "NONE",
        draftingLockBranding: true,
        ...data,
      },
      update: data,
    });

    res.status(200).json({
      ok: true,
      settings,
    });
  } catch (error) {
    next(error);
  }
});


draftingRouter.post(
  "/settings/assets/:kind",
  uploadSingleImage,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const kind = compact(req.params.kind).toLowerCase() as DraftingAssetKind;
      const targetField = getDraftingSettingsFieldForKind(kind);

      if (!targetField) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid asset kind. Use header, footer, letterhead, or signature.",
        });
      }

      const uploadedFile = (req as any).file as Express.Multer.File | undefined;

      if (!uploadedFile) {
        return res.status(400).json({
          ok: false,
          error: "file is required.",
        });
      }

      const publicUrl = buildPublicAssetUrl(req, uploadedFile.path);

      const existing = await prisma.firmSettings.findUnique({
        where: { userId: req.auth!.userId },
      });

      const previousUrl =
        existing && targetField in existing
          ? ((existing as any)[targetField] as string | null)
          : null;

      const settings = await prisma.firmSettings.upsert({
        where: { userId: req.auth!.userId },
        create: {
          userId: req.auth!.userId,
          draftingBrandingMode:
            kind === "letterhead" ? "LETTERHEAD" : "HEADER_FOOTER",
          [targetField]: publicUrl,
        } as any,
        update: {
          [targetField]: publicUrl,
          ...(kind === "letterhead"
            ? { draftingBrandingMode: "LETTERHEAD" as const }
            : {}),
        } as any,
      });

      if (previousUrl && previousUrl !== publicUrl) {
        await deleteLocalAssetByPublicUrl(previousUrl);
      }

      res.status(200).json({
        ok: true,
        kind,
        url: publicUrl,
        settings,
      });
    } catch (error) {
      next(error);
    }
  }
);

draftingRouter.delete(
  "/settings/assets/:kind",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const kind = compact(req.params.kind).toLowerCase() as DraftingAssetKind;
      const targetField = getDraftingSettingsFieldForKind(kind);

      if (!targetField) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid asset kind. Use header, footer, letterhead, or signature.",
        });
      }

      const existing = await prisma.firmSettings.findUnique({
        where: { userId: req.auth!.userId },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "Settings not found.",
        });
      }

      const previousUrl =
        targetField in existing
          ? ((existing as any)[targetField] as string | null)
          : null;

      const settings = await prisma.firmSettings.update({
        where: { userId: req.auth!.userId },
        data: {
          [targetField]: null,
        } as any,
      });

      if (previousUrl) {
        await deleteLocalAssetByPublicUrl(previousUrl);
      }

      res.status(200).json({
        ok: true,
        kind,
        settings,
      });
    } catch (error) {
      next(error);
    }
  }
);

draftingRouter.get("/templates", async (req: AuthenticatedRequest, res, next) => {
  try {
    const family = compact(req.query.family);
    const search = compact(req.query.search);
    const source = compact(req.query.source).toUpperCase();

    if (search) {
      const templates = await searchDraftTemplates({
        userId: req.auth!.userId,
        query: search,
        familyHint: (family || null) as any,
        limit: 20,
      });

      return res.status(200).json({
        ok: true,
        templates,
      });
    }

    const templates = await prisma.draftTemplate.findMany({
      where: {
        isActive: true,
        ...(family ? { family } : {}),
        ...(source
          ? source === "SYSTEM"
            ? { source: "SYSTEM" }
            : source === "FIRM"
            ? { source: "FIRM", ownerUserId: req.auth!.userId }
            : source === "SESSION_UPLOAD"
            ? { source: "SESSION_UPLOAD", ownerUserId: req.auth!.userId }
            : {}
          : {
              OR: [
                { source: "SYSTEM" },
                { source: "FIRM", ownerUserId: req.auth!.userId },
                { source: "SESSION_UPLOAD", ownerUserId: req.auth!.userId },
              ],
            }),
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        source: true,
        title: true,
        family: true,
        subtype: true,
        summary: true,
        tagsJson: true,
        precedentStrength: true,
        sourceRef: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      ok: true,
      templates: templates.map((item) => ({
        ...item,
        tags: toStringArray(item.tagsJson),
      })),
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.get("/templates/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const template = await prisma.draftTemplate.findFirst({
      where: {
        id: req.params.id,
        isActive: true,
        OR: [{ source: "SYSTEM" }, { ownerUserId: req.auth!.userId }],
      },
    });

    if (!template) {
      return res.status(404).json({
        ok: false,
        error: "Template not found.",
      });
    }

    res.status(200).json({
      ok: true,
      template,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/templates", async (req: AuthenticatedRequest, res, next) => {
  try {
    const title = compact(req.body?.title);
    const family = compact(req.body?.family);
    const rawText = String(req.body?.rawText || "").trim();

    if (!title || !family || !rawText) {
      return res.status(400).json({
        ok: false,
        error: "title, family, and rawText are required.",
      });
    }

    const template = await prisma.draftTemplate.create({
      data: {
        ownerUserId: req.auth!.userId,
        source: "FIRM",
        title,
        family,
        subtype: compact(req.body?.subtype) || null,
        jurisdiction: compact(req.body?.jurisdiction) || null,
        forum: compact(req.body?.forum) || null,
        language: compact(req.body?.language) || null,
        tagsJson: toStringArray(req.body?.tags),
        useWhenJson: toStringArray(req.body?.useWhen),
        notForJson: toStringArray(req.body?.notFor),
        summary: compact(req.body?.summary) || null,
        precedentStrength:
          req.body?.precedentStrength === "STRONG" ||
          req.body?.precedentStrength === "BASIC" ||
          req.body?.precedentStrength === "LEGACY"
            ? req.body.precedentStrength
            : "STANDARD",
        rawText,
        normalizedText: normalizeText(rawText),
        placeholdersJson: Array.isArray(req.body?.placeholders)
          ? req.body.placeholders
          : [],
        clauseBlocksJson: Array.isArray(req.body?.clauseBlocks)
          ? req.body.clauseBlocks
          : [],
        executionRequirementsJson:
          req.body?.executionRequirements &&
          typeof req.body.executionRequirements === "object"
            ? req.body.executionRequirements
            : null,
        riskNotesJson: toStringArray(req.body?.riskNotes),
        sourceRef: compact(req.body?.sourceRef) || null,
      },
    });

    res.status(201).json({
      ok: true,
      template,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.get("/documents", async (req: AuthenticatedRequest, res, next) => {
  try {
    const family = compact(req.query.family);
    const status = compact(req.query.status).toUpperCase();
    const search = compact(req.query.search);
    const conversationId = compact(req.query.conversationId);

    const documents = await prisma.draftDocument.findMany({
      where: {
        userId: req.auth!.userId,
        ...(family ? { family } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(status === "DRAFT" || status === "FINAL" || status === "ARCHIVED"
          ? { status: status as any }
          : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search } },
                { family: { contains: search } },
                { subtype: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        family: true,
        subtype: true,
        strategy: true,
        matchLevel: true,
        status: true,
        conversationId: true,
        createdAt: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: {
            versionNumber: true,
            createdAt: true,
          },
        },
      },
    });

    res.status(200).json({
      ok: true,
      documents: documents.map((item) => ({
        ...item,
        latestVersionNumber: item.versions[0]?.versionNumber || 0,
        latestVersionCreatedAt: item.versions[0]?.createdAt || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/documents", async (req: AuthenticatedRequest, res, next) => {
  try {
    const title = compact(req.body?.title);
    const family = compact(req.body?.family) || "misc";

    if (!title) {
      return res.status(400).json({
        ok: false,
        error: "title is required.",
      });
    }

    const conversationId = await resolveOwnedConversationId(
      req,
      req.body?.conversationId
    );

    const sourceTemplateIds = Array.isArray(req.body?.sourceTemplateIds)
      ? req.body.sourceTemplateIds
      : [];

    const inputDataJson =
      req.body?.inputData && typeof req.body.inputData === "object"
        ? req.body.inputData
        : null;

    const draftingPlanJson =
      req.body?.draftingPlan && typeof req.body.draftingPlan === "object"
        ? req.body.draftingPlan
        : null;

    const draftMarkdown =
      typeof req.body?.draftMarkdown === "string" ? req.body.draftMarkdown : null;

    const draftHtml =
      typeof req.body?.draftHtml === "string" ? req.body.draftHtml : null;

    const editorJson =
      req.body?.editorJson && typeof req.body.editorJson === "object"
        ? req.body.editorJson
        : null;

    const unresolvedPlaceholders =
      Array.isArray(req.body?.unresolvedPlaceholders)
        ? req.body.unresolvedPlaceholders
        : extractUnresolvedPlaceholders(draftMarkdown || "");

    const createInitialVersion = req.body?.createInitialVersion !== false;

    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.draftDocument.create({
        data: {
          userId: req.auth!.userId,
          conversationId,
          title,
          family,
          subtype: compact(req.body?.subtype) || null,
          strategy: compact(req.body?.strategy) || null,
          matchLevel: compact(req.body?.matchLevel) || null,
          sourceTemplateIdsJson: sourceTemplateIds,
          inputDataJson,
          draftingPlanJson,
          draftMarkdown,
          draftHtml,
          editorJson,
          unresolvedPlaceholdersJson: unresolvedPlaceholders,
          status:
            req.body?.status === "FINAL" || req.body?.status === "ARCHIVED"
              ? req.body.status
              : "DRAFT",
        },
      });

      if (createInitialVersion) {
        await tx.draftDocumentVersion.create({
          data: {
            draftDocumentId: document.id,
            versionNumber: 1,
            title: document.title,
            family: document.family,
            subtype: document.subtype,
            strategy: document.strategy,
            matchLevel: document.matchLevel,
            sourceTemplateIdsJson: document.sourceTemplateIdsJson,
            inputDataJson: document.inputDataJson,
            draftingPlanJson: document.draftingPlanJson,
            draftMarkdown: document.draftMarkdown,
            draftHtml: document.draftHtml,
            editorJson: document.editorJson,
            unresolvedPlaceholdersJson: document.unresolvedPlaceholdersJson,
            createdByUserId: req.auth!.userId,
          },
        });
      }

      return document;
    });

    res.status(201).json({
      ok: true,
      document: created,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.get("/documents/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const document = await prisma.draftDocument.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 20,
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        ok: false,
        error: "Document not found.",
      });
    }

    res.status(200).json({
      ok: true,
      document,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/uploads", async (req: AuthenticatedRequest, res, next) => {
  try {
    const fileName = compact(req.body?.fileName) || "uploaded-format.txt";
    const mimeType = compact(req.body?.mimeType) || "text/plain";
    const text = String(req.body?.text || "").trim();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "text is required.",
      });
    }

    const conversationId = await resolveOwnedConversationId(
      req,
      req.body?.conversationId
    );

    const attachment = await prisma.draftAttachment.create({
      data: {
        userId: req.auth!.userId,
        conversationId,
        templateId: null,
        fileName,
        mimeType,
        storageUrl: `inline://drafting/${Date.now()}/${encodeURIComponent(fileName)}`,
        extractedText: text,
        parsedJson:
          req.body?.parsedJson &&
          typeof req.body.parsedJson === "object" &&
          !Array.isArray(req.body.parsedJson)
            ? req.body.parsedJson
            : null,
      },
    });

    res.status(201).json({
      ok: true,
      attachment,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.get("/uploads", async (req: AuthenticatedRequest, res, next) => {
  try {
    const conversationId = compact(req.query.conversationId);

    const attachments = await prisma.draftAttachment.findMany({
      where: {
        userId: req.auth!.userId,
        ...(conversationId ? { conversationId } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      ok: true,
      attachments,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.get("/uploads/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const attachment = await prisma.draftAttachment.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
      },
    });

    if (!attachment) {
      return res.status(404).json({
        ok: false,
        error: "Upload not found.",
      });
    }

    res.status(200).json({
      ok: true,
      attachment,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/uploads/:id/save-as-template", async (req: AuthenticatedRequest, res, next) => {
  try {
    const attachment = await prisma.draftAttachment.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
      },
    });

    if (!attachment) {
      return res.status(404).json({
        ok: false,
        error: "Upload not found.",
      });
    }

    if (!attachment.extractedText?.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Upload has no extracted text to save as template.",
      });
    }

    if (attachment.templateId) {
      const existingTemplate = await prisma.draftTemplate.findFirst({
        where: {
          id: attachment.templateId,
          ownerUserId: req.auth!.userId,
        },
      });

      return res.status(200).json({
        ok: true,
        template: existingTemplate,
        reused: true,
      });
    }

    const parsed =
      attachment.parsedJson &&
      typeof attachment.parsedJson === "object" &&
      !Array.isArray(attachment.parsedJson)
        ? (attachment.parsedJson as Record<string, unknown>)
        : {};

    const title =
      compact(req.body?.title) ||
      (typeof parsed.title === "string" ? compact(parsed.title) : "") ||
      attachment.fileName;

    const family =
      compact(req.body?.family) ||
      (typeof parsed.family === "string" ? compact(parsed.family) : "") ||
      "misc";

    const subtype =
      compact(req.body?.subtype) ||
      (typeof parsed.subtype === "string" ? compact(parsed.subtype) : "") ||
      null;

    const summary =
      compact(req.body?.summary) ||
      `Template saved from uploaded format: ${attachment.fileName}`;

    const tags = toStringArray(req.body?.tags);

    const template = await prisma.$transaction(async (tx) => {
      const createdTemplate = await tx.draftTemplate.create({
        data: {
          ownerUserId: req.auth!.userId,
          source: "SESSION_UPLOAD",
          title,
          family,
          subtype,
          summary,
          rawText: attachment.extractedText!,
          normalizedText: normalizeText(attachment.extractedText),
          tagsJson: tags,
          useWhenJson: [],
          notForJson: [],
          placeholdersJson: [],
          clauseBlocksJson: [],
          executionRequirementsJson: null,
          riskNotesJson: [],
          sourceRef: attachment.fileName,
          isActive: true,
        },
      });

      await tx.draftAttachment.update({
        where: { id: attachment.id },
        data: {
          templateId: createdTemplate.id,
        },
      });

      return createdTemplate;
    });

    res.status(201).json({
      ok: true,
      template,
      reused: false,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.patch("/documents/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const existing = await prisma.draftDocument.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
      },
      select: {
        id: true,
        draftMarkdown: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "Document not found.",
      });
    }

    const updateData: Record<string, unknown> = {};

    if (req.body?.title !== undefined) updateData.title = compact(req.body.title);
    if (req.body?.family !== undefined) updateData.family = compact(req.body.family) || "misc";
    if (req.body?.subtype !== undefined) updateData.subtype = compact(req.body.subtype) || null;
    if (req.body?.strategy !== undefined) updateData.strategy = compact(req.body.strategy) || null;
    if (req.body?.matchLevel !== undefined) updateData.matchLevel = compact(req.body.matchLevel) || null;

    if (req.body?.draftMarkdown !== undefined) {
      updateData.draftMarkdown =
        typeof req.body.draftMarkdown === "string" ? req.body.draftMarkdown : null;
    }

    if (req.body?.draftHtml !== undefined) {
      updateData.draftHtml =
        typeof req.body.draftHtml === "string" ? req.body.draftHtml : null;
    }

    if (req.body?.editorJson !== undefined) {
      updateData.editorJson =
        req.body.editorJson && typeof req.body.editorJson === "object"
          ? req.body.editorJson
          : null;
    }

    if (req.body?.status !== undefined) {
      updateData.status =
        req.body.status === "FINAL" || req.body.status === "ARCHIVED"
          ? req.body.status
          : "DRAFT";
    }

    if (req.body?.sourceTemplateIds !== undefined) {
      updateData.sourceTemplateIdsJson = Array.isArray(req.body.sourceTemplateIds)
        ? req.body.sourceTemplateIds
        : [];
    }

    if (req.body?.inputData !== undefined) {
      updateData.inputDataJson =
        req.body.inputData && typeof req.body.inputData === "object"
          ? req.body.inputData
          : null;
    }

    if (req.body?.draftingPlan !== undefined) {
      updateData.draftingPlanJson =
        req.body.draftingPlan && typeof req.body.draftingPlan === "object"
          ? req.body.draftingPlan
          : null;
    }

    if (req.body?.unresolvedPlaceholders !== undefined) {
      updateData.unresolvedPlaceholdersJson = Array.isArray(req.body.unresolvedPlaceholders)
        ? req.body.unresolvedPlaceholders
        : [];
    } else {
      const markdownForPlaceholderScan =
        typeof updateData.draftMarkdown === "string"
          ? updateData.draftMarkdown
          : existing.draftMarkdown || "";

      updateData.unresolvedPlaceholdersJson =
        extractUnresolvedPlaceholders(String(markdownForPlaceholderScan || ""));
    }

    const updated = await prisma.draftDocument.update({
      where: { id: existing.id },
      data: updateData,
    });

    res.status(200).json({
      ok: true,
      document: updated,
    });
  } catch (error) {
    next(error);
  }
});

// draftingRouter.post("/documents/:id/versions", async (req: AuthenticatedRequest, res, next) => {
//   try {
//     const document = await prisma.draftDocument.findFirst({
//       where: {
//         id: req.params.id,
//         userId: req.auth!.userId,
//       },
//     });

//     if (!document) {
//       return res.status(404).json({
//         ok: false,
//         error: "Document not found.",
//       });
//     }

//     const latestVersion = await prisma.draftDocumentVersion.findFirst({
//       where: {
//         draftDocumentId: document.id,
//       },
//       orderBy: {
//         versionNumber: "desc",
//       },
//       select: {
//         versionNumber: true,
//       },
//     });

//     const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;

//     const nextTitle =
//       req.body?.title !== undefined ? compact(req.body.title) : document.title;
//     const nextFamily =
//       req.body?.family !== undefined
//         ? compact(req.body.family) || "misc"
//         : document.family;
//     const nextSubtype =
//       req.body?.subtype !== undefined
//         ? compact(req.body.subtype) || null
//         : document.subtype;
//     const nextStrategy =
//       req.body?.strategy !== undefined
//         ? compact(req.body.strategy) || null
//         : document.strategy;
//     const nextMatchLevel =
//       req.body?.matchLevel !== undefined
//         ? compact(req.body.matchLevel) || null
//         : document.matchLevel;

//     const nextSourceTemplateIds =
//       req.body?.sourceTemplateIds !== undefined
//         ? Array.isArray(req.body.sourceTemplateIds)
//           ? req.body.sourceTemplateIds
//           : []
//         : document.sourceTemplateIdsJson;

//     const nextInputData =
//       req.body?.inputData !== undefined
//         ? req.body.inputData && typeof req.body.inputData === "object"
//           ? req.body.inputData
//           : null
//         : document.inputDataJson;

//     const nextDraftingPlan =
//       req.body?.draftingPlan !== undefined
//         ? req.body.draftingPlan && typeof req.body.draftingPlan === "object"
//           ? req.body.draftingPlan
//           : null
//         : document.draftingPlanJson;

//     const nextDraftMarkdown =
//       req.body?.draftMarkdown !== undefined
//         ? typeof req.body.draftMarkdown === "string"
//           ? req.body.draftMarkdown
//           : null
//         : document.draftMarkdown;

//     const nextDraftHtml =
//       req.body?.draftHtml !== undefined
//         ? typeof req.body.draftHtml === "string"
//           ? req.body.draftHtml
//           : null
//         : document.draftHtml;

//     const nextEditorJson =
//       req.body?.editorJson !== undefined
//         ? req.body.editorJson && typeof req.body.editorJson === "object"
//           ? req.body.editorJson
//           : null
//         : document.editorJson;

//     const nextUnresolvedPlaceholders =
//       req.body?.unresolvedPlaceholders !== undefined
//         ? Array.isArray(req.body.unresolvedPlaceholders)
//           ? req.body.unresolvedPlaceholders
//           : []
//         : extractUnresolvedPlaceholders(String(nextDraftMarkdown || ""));

//     const result = await prisma.$transaction(async (tx) => {
//       const version = await tx.draftDocumentVersion.create({
//         data: {
//           draftDocumentId: document.id,
//           versionNumber: nextVersionNumber,
//           title: nextTitle,
//           family: nextFamily,
//           subtype: nextSubtype,
//           strategy: nextStrategy,
//           matchLevel: nextMatchLevel,
//           sourceTemplateIdsJson: nextSourceTemplateIds,
//           inputDataJson: nextInputData,
//           draftingPlanJson: nextDraftingPlan,
//           draftMarkdown: nextDraftMarkdown,
//           draftHtml: nextDraftHtml,
//           editorJson: nextEditorJson,
//           unresolvedPlaceholdersJson: nextUnresolvedPlaceholders,
//           createdByUserId: req.auth!.userId,
//         },
//       });

//       const updatedDocument = await tx.draftDocument.update({
//         where: { id: document.id },
//         data: {
//           title: nextTitle,
//           family: nextFamily,
//           subtype: nextSubtype,
//           strategy: nextStrategy,
//           matchLevel: nextMatchLevel,
//           sourceTemplateIdsJson: nextSourceTemplateIds,
//           inputDataJson: nextInputData,
//           draftingPlanJson: nextDraftingPlan,
//           draftMarkdown: nextDraftMarkdown,
//           draftHtml: nextDraftHtml,
//           editorJson: nextEditorJson,
//           unresolvedPlaceholdersJson: nextUnresolvedPlaceholders,
//           status:
//             req.body?.status === "FINAL" || req.body?.status === "ARCHIVED"
//               ? req.body.status
//               : document.status,
//         },
//       });

//       return { version, document: updatedDocument };
//     });

//     res.status(201).json({
//       ok: true,
//       ...result,
//     });
//   } catch (error) {
//     next(error);
//   }
// });

draftingRouter.post("/documents/:id/regenerate-section", async (req: AuthenticatedRequest, res, next) => {
  try {
    const sectionKey = compact(req.body?.sectionKey);
    const instructions = compact(req.body?.instructions);
    const createVersion = req.body?.createVersion !== false;

    if (!sectionKey) {
      return res.status(400).json({
        ok: false,
        error: "sectionKey is required.",
      });
    }

    const result = await regenerateDraftSection({
      userId: req.auth!.userId,
      documentId: req.params.id,
      sectionKey,
      instructions,
      createVersion,
    });

    res.status(200).json({
      ok: true,
      document: result.document,
      version: result.version,
      regeneratedSection: result.regeneratedSection,
      targetHeading: result.targetHeading,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/documents/:id/versions", async (req: AuthenticatedRequest, res, next) => {
  try {
    const document = await prisma.draftDocument.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
      },
    });

    if (!document) {
      return res.status(404).json({
        ok: false,
        error: "Document not found.",
      });
    }

    const latestVersion = await prisma.draftDocumentVersion.findFirst({
      where: {
        draftDocumentId: document.id,
      },
      orderBy: {
        versionNumber: "desc",
      },
      select: {
        versionNumber: true,
      },
    });

    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;

    const nextTitle =
      req.body?.title !== undefined ? compact(req.body.title) : document.title;
    const nextFamily =
      req.body?.family !== undefined
        ? compact(req.body.family) || "misc"
        : document.family;
    const nextSubtype =
      req.body?.subtype !== undefined
        ? compact(req.body.subtype) || null
        : document.subtype;
    const nextStrategy =
      req.body?.strategy !== undefined
        ? compact(req.body.strategy) || null
        : document.strategy;
    const nextMatchLevel =
      req.body?.matchLevel !== undefined
        ? compact(req.body.matchLevel) || null
        : document.matchLevel;

    const nextSourceTemplateIds =
      req.body?.sourceTemplateIds !== undefined
        ? Array.isArray(req.body.sourceTemplateIds)
          ? req.body.sourceTemplateIds
          : []
        : document.sourceTemplateIdsJson;

    const nextInputData =
      req.body?.inputData !== undefined
        ? req.body.inputData && typeof req.body.inputData === "object"
          ? req.body.inputData
          : null
        : document.inputDataJson;

    const nextDraftingPlan =
      req.body?.draftingPlan !== undefined
        ? req.body.draftingPlan && typeof req.body.draftingPlan === "object"
          ? req.body.draftingPlan
          : null
        : document.draftingPlanJson;

    const nextDraftMarkdown =
      req.body?.draftMarkdown !== undefined
        ? typeof req.body.draftMarkdown === "string"
          ? req.body.draftMarkdown
          : null
        : document.draftMarkdown;

    const nextDraftHtml =
      req.body?.draftHtml !== undefined
        ? typeof req.body.draftHtml === "string"
          ? req.body.draftHtml
          : null
        : document.draftHtml;

    const result = await prisma.$transaction(async (tx) => {
      const version = await tx.draftDocumentVersion.create({
        data: {
          draftDocumentId: document.id,
          versionNumber: nextVersionNumber,
          title: nextTitle,
          family: nextFamily,
          subtype: nextSubtype,
          strategy: nextStrategy,
          matchLevel: nextMatchLevel,
          sourceTemplateIdsJson: nextSourceTemplateIds,
          inputDataJson: nextInputData,
          draftingPlanJson: nextDraftingPlan,
          draftMarkdown: nextDraftMarkdown,
          draftHtml: nextDraftHtml,
          createdByUserId: req.auth!.userId,
        },
      });

      const updatedDocument = await tx.draftDocument.update({
        where: { id: document.id },
        data: {
          title: nextTitle,
          family: nextFamily,
          subtype: nextSubtype,
          strategy: nextStrategy,
          matchLevel: nextMatchLevel,
          sourceTemplateIdsJson: nextSourceTemplateIds,
          inputDataJson: nextInputData,
          draftingPlanJson: nextDraftingPlan,
          draftMarkdown: nextDraftMarkdown,
          draftHtml: nextDraftHtml,
          status:
            req.body?.status === "FINAL" || req.body?.status === "ARCHIVED"
              ? req.body.status
              : document.status,
        },
      });

      return { version, document: updatedDocument };
    });

    res.status(201).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/documents/:id/fill-fields", async (req: AuthenticatedRequest, res, next) => {
  try {
    const document = await prisma.draftDocument.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth!.userId,
      },
    });

    if (!document) {
      return res.status(404).json({
        ok: false,
        error: "Document not found.",
      });
    }

    const values =
      req.body?.values && typeof req.body.values === "object" && !Array.isArray(req.body.values)
        ? (req.body.values as Record<string, string>)
        : null;

    if (!values) {
      return res.status(400).json({
        ok: false,
        error: "values is required.",
      });
    }

    const updatedMarkdown = applyFieldValuesToMarkdown(
      String(document.draftMarkdown || ""),
      values
    );

    const unresolvedPlaceholders = extractUnresolvedPlaceholders(updatedMarkdown);

    const latestVersion = await prisma.draftDocumentVersion.findFirst({
      where: { draftDocumentId: document.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });

    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;
    const createVersion = req.body?.createVersion !== false;

    const result = await prisma.$transaction(async (tx) => {
      const updatedDocument = await tx.draftDocument.update({
        where: { id: document.id },
        data: {
          draftMarkdown: updatedMarkdown,
          editorJson: null,
          unresolvedPlaceholdersJson: unresolvedPlaceholders,
          inputDataJson: {
            ...(document.inputDataJson && typeof document.inputDataJson === "object"
              ? document.inputDataJson
              : {}),
            filledValues: values,
          },
        },
      });

      let version = null;

      if (createVersion) {
        version = await tx.draftDocumentVersion.create({
          data: {
            draftDocumentId: updatedDocument.id,
            versionNumber: nextVersionNumber,
            title: updatedDocument.title,
            family: updatedDocument.family,
            subtype: updatedDocument.subtype,
            strategy: updatedDocument.strategy,
            matchLevel: updatedDocument.matchLevel,
            sourceTemplateIdsJson: updatedDocument.sourceTemplateIdsJson,
            inputDataJson: updatedDocument.inputDataJson,
            draftingPlanJson: updatedDocument.draftingPlanJson,
            draftMarkdown: updatedDocument.draftMarkdown,
            draftHtml: updatedDocument.draftHtml,
            editorJson: updatedDocument.editorJson,
            unresolvedPlaceholdersJson: updatedDocument.unresolvedPlaceholdersJson,
            createdByUserId: req.auth!.userId,
          },
        });
      }

      return { document: updatedDocument, version };
    });

    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/export/pdf", async (req: AuthenticatedRequest, res, next) => {
  try {
    const title = compact(req.body?.title) || "Draft";
    const bodyHtml =
      typeof req.body?.bodyHtml === "string" ? req.body.bodyHtml : "";

    const branding =
      req.body?.branding && typeof req.body.branding === "object"
        ? req.body.branding
        : null;

    if (!bodyHtml.trim()) {
      return res.status(400).json({
        ok: false,
        error: "bodyHtml is required.",
      });
    }

    const pdfBuffer = await generateDraftPdfBuffer({
      title,
      bodyHtml,
      branding,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(title)}.pdf"`
    );

    res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

draftingRouter.post("/export/docx", async (req: AuthenticatedRequest, res, next) => {
  try {
    const title = compact(req.body?.title) || "Draft";
    const bodyHtml =
      typeof req.body?.bodyHtml === "string" ? req.body.bodyHtml : "";

    const branding =
      req.body?.branding && typeof req.body.branding === "object"
        ? req.body.branding
        : null;

    if (!bodyHtml.trim()) {
      return res.status(400).json({
        ok: false,
        error: "bodyHtml is required.",
      });
    }

    const docxBuffer = await generateDraftDocxBuffer({
      title,
      bodyHtml,
      branding,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(title)}.docx"`
    );

    res.status(200).send(docxBuffer);
  } catch (error) {
    next(error);
  }
});

draftingRouter.post(
  "/speech/transcribe",
  speechUpload,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const uploadedFile = (req as any).file as Express.Multer.File | undefined;

      if (!uploadedFile) {
        return res.status(400).json({
          ok: false,
          error: "file is required.",
        });
      }

      if (!uploadedFile.buffer || uploadedFile.buffer.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "Uploaded audio file is empty.",
        });
      }

      const language = compact(req.body?.language) || null;
      const prompt =
        compact(req.body?.prompt) ||
        "This is dictated text for legal drafting. Expect legal terms, names, clauses, notices, agreements, petitions, invoices, breach, indemnity, arbitration, jurisdiction, advocate, affidavit, annexure, plaintiff, defendant, and court-related vocabulary.";

      const result = await transcribeAudioBuffer({
        buffer: uploadedFile.buffer,
        fileName:
          compact(uploadedFile.originalname) || `drafting-voice-${Date.now()}.webm`,
        mimeType: compact(uploadedFile.mimetype) || "audio/webm",
        language,
        prompt,
      });

      return res.status(200).json({
        ok: true,
        text: result.text,
        model: result.model,
        usage: result.usage,
      });
    } catch (error) {
      next(error);
    }
  }
);