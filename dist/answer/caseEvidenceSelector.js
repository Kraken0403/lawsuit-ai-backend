function compact(text) {
    return (text || "").replace(/\s+/g, " ").trim();
}
function normalize(text) {
    return compact(text).toLowerCase();
}
function getChunkIndex(chunk) {
    const raw = chunk?.payload?.chunkIndex;
    return typeof raw === "number" ? raw : Number(raw || 0);
}
function getParaStart(chunk) {
    if (chunk?.paragraphStart != null)
        return Number(chunk.paragraphStart);
    const raw = chunk?.payload?.paragraphStart;
    return raw != null ? Number(raw) : 0;
}
function getParaEnd(chunk) {
    if (chunk?.paragraphEnd != null)
        return Number(chunk.paragraphEnd);
    const raw = chunk?.payload?.paragraphEnd;
    return raw != null ? Number(raw) : 0;
}
function makeCitation(group, chunk) {
    return {
        caseId: group.caseId,
        title: group.title,
        citation: group.citation,
        chunkId: chunk?.chunkId || "",
        paragraphStart: chunk?.paragraphStart ?? null,
        paragraphEnd: chunk?.paragraphEnd ?? null,
    };
}
function answerStyle(query) {
    const q = normalize(query);
    if (q.includes("compare") || q.includes("difference between") || q.includes("distinguish")) {
        return "comparison";
    }
    if (q.includes("what did the court hold") ||
        q.includes("what was held") ||
        q.includes("holding") ||
        q.includes("ratio decidendi") ||
        q.includes("ratio")) {
        return "holding";
    }
    if (q.includes("summarize") ||
        q.includes("summarise") ||
        q.includes("summary") ||
        q.includes("brief")) {
        return "summary";
    }
    return "general";
}
function operativeRegex() {
    return /\b(summary of conclusions|conclusions|in the result|result|held|we hold|majority|by majority|operative|order|allowed|dismissed|invalid|valid|upheld|fails|succeeds|basic structure|read down|overruled)\b/i;
}
function issueRegex(query) {
    const q = normalize(query);
    if (q.includes("basic structure")) {
        return /\b(basic structure|article 368|amending power|constitutional amendment)\b/i;
    }
    return /\b(issue|question|challenge|validity|whether|article 368|amendment|fundamental rights|preamble|golak nath|24th amendment|25th amendment|29th amendment)\b/i;
}
function scoreChunk(chunk, query, totalChunks) {
    const style = answerStyle(query);
    const text = chunk?.text || "";
    const idx = getChunkIndex(chunk);
    const paraStart = getParaStart(chunk);
    let score = 0;
    // Intro and tail both matter
    if (idx <= 1)
        score += 10;
    if (idx >= Math.max(0, totalChunks - 5))
        score += 18;
    // Later paras often contain more dispositive material
    score += Math.min(15, paraStart / 180);
    if (style === "holding") {
        if (operativeRegex().test(text))
            score += 65;
        if (issueRegex(query).test(text))
            score += 12;
    }
    else if (style === "summary") {
        if (issueRegex(query).test(text))
            score += 22;
        if (operativeRegex().test(text))
            score += 28;
    }
    else {
        if (issueRegex(query).test(text))
            score += 14;
        if (operativeRegex().test(text))
            score += 18;
    }
    // Slightly reward medium/large substantive chunks
    const len = compact(text).length;
    if (len > 450)
        score += 6;
    if (len > 900)
        score += 4;
    return score;
}
function uniqueChunks(chunks) {
    const seen = new Set();
    const out = [];
    for (const chunk of chunks) {
        const key = String(chunk.chunkId || `${getChunkIndex(chunk)}_${getParaStart(chunk)}`);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(chunk);
        }
    }
    return out;
}
function uniqueCitations(citations) {
    const seen = new Set();
    const out = [];
    for (const c of citations) {
        const key = `${c.caseId}|${c.chunkId}|${c.paragraphStart}|${c.paragraphEnd}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(c);
        }
    }
    return out;
}
export function selectSingleCaseEvidence(group, query) {
    const chunks = Array.isArray(group?.chunks) ? [...group.chunks] : [];
    if (!chunks.length) {
        return {
            selectedChunks: [],
            supportingCitations: [],
        };
    }
    const sorted = [...chunks].sort((a, b) => getChunkIndex(a) - getChunkIndex(b));
    const totalChunks = sorted.length;
    const intro = sorted.slice(0, Math.min(2, sorted.length));
    const tail = sorted.slice(Math.max(0, sorted.length - 4));
    const ranked = sorted
        .map((chunk) => ({
        chunk,
        score: scoreChunk(chunk, query, totalChunks),
    }))
        .sort((a, b) => b.score - a.score);
    const topScored = ranked.slice(0, 14).map((x) => x.chunk);
    const selectedChunks = uniqueChunks([...intro, ...topScored, ...tail]).sort((a, b) => getChunkIndex(a) - getChunkIndex(b));
    const supportingCitations = uniqueCitations(ranked
        .slice(0, 5)
        .map((x) => makeCitation(group, x.chunk)));
    return {
        selectedChunks,
        supportingCitations,
    };
}
export function buildChunkBatches(chunks, maxCharsPerBatch = 9500) {
    const batches = [];
    let current = [];
    let currentChars = 0;
    for (const chunk of chunks) {
        const text = compact(chunk.text || "");
        const paraLabel = chunk.paragraphStart != null && chunk.paragraphEnd != null
            ? `paras ${chunk.paragraphStart}-${chunk.paragraphEnd}`
            : "paras unavailable";
        const rendered = `[${paraLabel}] ${text}`;
        const nextLen = rendered.length + 2;
        if (current.length > 0 && currentChars + nextLen > maxCharsPerBatch) {
            batches.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(chunk);
        currentChars += nextLen;
    }
    if (current.length) {
        batches.push(current);
    }
    return batches;
}
export function citationFromChunk(group, chunk) {
    return makeCitation(group, chunk);
}
//# sourceMappingURL=caseEvidenceSelector.js.map