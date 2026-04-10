const QDRANT_URL = (process.env.QDRANT_URL || "").replace(/\/+$/, "");
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const COLLECTION = process.env.QDRANT_COLLECTION || "lawsuit_cases_hybrid";
function compact(value) {
    return String(value ?? "").trim();
}
function toNullableNumber(value) {
    if (value == null || value === "")
        return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}
function toStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}
function getChunkText(payload) {
    return (compact(payload.text) ||
        compact(payload.chunkText) ||
        compact(payload.content) ||
        compact(payload.excerpt) ||
        compact(payload.judgmentText));
}
function buildCaseFilter(caseIdOrFileName) {
    const raw = String(caseIdOrFileName).trim();
    const numeric = Number(raw);
    const values = [raw];
    if (Number.isFinite(numeric)) {
        values.push(numeric);
    }
    return {
        should: [
            ...values.map((value) => ({
                key: "caseId",
                match: { value },
            })),
            ...values.map((value) => ({
                key: "fileName",
                match: { value },
            })),
        ],
    };
}
async function scrollAllCasePoints(caseIdOrFileName) {
    if (!QDRANT_URL) {
        throw new Error("QDRANT_URL is not set.");
    }
    const headers = {
        "Content-Type": "application/json",
    };
    if (QDRANT_API_KEY) {
        headers["api-key"] = QDRANT_API_KEY;
    }
    const filter = buildCaseFilter(caseIdOrFileName);
    const allPoints = [];
    let offset = null;
    for (let i = 0; i < 200; i += 1) {
        const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                filter,
                with_payload: true,
                with_vector: false,
                limit: 256,
                offset,
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Qdrant scroll failed with status ${response.status}: ${text}`);
        }
        const json = await response.json();
        const result = json?.result || {};
        const points = Array.isArray(result.points) ? result.points : [];
        allPoints.push(...points);
        if (!result.next_page_offset || points.length === 0) {
            break;
        }
        offset = result.next_page_offset;
    }
    return allPoints;
}
function dedupeAndSortChunks(points) {
    const seen = new Set();
    const chunks = points
        .map((point) => {
        const payload = point.payload || {};
        const text = getChunkText(payload);
        return {
            pointId: String(point.id ?? ""),
            chunkId: compact(payload.chunkId) ||
                `${compact(payload.fileName)}_${compact(payload.chunkIndex)}`,
            text,
            chunkIndex: toNullableNumber(payload.chunkIndex),
            paragraphStart: toNullableNumber(payload.paragraphStart),
            paragraphEnd: toNullableNumber(payload.paragraphEnd),
            payload,
        };
    })
        .filter((chunk) => chunk.text);
    const unique = chunks.filter((chunk) => {
        const key = `${chunk.chunkId}|${chunk.pointId}|${chunk.text}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    unique.sort((a, b) => {
        const aChunk = a.chunkIndex ?? Number.MAX_SAFE_INTEGER;
        const bChunk = b.chunkIndex ?? Number.MAX_SAFE_INTEGER;
        if (aChunk !== bChunk)
            return aChunk - bChunk;
        const aStart = a.paragraphStart ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.paragraphStart ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart)
            return aStart - bStart;
        const aEnd = a.paragraphEnd ?? Number.MAX_SAFE_INTEGER;
        const bEnd = b.paragraphEnd ?? Number.MAX_SAFE_INTEGER;
        return aEnd - bEnd;
    });
    return unique;
}
export async function fetchFullCaseFromQdrant(caseIdOrFileName) {
    const points = await scrollAllCasePoints(caseIdOrFileName);
    const chunks = dedupeAndSortChunks(points);
    if (!chunks.length) {
        throw new Error(`No Qdrant chunks found for caseId/fileName=${caseIdOrFileName}`);
    }
    const payload = chunks[0].payload || {};
    return {
        caseId: compact(payload.caseId) || String(caseIdOrFileName),
        fileName: compact(payload.fileName) || String(caseIdOrFileName),
        title: compact(payload.title),
        citation: compact(payload.citation),
        court: compact(payload.court),
        dateOfDecision: compact(payload.dateOfDecision),
        judges: toStringArray(payload.judges),
        caseType: compact(payload.caseType),
        caseNo: compact(payload.caseNo),
        subject: compact(payload.subject),
        actsReferred: toStringArray(payload.actsReferred),
        finalDecision: compact(payload.finalDecision),
        equivalentCitations: toStringArray(payload.equivalentCitations),
        advocates: toStringArray(payload.advocates),
        cited: toNullableNumber(payload.cited),
        chunkCount: chunks.length,
        chunks,
        fullText: chunks.map((chunk) => chunk.text).join("\n\n"),
    };
}
//# sourceMappingURL=qdrantCaseService.js.map