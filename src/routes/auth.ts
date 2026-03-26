import express from "express";
import prisma from "../lib/prisma.js";
import {
  clearSessionCookie,
  createSessionToken,
  getSessionExpiryDate,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  setSessionCookie,
  verifyPassword,
} from "../utils/auth.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

export const authRouter = express.Router();

function getRequestIp(req: express.Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "";
}

async function createUserSession(
  userId: string,
  req: express.Request,
  res: express.Response
) {
  const rawToken = createSessionToken();
  const tokenHash = hashSessionToken(rawToken);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      userAgent: req.headers["user-agent"] || null,
      ipAddress: getRequestIp(req) || null,
      expiresAt: getSessionExpiryDate(),
    },
  });

  setSessionCookie(res, rawToken);
}

authRouter.post("/register", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Email and password are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "Password must be at least 8 characters.",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "An account with this email already exists.",
      });
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    await createUserSession(user.id, req, res);

    res.status(201).json({
      ok: true,
      user,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Email and password are required.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid credentials.",
      });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        ok: false,
        error: "Invalid credentials.",
      });
    }

    await createUserSession(user.id, req, res);

    res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.auth?.sessionId) {
      await prisma.session.update({
        where: { id: req.auth.sessionId },
        data: { revokedAt: new Date() },
      }).catch(() => {});
    }

    clearSessionCookie(res);

    res.status(200).json({
      ok: true,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", optionalAuth, requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({
        ok: false,
        error: "Session is no longer valid.",
      });
    }

    res.status(200).json({
      ok: true,
      user,
    });
  } catch (error) {
    next(error);
  }
});