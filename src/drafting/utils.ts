export function compact(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeText(value: unknown): string {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: unknown): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const v = compact(value);
    if (!v) continue;

    const key = v.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(v);
  }

  return out;
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((item) => (typeof item === "string" ? item : String(item ?? "")))
    );
  }

  if (typeof value === "string") {
    const trimmed = compact(value);
    return trimmed ? [trimmed] : [];
  }

  return [];
}

export function overlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;

  const bSet = new Set(b);
  let matches = 0;

  for (const token of a) {
    if (bSet.has(token)) matches += 1;
  }

  return matches / Math.max(1, a.length);
}