import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaMssql } from "@prisma/adapter-mssql";
const globalForPrisma = globalThis;
const adapter = new PrismaMssql({
    server: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 1433),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    options: {
        encrypt: process.env.SQL_ENCRYPT === "true",
        trustServerCertificate: process.env.SQL_TRUST_SERVER_CERT === "true",
    },
});
const prisma = globalForPrisma.prisma ??
    new PrismaClient({
        adapter,
        log: ["warn", "error"],
    });
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
export default prisma;
//# sourceMappingURL=prisma.js.map