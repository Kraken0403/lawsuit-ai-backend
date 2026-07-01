import type sql from "mssql";

type EnvPrefix = "DATABASE" | "SQL";

type MssqlConfigOptions = {
  primaryPrefix: EnvPrefix;
  fallbackPrefix?: EnvPrefix;
  defaultPort?: number;
};

function clean(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function readEnv(name: string): string {
  return clean(process.env[name]);
}

type EnvKey =
  | "HOST"
  | "PORT"
  | "DATABASE"
  | "USER"
  | "PASSWORD"
  | "ENCRYPT"
  | "TRUST_SERVER_CERT";

function prefixedName(prefix: EnvPrefix, key: EnvKey): string {
  if (prefix === "DATABASE" && key === "DATABASE") {
    return "DATABASE_NAME";
  }

  return `${prefix}_${key}`;
}

function readPrefixed(key: EnvKey, options: MssqlConfigOptions): string {
  return (
    readEnv(prefixedName(options.primaryPrefix, key)) ||
    (options.fallbackPrefix
      ? readEnv(prefixedName(options.fallbackPrefix, key))
      : "")
  );
}

function required(value: string, label: string): string {
  if (!value) {
    throw new Error(`Missing env var: ${label}`);
  }

  return value;
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string, fallback = false): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseMillis(value: unknown, fallback: number): number {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readTimeout(
  primaryName: string,
  fallbackName: string,
  fallback: number
): number {
  return parseMillis(
    process.env[primaryName] || process.env[fallbackName],
    fallback
  );
}

export function getMssqlSchema(): string {
  return readEnv("DATABASE_SCHEMA") || readEnv("SQL_SCHEMA") || "dbo";
}

export function buildMssqlConfig(options: MssqlConfigOptions): sql.config {
  const serverLabel = `${options.primaryPrefix}_HOST`;
  const databaseLabel =
    options.primaryPrefix === "DATABASE"
      ? "DATABASE_NAME"
      : `${options.primaryPrefix}_DATABASE`;
  const userLabel = `${options.primaryPrefix}_USER`;
  const passwordLabel = `${options.primaryPrefix}_PASSWORD`;

  const port = parsePort(
    readPrefixed("PORT", options),
    options.defaultPort || 1433
  );

  return {
    server: required(readPrefixed("HOST", options), serverLabel),
    port,
    database: required(readPrefixed("DATABASE", options), databaseLabel),
    user: required(readPrefixed("USER", options), userLabel),
    password: required(readPrefixed("PASSWORD", options), passwordLabel),
    options: {
      encrypt: parseBoolean(readPrefixed("ENCRYPT", options), true),
      trustServerCertificate: parseBoolean(
        readPrefixed("TRUST_SERVER_CERT", options),
        true
      ),
    },
    pool: {
      max: parsePort(readEnv("DATABASE_CONNECTION_LIMIT"), 10),
      min: 0,
      idleTimeoutMillis: readTimeout(
        "DATABASE_IDLE_TIMEOUT",
        "SQL_IDLE_TIMEOUT",
        30000
      ),
    },
    requestTimeout: readTimeout(
      "DATABASE_REQUEST_TIMEOUT",
      "SQL_REQUEST_TIMEOUT",
      60000
    ),
    connectionTimeout: readTimeout(
      "DATABASE_CONNECT_TIMEOUT",
      "SQL_CONNECT_TIMEOUT",
      30000
    ),
  };
}

export function cleanConnectionString(value: unknown): string {
  return clean(value);
}
