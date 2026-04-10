import OpenAI from "openai";
import { materializeTemplateCandidate } from "./templateMaterializer.js";
import { compact } from "./utils.js";
const draftingClient = process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    })
    : null;
function buildConversationContext(messages = []) {
    return messages
        .slice(-8)
        .map((message) => `${message.role.toUpperCase()}: ${compact(message.content)}`)
        .filter(Boolean)
        .join("\n\n");
}
function buildFactsBlock(plan) {
    const entries = Object.entries(plan.extractedFacts || {}).filter(([, value]) => compact(value));
    if (!entries.length)
        return "";
    return entries
        .map(([key, value]) => `- ${key}: ${compact(value)}`)
        .join("\n");
}
function buildFallbackDraft(plan, query) {
    const top = plan.templateCandidates[0];
    if (top) {
        const materialized = materializeTemplateCandidate(top, plan.resolvedQuery || query);
        return materialized.scaffoldMarkdown || top.rawText;
    }
    const familyTitle = plan.detectedFamily?.replace(/_/g, " ") || "draft document";
    if (plan.detectedFamily === "notice") {
        return [
            `# Legal Notice`,
            "",
            `**Sender:** ${plan.extractedFacts.sender_details || "[ADD SENDER DETAILS]"}`,
            `**Recipient:** ${plan.extractedFacts.recipient_details || "[ADD RECIPIENT DETAILS]"}`,
            `**Subject:** ${plan.extractedFacts.subject || "[ADD SUBJECT]"}`,
            "",
            "## Facts",
            plan.extractedFacts.factual_background || compact(plan.resolvedQuery || query) || "[ADD FACTS]",
            "",
            "## Default / Grievance",
            plan.extractedFacts.grievance_or_default || "[ADD DEFAULT / GRIEVANCE]",
            "",
            "## Demand",
            plan.extractedFacts.demands || "[ADD DEMAND]",
            "",
            "## Time for Compliance",
            plan.extractedFacts.deadline || "[ADD DEADLINE]",
            "",
            "## Failing Compliance",
            "[ADD CONSEQUENCE OF NON-COMPLIANCE]",
        ].join("\n");
    }
    return [
        `# ${familyTitle}`,
        "",
        "## Purpose",
        plan.draftingObjective || compact(plan.resolvedQuery || query) || "[ADD PURPOSE]",
        "",
        "## Parties",
        `- Party 1: ${plan.extractedFacts.party_one_details || "[ADD PARTY 1]"}`,
        `- Party 2: ${plan.extractedFacts.party_two_details || "[ADD PARTY 2]"}`,
        "",
        "## Facts",
        plan.extractedFacts.facts || "[ADD FACTS]",
        "",
        "## Operative Terms",
        "[ADD OPERATIVE TERMS]",
    ].join("\n");
}
export async function generateDraftFromPlan(params) {
    const { query, plan, messages = [] } = params;
    const top = plan.templateCandidates[0];
    const secondary = plan.templateCandidates[1];
    const materialized = top ? materializeTemplateCandidate(top, plan.resolvedQuery || query) : null;
    if (!draftingClient) {
        return buildFallbackDraft(plan, query);
    }
    const priorContext = buildConversationContext(messages);
    const factsBlock = buildFactsBlock(plan);
    const strictTemplateMode = !!top &&
        (plan.strategy === "user_format_override" ||
            plan.shouldUseUserAttachmentFirst ||
            top.source === "SESSION_UPLOAD");
    const response = await draftingClient.responses.create({
        model: process.env.OPENAI_DRAFTING_MODEL ||
            process.env.OPENAI_ANSWER_MODEL ||
            "gpt-4.1-mini",
        store: false,
        input: [
            {
                role: "system",
                content: [
                    "You are Drafting Studio, an expert Indian legal drafting assistant.",
                    "Output clean markdown only.",
                    "Do not output commentary before or after the draft.",
                    "Do not invent facts, names, addresses, dates, amounts, courts, timelines, statutory references, or commercial terms.",
                    "If any information is missing, keep explicit placeholders such as [ADD CLIENT ADDRESS] or preserve unresolved placeholders from the provided scaffold.",
                    `The document family is locked to: ${plan.detectedFamily || "misc"}.`,
                    "Do not switch to a different document family unless the user explicitly instructed that change.",
                    strictTemplateMode
                        ? [
                            "The PRIMARY TEMPLATE SCAFFOLD is controlling.",
                            "Preserve its heading order, structure, and overall drafting shape.",
                            "Do not add major new headings or whole new sections unless the user explicitly requested them.",
                            "Start from the scaffold, fill what can be inferred from the user request, and lightly polish language without changing the structure.",
                        ].join(" ")
                        : [
                            "Use the precedent context when available.",
                            "Preserve precedent structure when the match is exact or adjacent.",
                            "If the user's latest turn appears to answer prior intake questions, continue the same drafting path rather than restarting with a different document type.",
                        ].join(" "),
                ].join(" "),
            },
            {
                role: "user",
                content: [
                    `LATEST USER QUERY:\n${compact(query)}`,
                    "",
                    `RESOLVED DRAFTING BRIEF:\n${compact(plan.resolvedQuery || query)}`,
                    "",
                    `DRAFTING PLAN:\n${JSON.stringify({
                        family: plan.detectedFamily,
                        subtype: plan.detectedSubtype,
                        strategy: plan.strategy,
                        matchLevel: plan.matchLevel,
                        tone: plan.preferredTone,
                        objective: plan.draftingObjective,
                    }, null, 2)}`,
                    "",
                    factsBlock ? `STRUCTURED FACTS:\n${factsBlock}` : "",
                    priorContext ? `PRIOR CHAT CONTEXT:\n${priorContext}` : "",
                    materialized
                        ? `PRIMARY TEMPLATE SCAFFOLD (START FROM THIS):\n${materialized.scaffoldMarkdown.slice(0, 18000)}`
                        : "",
                    materialized && materialized.unresolvedPlaceholders.length
                        ? `UNRESOLVED PLACEHOLDERS:\n${materialized.unresolvedPlaceholders
                            .map((item) => `- ${item}`)
                            .join("\n")}`
                        : "",
                    top
                        ? `PRIMARY TEMPLATE REFERENCE\nTitle: ${top.title}\nFamily: ${top.family}\nSubtype: ${top.subtype || ""}\nSummary: ${top.summary}\nTemplate Text:\n${top.rawText.slice(0, 12000)}`
                        : "",
                    !strictTemplateMode && secondary
                        ? `SECONDARY TEMPLATE REFERENCE\nTitle: ${secondary.title}\nFamily: ${secondary.family}\nSubtype: ${secondary.subtype || ""}\nSummary: ${secondary.summary}\nTemplate Text:\n${secondary.rawText.slice(0, 8000)}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n\n"),
            },
        ],
    });
    const text = String(response.output_text || "")
        .replace(/\r\n/g, "\n")
        .trim();
    return text || buildFallbackDraft(plan, query);
}
//# sourceMappingURL=generateDraft.js.map