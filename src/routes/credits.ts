import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import prisma from "../lib/prisma.js";
import {
  optionalAuth,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

export const creditsRouter = Router();
const db = prisma as any;

creditsRouter.use(optionalAuth, requireAuth);

type CreditPackage = {
  id: "credits_50" | "credits_100" | "credits_200";
  credits: number;
  amountRupees: number;
  amountPaise: number;
  label: string;
};

const CREDIT_PACKAGES: Record<CreditPackage["id"], CreditPackage> = {
  credits_50: {
    id: "credits_50",
    credits: 50,
    amountRupees: 7000,
    amountPaise: 700000,
    label: "50 AI Credits",
  },
  credits_100: {
    id: "credits_100",
    credits: 100,
    amountRupees: 10000,
    amountPaise: 1000000,
    label: "100 AI Credits",
  },
  credits_200: {
    id: "credits_200",
    credits: 200,
    amountRupees: 15000,
    amountPaise: 1500000,
    label: "200 AI Credits",
  },
};

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status?: string;
};

type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
};

function getRazorpayConfig() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    const error = new Error("Credit payments are not configured on the server.") as Error & {
      status?: number;
    };
    error.status = 503;
    throw error;
  }

  return { keyId, keySecret };
}

async function razorpayRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { keyId, keySecret } = getRazorpayConfig();
  const headers = new Headers(init.headers || {});
  headers.set(
    "Authorization",
    `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`
  );

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.description ||
      payload?.error?.reason ||
      "The payment gateway request failed.";
    const error = new Error(message) as Error & { status?: number };
    error.status = 502;
    throw error;
  }

  return payload as T;
}

function safeSignatureMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function getPackage(packageId: unknown) {
  const normalized = String(packageId || "").trim() as CreditPackage["id"];
  return CREDIT_PACKAGES[normalized] || null;
}

creditsRouter.get("/packages", (_req, res) => {
  res.json({
    ok: true,
    packages: Object.values(CREDIT_PACKAGES),
  });
});

creditsRouter.post(
  "/orders",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const selectedPackage = getPackage(req.body?.packageId);

      if (!selectedPackage) {
        return res.status(400).json({
          ok: false,
          error: "Please select a valid credit package.",
        });
      }

      const { keyId } = getRazorpayConfig();
      const receipt = `cr_${Date.now().toString(36)}_${randomUUID()
        .replace(/-/g, "")
        .slice(0, 10)}`;

      const order = await razorpayRequest<RazorpayOrder>("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: selectedPackage.amountPaise,
          currency: "INR",
          receipt,
          notes: {
            user_id: req.auth!.userId,
            package_id: selectedPackage.id,
            credits: String(selectedPackage.credits),
          },
        }),
      });

      await db.creditPurchase.create({
        data: {
          userId: req.auth!.userId,
          packageId: selectedPackage.id,
          credits: selectedPackage.credits,
          amountPaise: selectedPackage.amountPaise,
          currency: "INR",
          razorpayOrderId: order.id,
          status: "PENDING",
        },
      });

      res.status(201).json({
        ok: true,
        keyId,
        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
        },
        package: selectedPackage,
      });
    } catch (error) {
      next(error);
    }
  }
);

creditsRouter.post(
  "/verify",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const razorpayOrderId = String(req.body?.razorpayOrderId || "").trim();
      const razorpayPaymentId = String(req.body?.razorpayPaymentId || "").trim();
      const razorpaySignature = String(req.body?.razorpaySignature || "").trim();

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({
          ok: false,
          error: "Incomplete payment verification details.",
        });
      }

      const purchase = await db.creditPurchase.findFirst({
        where: {
          userId: req.auth!.userId,
          razorpayOrderId,
        },
      });

      if (!purchase) {
        return res.status(404).json({
          ok: false,
          error: "Credit purchase order was not found.",
        });
      }

      if (purchase.status === "COMPLETED") {
        const user = await prisma.user.findUnique({
          where: { id: req.auth!.userId },
          select: { creditsRemaining: true },
        });

        return res.json({
          ok: true,
          alreadyProcessed: true,
          creditsAdded: purchase.credits,
          creditsRemaining: user?.creditsRemaining ?? 0,
        });
      }

      const { keySecret } = getRazorpayConfig();
      const expectedSignature = createHmac("sha256", keySecret)
        .update(`${purchase.razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");

      if (!safeSignatureMatch(razorpaySignature, expectedSignature)) {
        return res.status(400).json({
          ok: false,
          error: "Payment signature verification failed.",
        });
      }

      let payment = await razorpayRequest<RazorpayPayment>(
        `/payments/${encodeURIComponent(razorpayPaymentId)}`
      );

      if (payment.status === "authorized") {
        payment = await razorpayRequest<RazorpayPayment>(
          `/payments/${encodeURIComponent(razorpayPaymentId)}/capture`,
          {
            method: "POST",
            body: JSON.stringify({
              amount: purchase.amountPaise,
              currency: purchase.currency,
            }),
          }
        );
      }

      const paymentMatchesPurchase =
        payment.order_id === purchase.razorpayOrderId &&
        payment.amount === purchase.amountPaise &&
        payment.currency === purchase.currency &&
        payment.status === "captured";

      if (!paymentMatchesPurchase) {
        return res.status(400).json({
          ok: false,
          error: "The payment could not be confirmed as captured.",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const creditPurchase = (tx as any).creditPurchase;
        const claimed = await creditPurchase.updateMany({
          where: {
            id: purchase.id,
            status: "PENDING",
          },
          data: {
            razorpayPaymentId,
            razorpaySignature,
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          const existingPurchase = await creditPurchase.findUnique({
            where: { id: purchase.id },
          });
          const existingUser = await tx.user.findUnique({
            where: { id: req.auth!.userId },
            select: { creditsRemaining: true },
          });

          return {
            alreadyProcessed: existingPurchase?.status === "COMPLETED",
            creditsRemaining: existingUser?.creditsRemaining ?? 0,
          };
        }

        const updatedUser = await tx.user.update({
          where: { id: req.auth!.userId },
          data: {
            creditsRemaining: {
              increment: purchase.credits,
            },
          },
          select: {
            creditsRemaining: true,
          },
        });

        return {
          alreadyProcessed: false,
          creditsRemaining: updatedUser.creditsRemaining,
        };
      });

      res.json({
        ok: true,
        alreadyProcessed: result.alreadyProcessed,
        creditsAdded: purchase.credits,
        creditsRemaining: result.creditsRemaining,
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        return res.status(409).json({
          ok: false,
          error: "This payment has already been used.",
        });
      }

      next(error);
    }
  }
);
