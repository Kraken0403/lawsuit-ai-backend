export function compactWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
  
  export function truncate(text: string, maxLen = 420): string {
    const clean = compactWhitespace(text);
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen).trimEnd()}...`;
  }
  
  export function splitIntoSentences(text: string): string[] {
    return text
      .split(/(?<=[.?!])\s+/)
      .map((s) => compactWhitespace(s))
      .filter(Boolean);
  }
  
  export function firstUsefulSentence(text: string): string {
    const sentences = splitIntoSentences(text);
    for (const s of sentences) {
      if (s.length >= 40) return s;
    }
    return truncate(text, 240);
  }
  
  export function displayCaseTitle(title: string | null | undefined): string {
    if (!title) return "Unknown case";
    return truncate(compactWhitespace(title), 180);
  }