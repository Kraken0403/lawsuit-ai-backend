import prisma from "../lib/prisma.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../utils/auth.js";
export async function optionalAuth(req, _res, next) {
    try {
        const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
        if (!rawToken)
            return next();
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
        if (!session)
            return next();
        if (session.revokedAt)
            return next();
        if (session.expiresAt.getTime() < Date.now())
            return next();
        req.auth = {
            userId: session.userId,
            sessionId: session.id,
        };
        void prisma.session
            .update({
            where: { id: session.id },
            data: { lastUsedAt: new Date() },
        })
            .catch(() => { });
        next();
    }
    catch (error) {
        next(error);
    }
}
export function requireAuth(req, res, next) {
    if (!req.auth) {
        return res.status(401).json({
            ok: false,
            error: "Authentication required",
        });
    }
    next();
}
//# sourceMappingURL=auth.js.map