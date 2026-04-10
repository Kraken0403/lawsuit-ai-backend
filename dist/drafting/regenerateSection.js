import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import { compact } from "./utils.js";
import { ensureSameHeadingLevel, extractSectionOrFallback, replaceSectionByHeading, } from "./sectionUtils.js";
const draftingClient = process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    })
    : null;
export async function regenerateDraftSection({ userId, documentId, sectionKey, instructions, createVersion = true, }) {
    const document = await prisma.draftDocument.findFirst({
        where: {
            id: documentId,
            userId,
        },
    });
    if (!document) {
        const error = new Error("Document not found.");
        error.status = 404;
        throw error;
    }
    const draftMarkdown = String(document.draftMarkdown || "").trim();
    if (!draftMarkdown) {
        const error = new Error("Document has no draftMarkdown to regenerate.");
        error.status = 400;
        throw error;
    }
    const targetSection = extractSectionOrFallback(draftMarkdown, sectionKey);
    if (!targetSection) {
        const error = new Error(`Section "${sectionKey}" not found in document.`);
        error.status = 404;
        throw error;
    }
    let regeneratedSection = targetSection.text;
    if (draftingClient) {
        const response = await draftingClient.responses.create({
            model: process.env.OPENAI_DRAFTING_MODEL || process.env.OPENAI_ANSWER_MODEL || "gpt-4.1-mini",
            store: false,
            input: [
                {
                    role: "system",
                    content: [
                        "You are Drafting Studio, an expert Indian legal drafting assistant.",
                        "Regenerate only the requested markdown section.",
                        "Keep the same legal context, same document family, and same section scope.",
                        "Do not rewrite the whole document.",
                        "Do not invent facts beyond what is already present.",
                        "Return only the regenerated markdown section.",
                        "Keep the heading on its own line as markdown.",
                        "Put the section body in following paragraph(s), not on the same line as the heading.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: [
                        `DOCUMENT TITLE:\n${compact(document.title)}`,
                        `DOCUMENT FAMILY:\n${compact(document.family)}`,
                        `DOCUMENT SUBTYPE:\n${compact(document.subtype)}`,
                        "",
                        `FULL DOCUMENT CONTEXT:\n${draftMarkdown.slice(0, 18000)}`,
                        "",
                        `TARGET SECTION KEY:\n${compact(sectionKey)}`,
                        "",
                        `CURRENT SECTION:\n${targetSection.text}`,
                        "",
                        `INSTRUCTIONS:\n${compact(instructions) || "Improve clarity while keeping the same legal meaning and structure."}`,
                    ].join("\n"),
                },
            ],
        });
        regeneratedSection = compact(response.output_text) || targetSection.text;
    }
    regeneratedSection = ensureSameHeadingLevel(targetSection.text, regeneratedSection);
    const updatedMarkdown = replaceSectionByHeading(draftMarkdown, targetSection.heading, regeneratedSection);
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
    const result = await prisma.$transaction(async (tx) => {
        const updatedDocument = await tx.draftDocument.update({
            where: { id: document.id },
            data: {
                draftMarkdown: updatedMarkdown,
            },
        });
        let version = null;
        if (createVersion) {
            version = await tx.draftDocumentVersion.create({
                data: {
                    draftDocumentId: document.id,
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
                    createdByUserId: userId,
                },
            });
        }
        return {
            document: updatedDocument,
            version,
            regeneratedSection,
            targetHeading: targetSection.heading,
        };
    });
    return result;
}
//# sourceMappingURL=regenerateSection.js.map