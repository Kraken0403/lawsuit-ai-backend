import { compactWhitespace } from "../utils/text.js";

export function normalizeQuery(query: string): string {
  return compactWhitespace(query);
}