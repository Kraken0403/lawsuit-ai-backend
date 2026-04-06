import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import type { Request } from "express";

export type DraftingAssetKind =
  | "header"
  | "footer"
  | "letterhead"
  | "signature";

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
]);

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const SETTINGS_ASSETS_ROOT = path.join(UPLOADS_ROOT, "settings-assets");

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getExtensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function getUploadsRoot() {
  return UPLOADS_ROOT;
}

export function createDraftingSettingsAssetUpload() {
  const storage = multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const userId = (req as any)?.auth?.userId;
        if (!userId) {
          return cb(new Error("Unauthorized"), "");
        }

        const userDir = path.join(
          SETTINGS_ASSETS_ROOT,
          sanitizeSegment(String(userId))
        );

        await ensureDir(userDir);
        cb(null, userDir);
      } catch (error) {
        cb(error as Error, "");
      }
    },
    filename: (_req, file, cb) => {
      const now = Date.now();
      const random = Math.random().toString(36).slice(2, 10);
      const ext =
        path.extname(file.originalname || "") ||
        getExtensionFromMimeType(file.mimetype) ||
        ".bin";

      cb(null, `${now}-${random}${ext}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
        return cb(
          new Error(
            "Only PNG, JPG, JPEG, WEBP, and SVG images are allowed."
          )
        );
      }

      cb(null, true);
    },
  });
}

export function buildPublicAssetUrl(req: Request, absoluteFilePath: string) {
  const relativeFromUploads = path.relative(UPLOADS_ROOT, absoluteFilePath);
  const normalized = relativeFromUploads.split(path.sep).join("/");

  return `${req.protocol}://${req.get("host")}/uploads/${normalized}`;
}

export function getAbsolutePathFromPublicAssetUrl(urlValue: string | null | undefined) {
  if (!urlValue) return null;

  try {
    const url = new URL(urlValue);
    if (!url.pathname.startsWith("/uploads/")) return null;

    const relativePath = decodeURIComponent(
      url.pathname.replace(/^\/uploads\//, "")
    );

    const absolutePath = path.resolve(UPLOADS_ROOT, relativePath);

    if (!absolutePath.startsWith(UPLOADS_ROOT)) {
      return null;
    }

    return absolutePath;
  } catch {
    return null;
  }
}

export async function deleteLocalAssetByPublicUrl(
  urlValue: string | null | undefined
) {
  const absolutePath = getAbsolutePathFromPublicAssetUrl(urlValue);

  if (!absolutePath) return;

  try {
    await fs.unlink(absolutePath);
  } catch {
    // ignore missing files / unlink issues
  }
}

export function getDraftingSettingsFieldForKind(kind: DraftingAssetKind) {
  switch (kind) {
    case "header":
      return "draftingHeaderImageUrl";
    case "footer":
      return "draftingFooterImageUrl";
    case "letterhead":
      return "draftingLetterheadImageUrl";
    case "signature":
      return "draftingSignatureImageUrl";
    default:
      return null;
  }
}