const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_CHUNK_LENGTH = 1600;
const MAX_TOTAL_LENGTH = 450000;
function createHttpError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}
function sleep(ms) {
    return new Promise((resolve) => {
        windowlessSetTimeout(() => resolve(), ms);
    });
}
function windowlessSetTimeout(resolve, ms) {
    return setTimeout(resolve, ms);
}
function normalizeLanguageCode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    const map = {
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
function splitTextIntoChunks(text, maxLength = MAX_CHUNK_LENGTH) {
    const cleanText = String(text || "")
        .replace(/\r/g, "")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
    if (!cleanText)
        return [];
    const chunks = [];
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
function parseGoogleTranslateResponse(payload) {
    const data = payload;
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw createHttpError("Unexpected response from Google Translate.", 502);
    }
    return data[0]
        .map((item) => {
        if (!Array.isArray(item))
            return "";
        return String(item[0] || "");
    })
        .join("")
        .trim();
}
async function translateChunk(params) {
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
            "User-Agent": "Mozilla/5.0 (compatible; LawsuitAI/1.0; +https://lawsuitcasefinder.com)",
        },
    });
    if (!response.ok) {
        throw createHttpError(`Google Translate failed with status ${response.status}.`, 502);
    }
    const payload = await response.json();
    return parseGoogleTranslateResponse(payload);
}
export async function translateWithGoogleFree(params) {
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
    const translatedChunks = [];
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
//# sourceMappingURL=googleTranslateService.js.map