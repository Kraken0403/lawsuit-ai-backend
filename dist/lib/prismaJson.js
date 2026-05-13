export function toJsonString(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return "";
        }
        try {
            JSON.parse(trimmed);
            return trimmed;
        }
        catch {
            return JSON.stringify(trimmed);
        }
    }
    return JSON.stringify(value ?? null);
}
export function toNullableJsonInput(value) {
    if (value == null) {
        return null;
    }
    return toJsonString(value);
}
export function parseJsonField(value, fallback) {
    if (value == null) {
        return fallback;
    }
    if (typeof value !== "string") {
        return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return fallback;
    }
}
export function parseJsonArray(value) {
    const parsed = parseJsonField(value, []);
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed;
}
//# sourceMappingURL=prismaJson.js.map