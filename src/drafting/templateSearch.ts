import prisma from "../lib/prisma.js";
import type { DraftTemplateCandidate, DocumentFamily } from "./types.js";
import {
  compact,
  normalizeText,
  overlapRatio,
  toStringArray,
  tokenize,
} from "./utils.js";

type SearchInput = {
  userId: string;
  query: string;
  familyHint?: DocumentFamily | null;
  limit?: number;
};

function computeTemplateScore(params: {
  query: string;
  familyHint?: string | null;
  template: {
    title: string;
    family: string;
    subtype: string | null;
    summary: string | null;
    tags: string[];
    normalizedText: string;
  };
}) {
  const { query, familyHint, template } = params;

  const queryNorm = normalizeText(query);
  const queryTokens = tokenize(query);

  const titleNorm = normalizeText(template.title);
  const familyNorm = normalizeText(template.family);
  const subtypeNorm = normalizeText(template.subtype);
  const summaryNorm = normalizeText(template.summary);
  const tagNorm = normalizeText(template.tags.join(" "));
  const bodyNorm = normalizeText(template.normalizedText);

  let score = 0;

  if (titleNorm.includes(queryNorm) && queryNorm.length >= 5) score += 0.42;
  if (subtypeNorm && queryNorm.includes(subtypeNorm)) score += 0.16;
  if (familyHint && familyNorm === familyHint) score += 0.12;

  score += overlapRatio(queryTokens, tokenize(titleNorm)) * 0.20;
  score += overlapRatio(queryTokens, tokenize(summaryNorm)) * 0.10;
  score += overlapRatio(queryTokens, tokenize(tagNorm)) * 0.12;
  score += overlapRatio(queryTokens, tokenize(bodyNorm).slice(0, 300)) * 0.12;

  return Math.min(1, Number(score.toFixed(4)));
}

export async function searchDraftTemplates({
  userId,
  query,
  familyHint,
  limit = 5,
}: SearchInput): Promise<DraftTemplateCandidate[]> {
  const templates = await prisma.draftTemplate.findMany({
    where: {
      isActive: true,
      OR: [
        { source: "SYSTEM" },
        { source: "FIRM", ownerUserId: userId },
        { source: "SESSION_UPLOAD", ownerUserId: userId },
      ],
      ...(familyHint ? { family: familyHint } : {}),
    },
    orderBy: [
      { source: "asc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      source: true,
      title: true,
      family: true,
      subtype: true,
      summary: true,
      tagsJson: true,
      rawText: true,
      normalizedText: true,
      placeholdersJson: true,
      clauseBlocksJson: true,
      precedentStrength: true,
      riskNotesJson: true,
      sourceRef: true,
    },
  });

  return templates
    .map((template) => {
      const tags = toStringArray(template.tagsJson);
      const riskNotes = toStringArray(template.riskNotesJson);
      const normalized = compact(template.normalizedText) || template.rawText;

      const score = computeTemplateScore({
        query,
        familyHint: familyHint || null,
        template: {
          title: template.title,
          family: template.family,
          subtype: template.subtype,
          summary: template.summary,
          tags,
          normalizedText: normalized,
        },
      });

      return {
        id: template.id,
        source: template.source,
        title: template.title,
        family: template.family,
        subtype: template.subtype,
        summary: compact(template.summary),
        tags,
        rawText: template.rawText,
        normalizedText: normalized,
        placeholders: Array.isArray(template.placeholdersJson)
          ? (template.placeholdersJson as Array<Record<string, unknown>>)
          : [],
        clauseBlocks: Array.isArray(template.clauseBlocksJson)
          ? (template.clauseBlocksJson as Array<Record<string, unknown>>)
          : [],
        precedentStrength: template.precedentStrength,
        riskNotes,
        sourceRef: template.sourceRef,
        score,
      } satisfies DraftTemplateCandidate;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}