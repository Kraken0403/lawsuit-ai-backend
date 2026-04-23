import express from "express";
import prisma from "../lib/prisma.js";
import { clearSessionCookie, createSessionToken, getSessionExpiryDate, hashPassword, hashSessionToken, normalizeEmail, setSessionCookie, verifyPassword, } from "../utils/auth.js";
import { optionalAuth, requireAuth, } from "../middleware/auth.js";
import { verifyHs256SsoToken } from "../services/ssoTokenService.js";
import { normalizeAllowedCourts } from "../utils/allowedCourts.js";
export const authRouter = express.Router();
const LOCAL_AUTH_DISABLED = process.env.DISABLE_LOCAL_AUTH !== "false";
authRouter.get("/dev-sso-page", (req, res) => {
    if (process.env.NODE_ENV === "production") {
        return res.status(404).send("Not found");
    }
    res.type("html").send(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Local SSO Login</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #f8fafc;
        margin: 0;
        padding: 40px;
      }
      .wrap {
        max-width: 900px;
        margin: 0 auto;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      }
      h1 {
        margin-top: 0;
        font-size: 24px;
      }
      p {
        color: #475569;
      }
      textarea {
        width: 100%;
        min-height: 260px;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 12px;
        font-family: monospace;
        font-size: 13px;
        box-sizing: border-box;
        resize: vertical;
      }
      button {
        margin-top: 16px;
        background: #0f172a;
        color: white;
        border: 0;
        border-radius: 12px;
        padding: 12px 18px;
        font-size: 14px;
        cursor: pointer;
      }
      button:hover {
        background: #1e293b;
      }
      .hint {
        margin-top: 16px;
        font-size: 13px;
        color: #64748b;
      }
      code {
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Local SSO Login</h1>
      <p>Paste the generated JWT below and submit it to the backend SSO route.</p>

      <form method="POST" action="/api/auth/sso-login">
        <textarea name="token" placeholder="Paste SSO JWT here"></textarea>
        <br />
        <button type="submit">Login with SSO</button>
      </form>

      <div class="hint">
        Backend: <code>http://localhost:8787</code><br />
        Frontend redirect should point to: <code>http://localhost:5173</code>
      </div>
    </div>
  </body>
</html>
  `);
});
function getRequestIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "";
}
async function createUserSession(userId, req, res) {
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
authRouter.post("/sso-login", async (req, res, next) => {
    try {
        const rawToken = String(req.body?.token || "").trim();
        if (!rawToken) {
            return res.status(400).json({
                ok: false,
                error: "SSO token is required.",
            });
        }
        const claims = verifyHs256SsoToken(rawToken);
        if (!claims.externalUserId) {
            return res.status(401).json({
                ok: false,
                error: "Invalid SSO token identity.",
            });
        }
        if (claims.hasAiAccess === false) {
            return res.status(403).json({
                ok: false,
                error: "AI access is not enabled for this user.",
            });
        }
        if (!claims.allowedCourtIds || claims.allowedCourtIds.length === 0) {
            return res.status(403).json({
                ok: false,
                error: "No courts are assigned for this user.",
            });
        }
        const externalUserId = claims.externalUserId;
        const email = normalizeEmail(claims.email || "");
        const username = claims.username || null;
        const name = claims.name || null;
        const subscriptionStatus = claims.subscriptionStatus || "active";
        const hasAiAccess = claims.hasAiAccess ?? true;
        const allowedCourtIds = claims.allowedCourtIds;
        const allowedCourtsPayload = claims.allowedCourts.length > 0 ? claims.allowedCourts : allowedCourtIds;
        const fallbackEmail = email || null;
        const user = await prisma.$transaction(async (tx) => {
            const existingByExternal = await tx.user.findUnique({
                where: { externalUserId },
                select: { id: true, email: true },
            });
            if (existingByExternal) {
                return tx.user.update({
                    where: { id: existingByExternal.id },
                    data: {
                        authProvider: "casefinder_hs256",
                        username,
                        email: fallbackEmail ?? existingByExternal.email ?? null,
                        name,
                        hasAiAccess,
                        subscriptionStatus,
                        allowedCourtIdsJson: allowedCourtsPayload,
                    },
                    select: { id: true },
                });
            }
            if (username) {
                const existingByUsername = await tx.user.findFirst({
                    where: { username },
                    select: { id: true },
                });
                if (existingByUsername) {
                    return tx.user.update({
                        where: { id: existingByUsername.id },
                        data: {
                            externalUserId,
                            authProvider: "casefinder_hs256",
                            username,
                            email: fallbackEmail,
                            name,
                            hasAiAccess,
                            subscriptionStatus,
                            allowedCourtIdsJson: allowedCourtsPayload,
                        },
                        select: { id: true },
                    });
                }
            }
            if (fallbackEmail) {
                const existingByEmail = await tx.user.findUnique({
                    where: { email: fallbackEmail },
                    select: { id: true },
                });
                if (existingByEmail) {
                    return tx.user.update({
                        where: { id: existingByEmail.id },
                        data: {
                            externalUserId,
                            authProvider: "casefinder_hs256",
                            username,
                            name,
                            hasAiAccess,
                            subscriptionStatus,
                            allowedCourtIdsJson: allowedCourtsPayload,
                        },
                        select: { id: true },
                    });
                }
            }
            return tx.user.create({
                data: {
                    externalUserId,
                    authProvider: "casefinder_hs256",
                    username,
                    email: fallbackEmail,
                    name,
                    passwordHash: null,
                    hasAiAccess,
                    subscriptionStatus,
                    allowedCourtIdsJson: allowedCourtsPayload,
                },
                select: { id: true },
            });
        });
        await createUserSession(user.id, req, res);
        const successRedirect = process.env.SSO_LOGIN_SUCCESS_REDIRECT ||
            process.env.FRONTEND_ORIGIN ||
            "/";
        return res.redirect(302, successRedirect);
    }
    catch (error) {
        if (error?.name === "JsonWebTokenError" ||
            error?.name === "TokenExpiredError" ||
            error?.name === "NotBeforeError") {
            return res.status(401).json({
                ok: false,
                error: "Invalid or expired SSO token.",
            });
        }
        next(error);
    }
});
authRouter.post("/register", async (req, res, next) => {
    try {
        if (LOCAL_AUTH_DISABLED) {
            return res.status(403).json({
                ok: false,
                error: "Direct registration is disabled. Please use SSO from LawSuit Case Finder.",
            });
        }
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
                authProvider: "local",
            },
            select: {
                id: true,
                email: true,
                name: true,
                creditsRemaining: true,
                createdAt: true,
            },
        });
        await createUserSession(user.id, req, res);
        res.status(201).json({
            ok: true,
            user,
        });
    }
    catch (error) {
        next(error);
    }
});
authRouter.post("/login", async (req, res, next) => {
    try {
        if (LOCAL_AUTH_DISABLED) {
            return res.status(403).json({
                ok: false,
                error: "Direct login is disabled. Please use SSO from LawSuit Case Finder.",
            });
        }
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
                creditsRemaining: true,
                createdAt: true,
            },
        });
        if (!user || !user.passwordHash) {
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
                creditsRemaining: user.creditsRemaining ?? 0,
                createdAt: user.createdAt,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
authRouter.post("/logout", optionalAuth, async (req, res, next) => {
    try {
        if (req.auth?.sessionId) {
            await prisma.session
                .update({
                where: { id: req.auth.sessionId },
                data: { revokedAt: new Date() },
            })
                .catch(() => { });
        }
        clearSessionCookie(res);
        res.status(200).json({
            ok: true,
        });
    }
    catch (error) {
        next(error);
    }
});
authRouter.get("/me", optionalAuth, requireAuth, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: {
                id: true,
                externalUserId: true,
                authProvider: true,
                username: true,
                email: true,
                name: true,
                creditsRemaining: true,
                hasAiAccess: true,
                subscriptionStatus: true,
                allowedCourtIdsJson: true,
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
            user: {
                ...user,
                allowedCourts: normalizeAllowedCourts(user.allowedCourtIdsJson),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=auth.js.map