function clean(value) {
    return String(value || "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
}
function readEnv(name) {
    return clean(process.env[name]);
}
function prefixedName(prefix, key) {
    if (prefix === "DATABASE" && key === "DATABASE") {
        return "DATABASE_NAME";
    }
    return `${prefix}_${key}`;
}
function readPrefixed(key, options) {
    return (readEnv(prefixedName(options.primaryPrefix, key)) ||
        (options.fallbackPrefix
            ? readEnv(prefixedName(options.fallbackPrefix, key))
            : ""));
}
function required(value, label) {
    if (!value) {
        throw new Error(`Missing env var: ${label}`);
    }
    return value;
}
function parsePort(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function parseBoolean(value, fallback = false) {
    if (!value)
        return fallback;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
function parseMillis(value, fallback) {
    const parsed = Number(clean(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function readTimeout(primaryName, fallbackName, fallback) {
    return parseMillis(process.env[primaryName] || process.env[fallbackName], fallback);
}
export function getMssqlSchema() {
    return readEnv("DATABASE_SCHEMA") || readEnv("SQL_SCHEMA") || "dbo";
}
export function buildMssqlConfig(options) {
    const serverLabel = `${options.primaryPrefix}_HOST`;
    const databaseLabel = options.primaryPrefix === "DATABASE"
        ? "DATABASE_NAME"
        : `${options.primaryPrefix}_DATABASE`;
    const userLabel = `${options.primaryPrefix}_USER`;
    const passwordLabel = `${options.primaryPrefix}_PASSWORD`;
    const port = parsePort(readPrefixed("PORT", options), options.defaultPort || 1433);
    return {
        server: required(readPrefixed("HOST", options), serverLabel),
        port,
        database: required(readPrefixed("DATABASE", options), databaseLabel),
        user: required(readPrefixed("USER", options), userLabel),
        password: required(readPrefixed("PASSWORD", options), passwordLabel),
        options: {
            encrypt: parseBoolean(readPrefixed("ENCRYPT", options), true),
            trustServerCertificate: parseBoolean(readPrefixed("TRUST_SERVER_CERT", options), true),
        },
        pool: {
            max: parsePort(readEnv("DATABASE_CONNECTION_LIMIT"), 10),
            min: 0,
            idleTimeoutMillis: readTimeout("DATABASE_IDLE_TIMEOUT", "SQL_IDLE_TIMEOUT", 30000),
        },
        requestTimeout: readTimeout("DATABASE_REQUEST_TIMEOUT", "SQL_REQUEST_TIMEOUT", 60000),
        connectionTimeout: readTimeout("DATABASE_CONNECT_TIMEOUT", "SQL_CONNECT_TIMEOUT", 30000),
    };
}
export function cleanConnectionString(value) {
    return clean(value);
}
//# sourceMappingURL=mssqlConfig.js.map