import { createClientFromRequest } from "npm:@base44/sdk";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function normalizeCredits(value: unknown) {
  const credits = Number(value);
  return Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
}

function parseStripeSignature(header: string) {
  const values: Record<string, string[]> = {};
  header.split(",").forEach((part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return;
    values[key] = values[key] || [];
    values[key].push(value);
  });
  return values;
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function hmacSha256(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string) {
  const signature = parseStripeSignature(signatureHeader);
  const timestamp = signature.t?.[0];
  const signatures = signature.v1 || [];

  if (!timestamp || signatures.length === 0) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await hmacSha256(secret, signedPayload);

  return signatures.some((value) => constantTimeEqual(expected, hexToBytes(value)));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return response({ error: "Method not allowed" }, 405);
    }

    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      return response({ error: "Stripe webhook is not configured yet" }, 501);
    }

    const signatureHeader = req.headers.get("stripe-signature") || "";
    const rawBody = await req.text();
    const verified = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);

    if (!verified) {
      return response({ error: "Invalid signature" }, 400);
    }

    const event = JSON.parse(rawBody);

    if (event.type !== "checkout.session.completed") {
      return response({ received: true, ignored: true });
    }

    const session = event.data?.object || {};
    const metadata = session.metadata || {};
    const paymentId = metadata.payment_id;
    const userId = metadata.user_id || session.client_reference_id;
    const credits = normalizeCredits(metadata.credits);

    if (!paymentId || !userId || !credits) {
      return response({ error: "Missing payment metadata" }, 400);
    }

    const base44 = createClientFromRequest(req);
    const payment = await base44.asServiceRole.entities.CreditPayment.get(paymentId);

    if (!payment || payment.status === "paid") {
      return response({ received: true, idempotent: true });
    }

    if (payment.stripeSessionId && payment.stripeSessionId !== session.id) {
      return response({ error: "Session mismatch" }, 400);
    }

    if (payment.amountCents !== session.amount_total || payment.currency !== session.currency) {
      await base44.asServiceRole.entities.CreditPayment.update(paymentId, { status: "failed" });
      return response({ error: "Amount mismatch" }, 400);
    }

    const user = await base44.asServiceRole.entities.User.get(userId);
    const currentCredits = normalizeCredits(user.credits);

    const updatedUser = await base44.asServiceRole.entities.User.update(userId, {
      credits: currentCredits + credits,
      credits_initialized: true,
      credits_updated_at: new Date().toISOString(),
    });

    await base44.asServiceRole.entities.CreditPayment.update(paymentId, {
      status: "paid",
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent,
      paidAt: new Date().toISOString(),
    });

    return response({
      received: true,
      credits: normalizeCredits(updatedUser.credits),
    });
  } catch (error) {
    console.error("stripeWebhook failed", error);
    return response({ error: error instanceof Error ? error.message : "Webhook failed" }, 500);
  }
});
