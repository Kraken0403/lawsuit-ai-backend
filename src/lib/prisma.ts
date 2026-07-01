import "../config/loadEnv.js";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaMssql } from "@prisma/adapter-mssql";
import {
  buildMssqlConfig,
  cleanConnectionString,
  getMssqlSchema,
} from "./mssqlConfig.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function buildPrismaAdapter() {
  const rawUrl = cleanConnectionString(process.env.DATABASE_URL);
  const schema = getMssqlSchema();

  if (!rawUrl) {
    return new PrismaMssql(
      buildMssqlConfig({
        primaryPrefix: "DATABASE",
        fallbackPrefix: "SQL",
      }),
      { schema }
    );
  }

  if (!rawUrl.startsWith("sqlserver://")) {
    throw new Error(
      "Invalid DATABASE_URL. This backend now uses SQL Server only; use sqlserver://..."
    );
  }

  return new PrismaMssql(rawUrl, { schema });
}

const adapter = buildPrismaAdapter();

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
