import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import { fetchFullCaseFromQdrant } from "./qdrantCaseService.js";
import { buildCanonicalCaseTextFromQdrant } from "./canonicalCaseText.js";

export type DetailedSummarySections = {
  overview: string;
  facts: string;
  proceduralHistory: string;
  issues: string[];
  holding: string;
  reasoning: string;
  statutesAndArticles: string[];
  precedentsDiscussed: string[];
  finalDisposition: string;
  bench: string[];
  keyTakeaways: string[];
};

const SUMMARY_TYPE = "detailed_v1";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

function buildSummarySchema() {
  return {
    name: "case_summary_detailed_v1",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        overview: { type: "string" },
        facts: { type: "string" },
        proceduralHistory: { type: "string" },
        issues: {
          type: "array",
          items: { type: "string" },
        },
        holding: { type: "string" },
        reasoning: { type: "string" },
        statutesAndArticles: {
          type: "array",
          items: { type: "string" },
        },
        precedentsDiscussed: {
          type: "array",
          items: { type: "string" },
        },
        finalDisposition: { type: "string" },
        bench: {
          type: "array",
          items: { type: "string" },
        },
        keyTakeaways: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "overview",
        "facts",
        "proceduralHistory",
        "issues",
        "holding",
        "reasoning",
        "statutesAndArticles",
        "precedentsDiscussed",
        "finalDisposition",
        "bench",
        "keyTakeaways",
      ],
    },
  };
}

function renderDetailedSummaryMarkdown(
  meta: {
    title?: string;
    citation?: string;
    court?: string;
    dateOfDecision?: string;
  },
  sections: DetailedSummarySections
) {
  const lines: string[] = [];

  if (meta.title) lines.push(`# ${meta.title}`);
  if (meta.citation) lines.push(`**Citation:** ${meta.citation}`);
  if (meta.court) lines.push(`**Court:** ${meta.court}`);
  if (meta.dateOfDecision) lines.push(`**Date of Decision:** ${meta.dateOfDecision}`);
  lines.push("");

  lines.push("## Overview");
  lines.push(sections.overview || "");
  lines.push("");

  lines.push("## Facts");
  lines.push(sections.facts || "");
  lines.push("");

  lines.push("## Procedural History");
  lines.push(sections.proceduralHistory || "");
  lines.push("");

  lines.push("## Issues");
  for (const item of sections.issues || []) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Holding");
  lines.push(sections.holding || "");
  lines.push("");

  lines.push("## Reasoning");
  lines.push(sections.reasoning || "");
  lines.push("");

  lines.push("## Statutes and Articles");
  for (const item of sections.statutesAndArticles || []) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Precedents Discussed");
  for (const item of sections.precedentsDiscussed || []) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Final Disposition");
  lines.push(sections.finalDisposition || "");
  lines.push("");

  lines.push("## Bench");
  for (const item of sections.bench || []) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Key Takeaways");
  for (const item of sections.keyTakeaways || []) {
    lines.push(`- ${item}`);
  }

  return lines.join("\n");
}

async function generateDetailedSummarySectionsFromText(input: {
  title: string;
  citation: string;
  court: string;
  dateOfDecision: string;
  judges: string[];
  caseType: string;
  caseNo: string;
  subject: string;
  actsReferred: string[];
  finalDecision: string;
  text: string;
}) {
  const model =
    process.env.CASE_SUMMARY_MODEL ||
    process.env.OPENAI_ANSWER_MODEL ||
    "gpt-5-mini";

  const developerPrompt = [
    "You are generating a detailed Indian case-law summary.",
    "Return only valid JSON matching the provided schema.",
    "Do not invent facts not grounded in the supplied case text and metadata.",
    "Keep the summary practical, legally useful, and clearly sectioned.",
    "If some detail is unavailable, return an empty string or empty array.",
  ].join(" ");

  const userPrompt = [
    `Title: ${input.title}`,
    `Citation: ${input.citation}`,
    `Court: ${input.court}`,
    `Date of Decision: ${input.dateOfDecision}`,
    `Judges: ${input.judges.join(", ")}`,
    `Case Type: ${input.caseType}`,
    `Case Number: ${input.caseNo}`,
    `Subject: ${input.subject}`,
    `Acts Referred: ${input.actsReferred.join(", ")}`,
    `Final Decision: ${input.finalDecision}`,
    "",
    "Generate a detailed structured legal summary for the following case text:",
    "",
    input.text,
  ].join("\n");

  const response = await openai.chat.completions.create({
    model,
    response_format: {
      type: "json_schema",
      json_schema: buildSummarySchema(),
    },
    messages: [
      {
        role: "developer",
        content: developerPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || "{}";
  const sections = JSON.parse(content) as DetailedSummarySections;

  return {
    model,
    sections,
  };
}

export async function getLatestDetailedCaseSummary(caseId: string | number) {
  return prisma.caseSummary.findFirst({
    where: {
      caseId: String(caseId),
      summaryType: SUMMARY_TYPE,
      status: "ready",
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getOrCreateDetailedCaseSummary(caseId: string | number) {
  const fullCase = await fetchFullCaseFromQdrant(caseId);
  const canonical = buildCanonicalCaseTextFromQdrant(fullCase);

  const existing = await prisma.caseSummary.findFirst({
    where: {
      caseId: canonical.caseId,
      summaryType: SUMMARY_TYPE,
      sourceHash: canonical.sourceHash,
      status: "ready",
    },
  });

  if (existing) {
    return {
      cached: true,
      summary: existing,
    };
  }

  const { model, sections } = await generateDetailedSummarySectionsFromText({
    title: fullCase.title,
    citation: fullCase.citation,
    court: fullCase.court,
    dateOfDecision: fullCase.dateOfDecision,
    judges: fullCase.judges,
    caseType: fullCase.caseType,
    caseNo: fullCase.caseNo,
    subject: fullCase.subject,
    actsReferred: fullCase.actsReferred,
    finalDecision: fullCase.finalDecision,
    text: canonical.text,
  });

  const renderedMarkdown = renderDetailedSummaryMarkdown(
    {
      title: fullCase.title,
      citation: fullCase.citation,
      court: fullCase.court,
      dateOfDecision: fullCase.dateOfDecision,
    },
    sections
  );

  const saved = await prisma.caseSummary.create({
    data: {
      caseId: canonical.caseId,
      fileName: canonical.fileName,
      title: fullCase.title || null,
      citation: fullCase.citation || null,
      summaryType: SUMMARY_TYPE,
      sourceType: "qdrant",
      sourceHash: canonical.sourceHash,
      modelName: model,
      status: "ready",
      sectionsJson: sections as unknown as object,
      renderedMarkdown,
    },
  });

  return {
    cached: false,
    summary: saved,
  };
}