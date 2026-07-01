import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
const LOADED_ENV_FILE = "__LAWSUIT_AI_LOADED_ENV_FILE";
function resolveEnvPath(filePath) {
    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
}
function envFileCandidates() {
    const explicitEnvFile = process.env.ENV_FILE?.trim();
    if (explicitEnvFile) {
        return [explicitEnvFile];
    }
    if (process.env.NODE_ENV === "production") {
        return [".env.production", ".env"];
    }
    return [".env.local", ".env"];
}
if (!process.env[LOADED_ENV_FILE]) {
    let loadedPath = "";
    for (const candidate of envFileCandidates()) {
        const resolvedPath = resolveEnvPath(candidate);
        if (!fs.existsSync(resolvedPath)) {
            continue;
        }
        dotenv.config({ path: resolvedPath, override: false });
        loadedPath = resolvedPath;
        break;
    }
    process.env[LOADED_ENV_FILE] = loadedPath || "none";
}
function clean(value) {
    return String(value || "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
}
function read(primaryName, fallbackName) {
    return clean(process.env[primaryName]) || clean(fallbackName ? process.env[fallbackName] : "");
}
function setDerivedSqlServerDatabaseUrl() {
    if (clean(process.env.DATABASE_URL)) {
        return;
    }
    const host = read("DATABASE_HOST", "SQL_HOST");
    const port = read("DATABASE_PORT", "SQL_PORT") || "1433";
    const database = read("DATABASE_NAME", "SQL_DATABASE");
    const user = read("DATABASE_USER", "SQL_USER");
    const password = read("DATABASE_PASSWORD", "SQL_PASSWORD");
    if (!host || !database || !user || !password) {
        return;
    }
    const encrypt = read("DATABASE_ENCRYPT", "SQL_ENCRYPT") || "true";
    const trustServerCertificate = read("DATABASE_TRUST_SERVER_CERT", "SQL_TRUST_SERVER_CERT") || "true";
    process.env.DATABASE_URL = [
        `sqlserver://${host}:${port}`,
        `database=${database}`,
        `user=${user}`,
        `password=${password}`,
        `encrypt=${encrypt}`,
        `trustServerCertificate=${trustServerCertificate}`,
    ].join(";");
}
setDerivedSqlServerDatabaseUrl();
function getDatabaseNameFromSqlServerUrl(value) {
    const rawUrl = clean(value);
    if (!rawUrl)
        return "";
    const databaseMatch = rawUrl.match(/(?:^|;)database=([^;]+)/i);
    return clean(databaseMatch?.[1]);
}
function assertDatabaseUrlMatchesDatabaseName() {
    const databaseUrlName = getDatabaseNameFromSqlServerUrl(process.env.DATABASE_URL);
    const databaseName = clean(process.env.DATABASE_NAME);
    if (databaseUrlName &&
        databaseName &&
        databaseUrlName.toLowerCase() !== databaseName.toLowerCase()) {
        throw new Error(`DATABASE_URL database (${databaseUrlName}) does not match DATABASE_NAME (${databaseName}). Refusing to continue.`);
    }
}
assertDatabaseUrlMatchesDatabaseName();
export const loadedEnvFile = process.env[LOADED_ENV_FILE];
//# sourceMappingURL=loadEnv.js.map