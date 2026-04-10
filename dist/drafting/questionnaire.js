import { compact } from "./utils.js";
function humanizeField(field) {
    return field
        .replace(/_/g, " ")
        .replace(/\bpoa\b/i, "POA")
        .replace(/\bmsa\b/i, "MSA")
        .replace(/\s+/g, " ")
        .trim();
}
function prettyList(fields) {
    return fields.slice(0, 8).map((field) => `- ${humanizeField(field)}`).join("\n");
}
export function buildClarifyingResponse(plan) {
    const missing = plan.missingFields.slice(0, 8);
    const intro = plan.detectedFamily === "notice"
        ? "I can draft this notice for you."
        : "I can draft this for you.";
    const toneLine = plan.preferredTone && plan.preferredTone !== "neutral"
        ? `I’ll keep the tone ${plan.preferredTone}.`
        : "";
    const objectiveLine = plan.draftingObjective
        ? `Goal: ${compact(plan.draftingObjective)}.`
        : "";
    return [
        intro,
        toneLine,
        objectiveLine,
        "",
        "I just need a few missing details before I generate the first version:",
        "",
        prettyList(missing),
        "",
        "You can reply naturally, or use this format:",
        "",
        "Sender details:",
        "Recipient details:",
        "Invoice number / reference:",
        "Amount due:",
        "Due date / deadline:",
        "Background facts:",
        "What you want demanded:",
        "Tone:",
        "",
        "If some details are not available yet, say “use placeholders” and I’ll still generate the first draft.",
    ]
        .filter(Boolean)
        .join("\n");
}
//# sourceMappingURL=questionnaire.js.map