const GOOGLE_TRANSLATE_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single";

const MAX_CHUNK_LENGTH = 1600;
const MAX_TOTAL_LENGTH = 450000;

type GoogleTranslateRawResponse = [
  Array<[string, string, unknown, unknown]>,
  string,
  unknown,
  unknown,
  unknown
];

function createHttpError(message: string, status = 400) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function sleep(ms: number) {
  return new Promise((resolve) => windowlessSetTimeout(resolve, ms));
}

function windowlessSetTimeout(resolve: () => void, ms: number) {
  return setTimeout(resolve, ms);
}

function normalizeLanguageCode(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();

  const map: Record<string, string> = {
    english: "en",
    hindi: "hi",
    gujarati: "gu",
    marathi: "mr",
    bengali: "bn",
    tamil: "ta",
    telugu: "te",
    kannada: "kn",
    malayalam: "ml",
    urdu: "ur",
    punjabi: "pa",
    odia: "or",
    oriya: "or",
    sanskrit: "sa",
    french: "fr",
    german: "de",
    spanish: "es",
    arabic: "ar",
    portuguese: "pt",
    russian: "ru",
    chinese: "zh-CN",
    japanese: "ja",
    korean: "ko",
  };

  return map[normalized] || normalized || "hi";
}

function splitTextIntoChunks(text: string, maxLength = MAX_CHUNK_LENGTH) {
  const cleanText = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!cleanText) return [];

  const chunks: string[] = [];
  let remaining = cleanText;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);

    const breakpoints = [
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf("\n"),
      slice.lastIndexOf(". "),
      slice.lastIndexOf("; "),
      slice.lastIndexOf(", "),
      slice.lastIndexOf(" "),
    ].filter((index) => index > Math.floor(maxLength * 0.55));

    const cutAt = breakpoints.length ? Math.max(...breakpoints) + 1 : maxLength;

    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

function parseGoogleTranslateResponse(payload: unknown) {
  const data = payload as GoogleTranslateRawResponse;

  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw createHttpError("Unexpected response from Google Translate.", 502);
  }

  return data[0]
    .map((item) => {
      if (!Array.isArray(item)) return "";
      return String(item[0] || "");
    })
    .join("")
    .trim();
}

async function translateChunk(params: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const url = new URL(GOOGLE_TRANSLATE_ENDPOINT);

  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", params.sourceLanguage || "auto");
  url.searchParams.set("tl", params.targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", params.text);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (compatible; LawsuitAI/1.0; +https://lawsuitcasefinder.com)",
    },
  });

  if (!response.ok) {
    throw createHttpError(
      `Google Translate failed with status ${response.status}.`,
      502
    );
  }

  const payload = await response.json();
  return parseGoogleTranslateResponse(payload);
}

export async function translateWithGoogleFree(params: {
  text: unknown;
  targetLanguage: unknown;
  sourceLanguage?: unknown;
}) {
  const rawText = String(params.text || "").trim();

  if (!rawText) {
    throw createHttpError("Text is required for translation.", 400);
  }

  const truncated = rawText.length > MAX_TOTAL_LENGTH;
  const text = rawText.slice(0, MAX_TOTAL_LENGTH);

  const targetLanguage = normalizeLanguageCode(params.targetLanguage);
  const sourceLanguage = normalizeLanguageCode(params.sourceLanguage || "auto");

  if (!targetLanguage) {
    throw createHttpError("Target language is required.", 400);
  }

  const chunks = splitTextIntoChunks(text);

  if (!chunks.length) {
    throw createHttpError("No translatable text found.", 400);
  }

  const translatedChunks: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const translated = await translateChunk({
      text: chunks[index],
      sourceLanguage,
      targetLanguage,
    });

    translatedChunks.push(translated);

    if (index < chunks.length - 1) {
      await sleep(120);
    }
  }

  return {
    translatedText: translatedChunks.join("\n\n").trim(),
    targetLanguage,
    sourceLanguage,
    chunks: chunks.length,
    truncated,
    originalLength: rawText.length,
    translatedLength: translatedChunks.join("\n\n").trim().length,
  };
}