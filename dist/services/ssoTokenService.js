import jwt from "jsonwebtoken";
function toFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function normalizeAllowedCourtsFromArray(value) {
    const courts = [];
    for (const item of value) {
        if (typeof item === "number" || typeof item === "string") {
            const numeric = toFiniteNumber(item);
            if (numeric != null) {
                courts.push({ subid: numeric });
            }
            continue;
        }
        if (!item || typeof item !== "object")
            continue;
        const raw = item;
        const id = toFiniteNumber(raw.id);
        const subid = toFiniteNumber(raw.subid) ?? toFiniteNumber(raw.subId) ?? id;
        const title = typeof raw.title === "string" ? raw.title.trim() : undefined;
        const subtitle = typeof raw.subtitle === "string" ? raw.subtitle.trim() : undefined;
        if (subid == null)
            continue;
        courts.push({
            ...(id != null ? { id } : {}),
            ...(title ? { title } : {}),
            subid,
            ...(subtitle ? { subtitle } : {}),
        });
    }
    return courts;
}
function normalizeAllowedCourts(value) {
    if (Array.isArray(value)) {
        return normalizeAllowedCourtsFromArray(value);
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return [];
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return normalizeAllowedCourtsFromArray(parsed);
                }
            }
            catch {
                // fall through to CSV-style parsing
            }
        }
        return trimmed
            .split(",")
            .map((item) => toFiniteNumber(item))
            .filter((item) => item != null)
            .map((subid) => ({ subid }));
    }
    return [];
}
function uniqueAllowedCourtIds(courts) {
    return [...new Set(courts.map((court) => court.subid).filter((id) => id != null))];
}
function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function deriveExternalUserId(decoded) {
    const subject = normalizeString(decoded.sub);
    if (subject)
        return subject;
    const externalUserId = normalizeString(decoded.externalUserId);
    if (externalUserId)
        return externalUserId;
    const username = normalizeString(decoded.username);
    if (username)
        return username;
    const email = normalizeString(decoded.email).toLowerCase();
    if (email)
        return email;
    return "";
}
export function verifyHs256SsoToken(rawToken) {
    const secret = process.env.SSO_HS256_SECRET;
    const issuer = process.env.SSO_JWT_ISSUER;
    const audience = process.env.SSO_JWT_AUDIENCE;
    if (!secret) {
        throw new Error("Missing env var: SSO_HS256_SECRET");
    }
    if (!issuer) {
        throw new Error("Missing env var: SSO_JWT_ISSUER");
    }
    if (!audience) {
        throw new Error("Missing env var: SSO_JWT_AUDIENCE");
    }
    const decoded = jwt.verify(rawToken, secret, {
        algorithms: ["HS256"],
        issuer,
        audience,
    });
    const externalUserId = deriveExternalUserId(decoded);
    if (!externalUserId) {
        throw new Error("Invalid SSO token: missing sub/externalUserId/username/email.");
    }
    const allowedCourts = normalizeAllowedCourts(decoded.allowedCourtIds);
    return {
        iss: typeof decoded.iss === "string" ? decoded.iss : "",
        aud: typeof decoded.aud === "string"
            ? decoded.aud
            : Array.isArray(decoded.aud)
                ? decoded.aud[0] || ""
                : "",
        sub: normalizeString(decoded.sub) || undefined,
        externalUserId,
        jti: typeof decoded.jti === "string" ? decoded.jti : undefined,
        iat: typeof decoded.iat === "number" ? decoded.iat : undefined,
        nbf: typeof decoded.nbf === "number" ? decoded.nbf : undefined,
        exp: typeof decoded.exp === "number" ? decoded.exp : undefined,
        username: typeof decoded.username === "string" ? decoded.username.trim() : undefined,
        email: typeof decoded.email === "string"
            ? decoded.email.trim().toLowerCase()
            : undefined,
        name: typeof decoded.name === "string" ? decoded.name.trim() : undefined,
        hasAiAccess: typeof decoded.hasAiAccess === "boolean"
            ? decoded.hasAiAccess
            : decoded.hasAiAccess === "true"
                ? true
                : decoded.hasAiAccess === "false"
                    ? false
                    : undefined,
        allowedCourtIds: uniqueAllowedCourtIds(allowedCourts),
        allowedCourts,
        subscriptionStatus: typeof decoded.subscriptionStatus === "string"
            ? decoded.subscriptionStatus
            : undefined,
        tokenVersion: typeof decoded.tokenVersion === "number"
            ? decoded.tokenVersion
            : decoded.tokenVersion != null
                ? Number(decoded.tokenVersion)
                : undefined,
        source: typeof decoded.source === "string" ? decoded.source : undefined,
    };
}
//# sourceMappingURL=ssoTokenService.js.map