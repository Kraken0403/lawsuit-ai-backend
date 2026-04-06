import { compact } from "./utils.js";

export type MarkdownSection = {
  heading: string;
  level: number;
  startIndex: number;
  endIndex: number;
  text: string;
};

export function getMarkdownSections(markdown: string): MarkdownSection[] {
  const text = String(markdown || "");
  const lines = text.split("\n");
  const sections: MarkdownSection[] = [];

  let cursor = 0;
  const headings: Array<{
    heading: string;
    level: number;
    lineIndex: number;
    charIndex: number;
  }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push({
        heading: compact(match[2]),
        level: match[1].length,
        lineIndex: i,
        charIndex: cursor,
      });
    }
    cursor += line.length + 1;
  }

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];

    const startIndex = current.charIndex;
    const endIndex = next ? next.charIndex - 1 : text.length;

    sections.push({
      heading: current.heading,
      level: current.level,
      startIndex,
      endIndex,
      text: text.slice(startIndex, endIndex).trim(),
    });
  }

  return sections;
}

export function findSectionByHeading(markdown: string, heading: string): MarkdownSection | null {
  const normalizedTarget = compact(heading).toLowerCase();
  const sections = getMarkdownSections(markdown);

  for (const section of sections) {
    if (compact(section.heading).toLowerCase() === normalizedTarget) {
      return section;
    }
  }

  for (const section of sections) {
    if (compact(section.heading).toLowerCase().includes(normalizedTarget)) {
      return section;
    }
  }

  return null;
}

export function replaceSectionByHeading(
  markdown: string,
  heading: string,
  replacementSectionText: string
): string {
  const original = String(markdown || "");
  const section = findSectionByHeading(original, heading);

  if (!section) {
    return original;
  }

  const before = original.slice(0, section.startIndex);
  const after = original.slice(section.endIndex);

  return `${before}${replacementSectionText.trim()}\n${after}`.trim();
}

export function extractHeadingFromSection(sectionText: string): string | null {
  const firstLine = String(sectionText || "").split("\n")[0] || "";
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(firstLine);
  return match ? compact(match[2]) : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureSameHeadingLevel(originalSection: string, regeneratedSection: string): string {
  const originalFirstLine = String(originalSection || "").split("\n")[0] || "";
  const originalMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(originalFirstLine);

  if (!originalMatch) {
    return String(regeneratedSection || "").trim();
  }

  const targetHashes = originalMatch[1];
  const targetHeading = compact(originalMatch[2]);
  const raw = String(regeneratedSection || "").trim();

  if (!raw) {
    return `${targetHashes} ${targetHeading}`;
  }

  let body = raw;

  const sameLineHeadingRegex = new RegExp(
    `^#{1,6}\\s*${escapeRegExp(targetHeading)}\\s*[:\\-]?\\s*`,
    "i"
  );

  if (sameLineHeadingRegex.test(raw)) {
    body = raw.replace(sameLineHeadingRegex, "").trim();
    return body
      ? `${targetHashes} ${targetHeading}\n\n${body}`.trim()
      : `${targetHashes} ${targetHeading}`;
  }

  const lines = raw.split("\n");
  const firstLine = lines[0].trim();

  const markdownHeadingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(firstLine);
  if (markdownHeadingMatch) {
    const regeneratedHeading = compact(markdownHeadingMatch[2]);

    if (
      regeneratedHeading.toLowerCase() === targetHeading.toLowerCase() ||
      regeneratedHeading.toLowerCase().includes(targetHeading.toLowerCase()) ||
      targetHeading.toLowerCase().includes(regeneratedHeading.toLowerCase())
    ) {
      body = lines.slice(1).join("\n").trim();
      return body
        ? `${targetHashes} ${targetHeading}\n\n${body}`.trim()
        : `${targetHashes} ${targetHeading}`;
    }
  }

  if (firstLine.toLowerCase() === targetHeading.toLowerCase()) {
    body = lines.slice(1).join("\n").trim();
    return body
      ? `${targetHashes} ${targetHeading}\n\n${body}`.trim()
      : `${targetHashes} ${targetHeading}`;
  }

  return `${targetHashes} ${targetHeading}\n\n${raw}`.trim();
}

export function listSectionHeadings(markdown: string): string[] {
  return getMarkdownSections(markdown).map((section) => section.heading);
}

function scoreSectionMatch(section: MarkdownSection, sectionKey: string): number {
  const heading = normalizeSectionHeadingKey(section.heading);
  const target = normalizeSectionHeadingKey(sectionKey);

  if (!heading || !target) return -1;

  if (heading === target) return 100;

  if (heading.startsWith(`${target} `)) return 80;
  if (heading.startsWith(target)) return 70;

  const headingWords = heading.split(" ");
  const targetWords = target.split(" ");
  const prefix = headingWords.slice(0, targetWords.length).join(" ");
  if (prefix === target) return 65;

  if (heading.includes(target)) return 50;
  if (target.includes(heading)) return 30;

  return -1;
}

export function findLooseSectionByText(markdown: string, sectionKey: string): MarkdownSection | null {
  const sections = getMarkdownSections(markdown);

  const ranked = sections
    .map((section) => ({
      section,
      score: scoreSectionMatch(section, sectionKey),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      // prefer deeper headings (## over #) when scores tie
      if (b.section.level !== a.section.level) return b.section.level - a.section.level;

      // then prefer shorter headings
      return a.section.heading.length - b.section.heading.length;
    });

  return ranked[0]?.section || null;
}

export function extractSectionOrFallback(markdown: string, sectionKey: string): MarkdownSection | null {
  const exact = findSectionByHeading(markdown, sectionKey);
  if (exact) return exact;

  return findLooseSectionByText(markdown, sectionKey);
}

export function hasMarkdownHeadings(markdown: string): boolean {
  return /^(#{1,6})\s+/m.test(String(markdown || ""));
}

export function injectSectionAtEnd(markdown: string, heading: string, sectionBody: string): string {
  const clean = String(markdown || "").trim();
  const safeHeading = compact(heading) || "New Section";
  const body = String(sectionBody || "").trim();

  const sectionText = `## ${safeHeading}\n\n${body}`.trim();

  if (!clean) return sectionText;

  return `${clean}\n\n${sectionText}`.trim();
}

export function normalizeSectionHeadingKey(value: string): string {
  return compact(value).toLowerCase().replace(/\s+/g, " ");
}