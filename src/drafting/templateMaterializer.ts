import type { DraftTemplateCandidate } from "./types.js";
import { compact } from "./utils.js";

type PlaceholderInfo = {
  raw: string;
  label: string;
  key: string;
};

type MaterializedTemplateResult = {
  scaffoldMarkdown: string;
  unresolvedPlaceholders: string[];
  resolvedValues: Record<string, string>;
  extractedPlaceholders: PlaceholderInfo[];
};

function normalizePlaceholderKey(value: string) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractBracketPlaceholders(rawText: string): PlaceholderInfo[] {
  const text = String(rawText || "");
  const seen = new Set<string>();
  const results: PlaceholderInfo[] = [];

  for (const match of text.matchAll(/\[([^\]\n]{1,120})\]/g)) {
    const raw = match[0];
    const label = compact(match[1]);
    const key = normalizePlaceholderKey(label);
    const dedupeKey = `${label}__${key}`;

    if (!label || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    results.push({
      raw,
      label,
      key,
    });
  }

  return results;
}

function extractBetweenParties(query: string) {
  const match = /between\s+(.+?)\s+and\s+(.+?)(?:(?:\.\s)|(?:,\s)|$)/i.exec(query);
  if (!match) return null;

  return {
    first: compact(match[1]),
    second: compact(match[2]),
  };
}

function looksLikeServiceProvider(name: string) {
  return /\b(studio|solutions|solution|tech|technologies|digital|labs|agency|software|systems|services|design|developers?)\b/i.test(
    String(name || "")
  );
}

function extractLabeledBlock(query: string, label: string, stopLabels: string[]) {
  const labelPattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stopPattern = stopLabels
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const regex = new RegExp(
    `${labelPattern}\\s*:\\s*([\\s\\S]+?)(?=(?:\\.\\s*(?:${stopPattern})\\s*:)|$)`,
    "i"
  );

  const match = regex.exec(query);
  return match ? compact(match[1]) : "";
}

function inferFactsFromQuery(query: string) {
  const text = String(query || "");
  const facts: Record<string, string> = {};

  const parties = extractBetweenParties(text);
  if (parties) {
    const firstLooksProvider = looksLikeServiceProvider(parties.first);
    const secondLooksProvider = looksLikeServiceProvider(parties.second);

    if (firstLooksProvider && !secondLooksProvider) {
      facts.service_provider_name = parties.first;
      facts.client_name = parties.second;
    } else if (!firstLooksProvider && secondLooksProvider) {
      facts.client_name = parties.first;
      facts.service_provider_name = parties.second;
    } else {
      facts.service_provider_name = parties.first;
      facts.client_name = parties.second;
    }

    facts.party_one_name = parties.first;
    facts.party_two_name = parties.second;
  }

  const scope = extractLabeledBlock(text, "Scope", [
    "Fee",
    "Amount",
    "Payment",
    "Start date",
    "Notice period",
    "Term",
    "Timeline",
    "Tone",
  ]);
  if (scope) {
    facts.scope = scope;
    facts.detailed_scope = scope;
    facts.scope_of_services = scope;
  }

  const feeBlock = extractLabeledBlock(text, "Fee", [
    "Start date",
    "Notice period",
    "Timeline",
    "Term",
    "Tone",
  ]);
  if (feeBlock) {
    facts.fee = feeBlock;
    facts.payment_terms = feeBlock;

    const amountMatch = /\brs\.?\s*([\d,]+(?:\.\d+)?)/i.exec(feeBlock);
    if (amountMatch) {
      facts.amount = `Rs. ${amountMatch[1]}`;
      facts.total_fee = `Rs. ${amountMatch[1]}`;
      facts.professional_fee = `Rs. ${amountMatch[1]}`;
    }
  }

  const startDate = extractLabeledBlock(text, "Start date", [
    "Notice period",
    "Timeline",
    "Term",
    "Tone",
  ]);
  if (startDate) {
    facts.start_date = startDate;
    facts.effective_date = startDate;
    facts.date = startDate;
  }

  const noticePeriod = extractLabeledBlock(text, "Notice period", [
    "Timeline",
    "Term",
    "Tone",
  ]);
  if (noticePeriod) {
    facts.notice_period = noticePeriod;
  }

  const tone = extractLabeledBlock(text, "Tone", []);
  if (tone) {
    facts.tone = tone;
  }

  return facts;
}

function unresolvedPlaceholderLabel(label: string) {
  return `[ADD ${compact(label).toUpperCase()}]`;
}

function resolvePlaceholderValue(key: string, label: string, facts: Record<string, string>) {
  const k = normalizePlaceholderKey(key || label);

  const aliasMap: Record<string, string[]> = {
    client_name: ["client_name", "client", "party_2_name", "party_two_name"],
    client_address: ["client_address", "party_2_address", "party_two_address"],
    service_provider_name: [
      "service_provider_name",
      "service_provider",
      "provider_name",
      "party_1_name",
      "party_one_name",
    ],
    service_provider_address: [
      "service_provider_address",
      "provider_address",
      "party_1_address",
      "party_one_address",
    ],
    amount: ["amount", "total_fee", "fee", "professional_fee"],
    payment_terms: ["payment_terms", "payment_schedule", "fee"],
    start_date: ["start_date", "effective_date", "date"],
    date: ["date", "effective_date", "start_date"],
    effective_date: ["effective_date", "date", "start_date"],
    scope: ["scope", "detailed_scope", "scope_of_services"],
    detailed_scope: ["detailed_scope", "scope", "scope_of_services"],
    scope_of_services: ["scope_of_services", "scope", "detailed_scope"],
    notice_period: ["notice_period"],
    timeline: ["timeline", "completion_timeline"],
    city: ["city", "jurisdiction_city"],
  };

  const matchingAlias = Object.entries(aliasMap).find(([, aliases]) =>
    aliases.includes(k)
  );

  if (matchingAlias) {
    const [, aliases] = matchingAlias;
    for (const alias of aliases) {
      if (facts[alias]) return facts[alias];
    }
  }

  if (facts[k]) return facts[k];

  return unresolvedPlaceholderLabel(label);
}

export function materializeTemplateCandidate(
  candidate: DraftTemplateCandidate,
  query: string
): MaterializedTemplateResult {
  const rawText = String(candidate?.rawText || "").trim();
  const extractedPlaceholders = extractBracketPlaceholders(rawText);
  const facts = inferFactsFromQuery(query);
  const unresolved = new Set<string>();

  if (!rawText) {
    return {
      scaffoldMarkdown: "",
      unresolvedPlaceholders: [],
      resolvedValues: facts,
      extractedPlaceholders: [],
    };
  }

  const scaffoldMarkdown = rawText.replace(/\[([^\]\n]{1,120})\]/g, (_full, inner) => {
    const label = compact(inner);
    const key = normalizePlaceholderKey(label);
    const value = resolvePlaceholderValue(key, label, facts);

    if (/^\[ADD .+\]$/.test(value)) {
      unresolved.add(label);
    }

    return value;
  });

  return {
    scaffoldMarkdown,
    unresolvedPlaceholders: Array.from(unresolved),
    resolvedValues: facts,
    extractedPlaceholders,
  };
}