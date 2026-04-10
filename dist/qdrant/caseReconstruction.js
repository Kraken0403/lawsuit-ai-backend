import { qdrant } from "./client.js";
import { env } from "../config/env.js";
const FULL_CASE_MAX_CHUNKS = Number.MAX_SAFE_INTEGER;
const caseChunkCache = new Map();
function buildCacheKey(caseId, maxChunks, pageSize) {
    return `${caseId}:${maxChunks}:${pageSize}`;
}
function getFullCaseCacheKey(caseId) {
    return buildCacheKey(caseId, FULL_CASE_MAX_CHUNKS, 1000);
}
function sortChunks(a, b) {
    const ai = Number(a.payload?.chunkIndex ?? 0);
    const bi = Number(b.payload?.chunkIndex ?? 0);
    if (ai !== bi)
        return ai - bi;
    const ap = a.paragraphStart != null ? Number(a.paragraphStart) : 0;
    const bp = b.paragraphStart != null ? Number(b.paragraphStart) : 0;
    if (ap !== bp)
        return ap - bp;
    const ae = a.paragraphEnd != null ? Number(a.paragraphEnd) : 0;
    const be = b.paragraphEnd != null ? Number(b.paragraphEnd) : 0;
    return ae - be;
}
function toChunkHit(caseId, point) {
    return {
        id: point.id,
        score: 0,
        caseId,
        chunkId: String(point.payload?.chunkId || ""),
        title: point.payload?.title ? String(point.payload.title) : null,
        citation: point.payload?.citation ? String(point.payload.citation) : null,
        paragraphStart: point.payload?.paragraphStart != null ? Number(point.payload.paragraphStart) : null,
        paragraphEnd: point.payload?.paragraphEnd != null ? Number(point.payload.paragraphEnd) : null,
        text: String(point.payload?.text || ""),
        payload: point.payload || {},
    };
}
async function fetchCaseChunks(caseId, opts = {}) {
    if (!Number.isFinite(caseId) || caseId <= 0) {
        return [];
    }
    const maxChunks = typeof opts.maxChunks === "number" && Number.isFinite(opts.maxChunks)
        ? Math.max(1, Math.floor(opts.maxChunks))
        : FULL_CASE_MAX_CHUNKS;
    const pageSize = typeof opts.pageSize === "number" && Number.isFinite(opts.pageSize)
        ? Math.max(10, Math.min(Math.floor(opts.pageSize), 1000))
        : 250;
    const cacheKey = buildCacheKey(caseId, maxChunks, pageSize);
    const cached = caseChunkCache.get(cacheKey);
    if (cached)
        return cached;
    const fullCached = caseChunkCache.get(getFullCaseCacheKey(caseId));
    if (fullCached) {
        const sliced = fullCached.slice(0, maxChunks);
        caseChunkCache.set(cacheKey, sliced);
        return sliced;
    }
    const allPoints = [];
    let offset = undefined;
    const seenOffsets = new Set();
    while (allPoints.length < maxChunks) {
        const response = await qdrant.scroll(env.qdrant.collection, {
            filter: {
                must: [
                    {
                        key: "caseId",
                        match: { value: caseId },
                    },
                ],
            },
            limit: Math.min(pageSize, maxChunks - allPoints.length),
            with_payload: true,
            with_vector: false,
            offset,
        });
        const points = response.points || [];
        if (!points.length)
            break;
        allPoints.push(...points);
        if (!response.next_page_offset)
            break;
        const nextOffset = String(response.next_page_offset);
        if (seenOffsets.has(nextOffset))
            break;
        seenOffsets.add(nextOffset);
        offset = response.next_page_offset;
    }
    const chunks = allPoints.map((point) => toChunkHit(caseId, point)).sort(sortChunks);
    caseChunkCache.set(cacheKey, chunks);
    if (maxChunks === FULL_CASE_MAX_CHUNKS) {
        caseChunkCache.set(getFullCaseCacheKey(caseId), chunks);
    }
    return chunks;
}
export async function fetchPreviewChunksForCase(caseId, maxChunks = 24) {
    const safeMax = Number.isFinite(maxChunks) ? Math.max(1, Math.floor(maxChunks)) : 24;
    return fetchCaseChunks(caseId, {
        maxChunks: safeMax,
        pageSize: Math.min(200, safeMax),
    });
}
export async function fetchAllChunksForCase(caseId) {
    return fetchCaseChunks(caseId, {
        maxChunks: FULL_CASE_MAX_CHUNKS,
        pageSize: 1000,
    });
}
export function clearCaseChunkCache(caseId) {
    if (typeof caseId === "number" && Number.isFinite(caseId)) {
        for (const key of [...caseChunkCache.keys()]) {
            if (key.startsWith(`${caseId}:`)) {
                caseChunkCache.delete(key);
            }
        }
        return;
    }
    caseChunkCache.clear();
}
//# sourceMappingURL=caseReconstruction.js.map