import sql, { getSqlPool } from "../lib/sqlServer.js";

export type SqlFullCase = {
  caseId: string;
  ftype: string;
  flag: number | null;
  jtext: string;
};

export type SqlCaseReferences = {
  caseId: string;
  html: string;
};

function sanitizeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

export async function fetchFullCaseHtmlFromSql(
  caseId: string | number
): Promise<SqlFullCase> {
  const pool = await getSqlPool();

  const schema = sanitizeIdentifier(process.env.SQL_SCHEMA || "dbo", "SQL_SCHEMA");
  const table = sanitizeIdentifier(process.env.SQL_TABLE || "jtext_data", "SQL_TABLE");

  const rawCaseId = String(caseId).trim();
  const numericCaseId = Number(rawCaseId);
  const isNumeric = Number.isFinite(numericCaseId);

  const request = pool.request();

  if (isNumeric) {
    request.input("caseId", sql.Int, numericCaseId);
  } else {
    request.input("caseId", sql.NVarChar(100), rawCaseId);
  }

  const query = `
    SELECT
      file_name,
      ftype,
      jtext,
      flag
    FROM ${schema}.${table}
    WHERE file_name = @caseId
  `;

  const result = await request.query(query);

  if (!result.recordset.length) {
    throw new Error(`No SQL case found for caseId/file_name=${caseId}`);
  }

  const row = result.recordset[0];

  return {
    caseId: String(row.file_name ?? caseId),
    ftype: String(row.ftype ?? ""),
    flag: row.flag == null ? null : Number(row.flag),
    jtext: String(row.jtext ?? ""),
  };
}

export async function fetchCaseReferencesHtmlFromSql(
  caseId: string | number
): Promise<SqlCaseReferences> {
  const pool = await getSqlPool();
  const schema = sanitizeIdentifier(process.env.SQL_SCHEMA || "dbo", "SQL_SCHEMA");
  const rawCaseId = String(caseId).trim();

  if (!/^\d+$/.test(rawCaseId)) {
    throw new Error(`Invalid caseId/file_name=${caseId}`);
  }

  const result = await pool
    .request()
    .input("caseId", sql.Int, Number(rawCaseId))
    .query(`
      SELECT TOP (1)
        file_name,
        CONVERT(NVARCHAR(MAX), [Text]) AS reference_html
      FROM ${schema}.jtext_data_jref
      WHERE file_name = @caseId
    `);

  return {
    caseId: rawCaseId,
    html: String(result.recordset[0]?.reference_html ?? ""),
  };
}
