import prisma from "../lib/prisma.js";
import { compact, normalizeText } from "./utils.js";
export async function loadDraftAttachments(params) {
    const ids = Array.isArray(params.attachmentIds)
        ? params.attachmentIds.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    if (!ids.length) {
        return [];
    }
    const attachments = await prisma.draftAttachment.findMany({
        where: {
            id: { in: ids },
            userId: params.userId,
        },
        select: {
            id: true,
            fileName: true,
            mimeType: true,
            extractedText: true,
            conversationId: true,
            templateId: true,
            parsedJson: true,
        },
    });
    return attachments
        .map((item) => ({
        id: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        extractedText: String(item.extractedText || "").trim(),
        conversationId: item.conversationId,
        templateId: item.templateId,
        parsedJson: item.parsedJson &&
            typeof item.parsedJson === "object" &&
            !Array.isArray(item.parsedJson)
            ? item.parsedJson
            : null,
    }))
        .filter((item) => item.extractedText);
}
export function buildAttachmentTemplateCandidates(params) {
    const { attachments, query, familyHint, directUseRequested } = params;
    const queryNorm = normalizeText(query);
    return attachments.map((attachment, index) => {
        const parsed = attachment.parsedJson || {};
        const parsedTitle = typeof parsed.title === "string" ? compact(parsed.title) : "";
        const parsedFamily = typeof parsed.family === "string" ? compact(parsed.family) : "";
        const parsedSubtype = typeof parsed.subtype === "string" ? compact(parsed.subtype) : "";
        const rawText = attachment.extractedText;
        const normalizedText = normalizeText(rawText);
        let score = directUseRequested ? 1.02 : 0.9;
        if (familyHint &&
            parsedFamily &&
            parsedFamily.toLowerCase() === familyHint.toLowerCase()) {
            score += 0.03;
        }
        if (queryNorm && normalizedText.includes(queryNorm)) {
            score += 0.03;
        }
        return {
            id: attachment.id,
            source: "SESSION_UPLOAD",
            title: parsedTitle || attachment.fileName || `Uploaded format ${index + 1}`,
            family: parsedFamily || familyHint || "misc",
            subtype: parsedSubtype || null,
            summary: `Uploaded format: ${attachment.fileName}`,
            tags: ["uploaded-format"],
            rawText,
            normalizedText,
            placeholders: [],
            clauseBlocks: [],
            precedentStrength: "STANDARD",
            riskNotes: [],
            sourceRef: attachment.fileName,
            score: Number(score.toFixed(4)),
        };
    });
}
//# sourceMappingURL=loadAttachments.js.map