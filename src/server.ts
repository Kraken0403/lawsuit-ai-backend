import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { chatStreamRouter } from "./routes/chatStream.js";
import { authRouter } from "./routes/auth.js";
import { conversationsRouter } from "./routes/conversations.js";
import { bookmarksRouter } from "./routes/bookmarks.js";
import { casesRouter } from "./routes/cases.js";
const app = express();

const PORT = Number(process.env.PORT || 8787);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  cors({
    origin: FRONTEND_ORIGIN ? FRONTEND_ORIGIN : true,
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: "search-orchestration",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: "search-orchestration",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/bookmarks", bookmarksRouter);
app.use("/api/chat", chatStreamRouter);
app.use("/api/cases", casesRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] Unhandled error:", error);

  res.status(error?.status || 500).json({
    ok: false,
    error: error?.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`search-orchestration server running on http://localhost:${PORT}`);
});