import "../config/loadEnv.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import { buildMssqlConfig, getMssqlSchema } from "../lib/mssqlConfig.js";

const CONFIRM_VALUE = "REPLACE_MSSQL_APP_SCHEMA";

const APP_TABLES = [
  "assistant_message_feedback",
  "suggested_case_feedback",
  "draft_document_versions",
  "draft_attachments",
  "draft_documents",
  "draft_templates",
  "firm_settings",
  "casesummary",
  "prompt_runs",
  "bookmarked_cases",
  "messages",
  "conversations",
  "sessions",
  "users",
  "_prisma_migrations",
];

function quoteSqlString(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `[${value.replace(/]/g, "]]")}]`;
}

function sanitizeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return value;
}

async function dropPrismaManagedTables(pool: sql.ConnectionPool, schema: string) {
  const tableList = APP_TABLES.map(quoteSqlString).join(", ");

  await pool
    .request()
    .input("schema", sql.NVarChar(128), schema)
    .query(`
      DECLARE @sql nvarchar(max) = N'';

      SELECT @sql = @sql +
        N'ALTER TABLE ' +
        QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) +
        N'.' +
        QUOTENAME(OBJECT_NAME(parent_object_id)) +
        N' DROP CONSTRAINT ' +
        QUOTENAME(name) +
        N';' + CHAR(13)
      FROM sys.foreign_keys
      WHERE OBJECT_SCHEMA_NAME(parent_object_id) = @schema
        AND (
          OBJECT_NAME(parent_object_id) IN (${tableList})
          OR OBJECT_NAME(referenced_object_id) IN (${tableList})
        );

      IF @sql <> N''
      BEGIN
        EXEC sp_executesql @sql;
      END
    `);

  for (const table of APP_TABLES) {
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    await pool.request().query(`
      IF OBJECT_ID(N'${schema.replace(/'/g, "''")}.${table.replace(/'/g, "''")}', N'U') IS NOT NULL
      BEGIN
        DROP TABLE ${qualifiedTable};
      END
    `);
  }
}

function runPrismaDbPush() {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".."
  );
  const prismaCli = path.join(
    rootDir,
    "node_modules",
    "prisma",
    "build",
    "index.js"
  );

  const result = spawnSync(
    process.execPath,
    [prismaCli, "db", "push", "--accept-data-loss"],
    {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PRISMA_HIDE_UPDATE_MESSAGE: "true",
      },
    }
  );

  if (result.status !== 0) {
    throw new Error(`prisma db push failed with exit code ${result.status}`);
  }
}

async function main() {
  if (process.env.CONFIRM_REPLACE_MSSQL_SCHEMA !== CONFIRM_VALUE) {
    throw new Error(
      `Refusing to replace MSSQL app schema. Re-run with CONFIRM_REPLACE_MSSQL_SCHEMA=${CONFIRM_VALUE}.`
    );
  }

  const schema = sanitizeIdentifier(getMssqlSchema(), "DATABASE_SCHEMA");
  const config = buildMssqlConfig({
    primaryPrefix: "DATABASE",
    fallbackPrefix: "SQL",
  });

  console.log("[mssql-schema] Target", {
    server: config.server,
    port: config.port,
    database: config.database,
    schema,
    managedTables: APP_TABLES.filter((table) => table !== "_prisma_migrations")
      .length,
  });

  const pool = await new sql.ConnectionPool(config).connect();

  try {
    await dropPrismaManagedTables(pool, schema);
  } finally {
    await pool.close();
  }

  runPrismaDbPush();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
