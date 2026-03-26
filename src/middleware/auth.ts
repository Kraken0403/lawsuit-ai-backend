import type { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../utils/auth.js";

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    sessionId: string;
  };
};

export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken) return next();

    const tokenHash = hashSessionToken(rawToken);

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!session) return next();
    if (session.revokedAt) return next();
    if (session.expiresAt.getTime() < Date.now()) return next();

    req.auth = {
      userId: session.userId,
      sessionId: session.id,
    };

    void prisma.session
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.auth) {
    return res.status(401).json({
      ok: false,
      error: "Authentication required",
    });
  }

  next();
}