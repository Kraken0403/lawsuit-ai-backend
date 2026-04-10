import express from "express";
import { optionalAuth, requireAuth, } from "../middleware/auth.js";
import { fetchFullCaseFromQdrant } from "../services/qdrantCaseService.js";
import { fetchFullCaseHtmlFromSql } from "../services/sqlCaseService.js";
import { getOrCreateDetailedCaseSummary } from "../services/caseSummaryService.js";
import { askCaseOnlyChat } from "../services/caseChatService.js";
export const casesRouter = express.Router();
casesRouter.use(optionalAuth);
casesRouter.use(requireAuth);
casesRouter.get("/:caseId/qdrant", async (req, res, next) => {
    try {
        const data = await fetchFullCaseFromQdrant(req.params.caseId);
        res.status(200).json({
            ok: true,
            source: "qdrant",
            case: data,
        });
    }
    catch (error) {
        next(error);
    }
});
casesRouter.get("/:caseId/sql", async (req, res, next) => {
    try {
        const data = await fetchFullCaseHtmlFromSql(req.params.caseId);
        res.status(200).json({
            ok: true,
            source: "sql",
            case: data,
        });
    }
    catch (error) {
        next(error);
    }
});
casesRouter.get("/:caseId", async (req, res, next) => {
    try {
        const caseId = req.params.caseId;
        const [qdrantResult, sqlResult] = await Promise.allSettled([
            fetchFullCaseFromQdrant(caseId),
            fetchFullCaseHtmlFromSql(caseId),
        ]);
        res.status(200).json({
            ok: true,
            caseId,
            qdrant: qdrantResult.status === "fulfilled"
                ? qdrantResult.value
                : { error: qdrantResult.reason?.message || "Qdrant fetch failed" },
            sql: sqlResult.status === "fulfilled"
                ? sqlResult.value
                : { error: sqlResult.reason?.message || "SQL fetch failed" },
        });
    }
    catch (error) {
        next(error);
    }
});
casesRouter.get("/:caseId/summary/detailed", async (req, res, next) => {
    try {
        const result = await getOrCreateDetailedCaseSummary(req.params.caseId);
        res.status(200).json({
            ok: true,
            summaryType: "detailed_v1",
            cached: result.cached,
            summary: result.summary,
        });
    }
    catch (error) {
        next(error);
    }
});
casesRouter.post("/:caseId/chat", async (req, res, next) => {
    try {
        const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
        const messages = rawMessages.map((message) => ({
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
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=cases.js.map