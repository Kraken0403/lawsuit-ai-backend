import "../config/loadEnv.js";
import sql from "mssql";
import { buildMssqlConfig } from "./mssqlConfig.js";

const globalForSql = globalThis as unknown as {
  sqlPoolPromise?: Promise<sql.ConnectionPool>;
};

const sqlConfig: sql.config = buildMssqlConfig({ primaryPrefix: "SQL" });

export function getSqlPool() {
  if (!globalForSql.sqlPoolPromise) {
    globalForSql.sqlPoolPromise = new sql.ConnectionPool(sqlConfig).connect();
  }

  return globalForSql.sqlPoolPromise;
}

export default sql;
