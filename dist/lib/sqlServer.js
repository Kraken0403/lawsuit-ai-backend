import sql from "mssql";
const globalForSql = globalThis;
function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set.`);
    }
    return value;
}
const sqlConfig = {
    server: required("SQL_HOST"),
    port: Number(process.env.SQL_PORT || 1433),
    database: required("SQL_DATABASE"),
    user: required("SQL_USER"),
    password: required("SQL_PASSWORD"),
    options: {
        encrypt: process.env.SQL_ENCRYPT === "true",
        trustServerCertificate: process.env.SQL_TRUST_SERVER_CERT === "true",
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },
    requestTimeout: 60000,
    connectionTimeout: 30000,
};
export function getSqlPool() {
    if (!globalForSql.sqlPoolPromise) {
        globalForSql.sqlPoolPromise = new sql.ConnectionPool(sqlConfig).connect();
    }
    return globalForSql.sqlPoolPromise;
}
export default sql;
//# sourceMappingURL=sqlServer.js.map