import { compact } from "./utils.js";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BULLET_ONLY_PLACEHOLDER_RE = /^[\s\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB\.]+$/;

function inferPlaceholderLabel(raw: string, context: string) {
  const trimmed = compact(raw);
  const lower = `${context} ${trimmed}`.toLowerCase();

  if (/(date|dated|day|month|year)/.test(lower)) return "DATE";
  if (/(amount|sum|total|price|fee|cost|consideration|rent)/.test(lower)) return "AMOUNT";
  if (/(email|e-mail|mail id)/.test(lower)) return "EMAIL";
  if (/(phone|mobile|contact|whatsapp|telephone|tel)/.test(lower)) return "PHONE";
  if (/(address|registered office|residence|residential)/.test(lower)) return "ADDRESS";
  if (/(name of|client|customer|buyer|seller|vendor|party|recipient|petitioner|respondent|accused|complainant)/.test(lower)) return "NAME";

  return "DETAILS";
}

export function normalizePlaceholderKey(value: string) {
  return compact(value)
    .toLowerCase()
    .replace(/^add\s+/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeDraftPlaceholders(markdown: string) {
  const source = String(markdown || "");

  return source.replace(/\[([^\]\n]{0,120})\]/g, (match, inner: string, offset: number) => {
    const raw = compact(inner);
    if (!raw) return match;

    if (/^add\s+/i.test(raw)) {
      return `[ADD ${raw.replace(/^add\s+/i, "").trim().toUpperCase()}]`;
    }

    const looksLikeBullet = BULLET_ONLY_PLACEHOLDER_RE.test(raw);
    const looksLikeKeyword = /^(date|amount|name|address|email|phone|mobile|details?)$/i.test(raw);

    if (!looksLikeBullet && !looksLikeKeyword) {
      return match;
    }

    const context = source.slice(Math.max(0, offset - 80), offset);
    const label = looksLikeKeyword ? raw.toUpperCase() : inferPlaceholderLabel(raw, context);
    return `[ADD ${label}]`;
  });
}

export function extractUnresolvedPlaceholders(text: string): string[] {
  const source = normalizeDraftPlaceholders(String(text || ""));
  const found = new Set<string>();

  for (const match of source.matchAll(/\[([^\]\n]{1,120})\]/g)) {
    const raw = compact(match[1]);
    if (!raw) continue;

    if (/^add\s+/i.test(raw)) {
      found.add(normalizePlaceholderKey(raw));
      continue;
    }

    if (/^(date|amount|name|address|email|phone|mobile|details?)$/i.test(raw)) {
      found.add(normalizePlaceholderKey(`ADD ${raw}`));
    }
  }

  return Array.from(found);
}

export function applyFieldValuesToMarkdown(
  markdown: string,
  values: Record<string, string>
) {
  let result = normalizeDraftPlaceholders(String(markdown || ""));

  for (const [key, rawValue] of Object.entries(values || {})) {
    const value = compact(rawValue);
    if (!value) continue;

    const normalizedKey = normalizePlaceholderKey(key);
    const label = normalizedKey.replace(/_/g, " ").toUpperCase();

    const patterns = [
      new RegExp(`\\[ADD\\s+${escapeRegExp(label)}\\]`, "gi"),
      new RegExp(`\\[${escapeRegExp(label)}\\]`, "gi"),
      new RegExp(
        `\\[ADD\\s+${escapeRegExp(
          normalizedKey.replace(/_/g, " ")
        ).replace(/\\s+/g, "\\\\s+")}\\]`,
        "gi"
      ),
    ];

    for (const pattern of patterns) {
      result = result.replace(pattern, value);
    }
  }

  return result;
}
