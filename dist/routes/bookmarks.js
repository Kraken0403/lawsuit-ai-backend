import express from "express";
import prisma from "../lib/prisma.js";
import { optionalAuth, requireAuth, } from "../middleware/auth.js";
export const bookmarksRouter = express.Router();
bookmarksRouter.use(optionalAuth);
bookmarksRouter.use(requireAuth);
function getSingleParam(value) {
    if (Array.isArray(value))
        return value[0] ?? null;
    return value ?? null;
}
function makeFingerprint(title, citation) {
    return `${String(title || "").trim()}|${String(citation || "").trim()}`;
}
bookmarksRouter.get("/cases", async (req, res, next) => {
    try {
        const bookmarks = await prisma.bookmarkedCase.findMany({
            where: {
                userId: req.auth.userId,
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                externalCaseId: true,
                title: true,
                citation: true,
                payloadJson: true,
                createdAt: true,
            },
        });
        res.status(200).json({
            ok: true,
            bookmarks,
        });
    }
    catch (error) {
        next(error);
    }
});
bookmarksRouter.post("/cases", async (req, res, next) => {
    try {
        const title = String(req.body?.title || "").trim();
        const citation = String(req.body?.citation || "").trim();
        const externalCaseId = req.body?.externalCaseId != null
            ? String(req.body.externalCaseId).trim()
            : null;
        const payload = req.body?.payload ?? null;
        if (!title || !citation) {
            return res.status(400).json({
                ok: false,
                error: "Title and citation are required.",
            });
        }
        const fingerprint = makeFingerprint(title, citation);
        const bookmark = await prisma.bookmarkedCase.upsert({
            where: {
                userId_fingerprint: {
                    userId: req.auth.userId,
                    fingerprint,
                },
            },
            update: {
                externalCaseId,
                payloadJson: payload,
            },
            create: {
                userId: req.auth.userId,
                fingerprint,
                externalCaseId,
                title,
                citation,
                payloadJson: payload,
            },
            select: {
                id: true,
                externalCaseId: true,
                title: true,
                citation: true,
                payloadJson: true,
                createdAt: true,
            },
        });
        res.status(201).json({
            ok: true,
            bookmark,
        });
    }
    catch (error) {
        next(error);
    }
});
bookmarksRouter.delete("/cases/:id", async (req, res, next) => {
    try {
        const existing = await prisma.bookmarkedCase.findFirst({
            where: {
                id: req.params.id,
                userId: req.auth.userId,
            },
            select: { id: true },
        });
        if (!existing) {
            return res.status(404).json({
                ok: false,
                error: "Bookmark not found.",
            });
        }
        await prisma.bookmarkedCase.delete({
            where: {
                id: existing.id,
            },
        });
        res.status(200).json({
            ok: true,
        });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=bookmarks.js.map