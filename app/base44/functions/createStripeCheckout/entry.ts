import { createClientFromRequest } from "npm:@base44/sdk";
import { getStripeCreditPackage, STRIPE_CURRENCY } from "./stripePackages.ts";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function getOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function appendForm(params: URLSearchParams, key: string, value: string | number) {
  params.append(key, String(value));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return response({ error: "Method not allowed" }, 405);
    }

    const base44 = createClientFromRequest(req);
    let user;

    try {
      user = await base44.auth.me();
    } catch {
      return response({ error: "Unauthorized" }, 401);
    }

    if (!user) {
      return response({ error: "Unauthorized" }, 401);
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
    if (!stripeSecretKey) {
      return response({ error: "Stripe is not configured yet", setupRequired: true }, 501);
    }

    const body = await req.json().catch(() => ({}));
    const packageId = String(body.packageId || "");
    const selectedPackage = getStripeCreditPackage(packageId);

    if (!selectedPackage) {
      return response({ error: "Invalid package" }, 400);
    }

    const { credits, amountCents } = selectedPackage;
    const payment = await base44.asServiceRole.entities.CreditPayment.create({
      userId: user.id,
      userEmail: user.email,
      packageId,
      credits,
      amountCents,
      currency: STRIPE_CURRENCY,
      provider: "stripe",
      status: "pending",
    });

    const origin = getOrigin(req);
    const params = new URLSearchParams();
    appendForm(params, "mode", "payment");
    appendForm(params, "client_reference_id", user.id);
    appendForm(params, "customer_email", user.email);
    appendForm(params, "success_url", `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    appendForm(params, "cancel_url", `${origin}/?payment=cancel`);
    appendForm(params, "line_items[0][quantity]", 1);
    appendForm(params, "line_items[0][price_data][currency]", STRIPE_CURRENCY);
    appendForm(params, "line_items[0][price_data][unit_amount]", amountCents);
    appendForm(params, "line_items[0][price_data][product_data][name]", selectedPackage.productName);
    appendForm(params, "line_items[0][price_data][product_data][description]", selectedPackage.productDescription);
    appendForm(params, "metadata[payment_id]", payment.id);
    appendForm(params, "metadata[user_id]", user.id);
    appendForm(params, "metadata[user_email]", user.email);
    appendForm(params, "metadata[credits]", credits);
    appendForm(params, "metadata[package_id]", packageId);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `credit-payment-${payment.id}`,
      },
      body: params,
    });

    const stripeSession = await stripeResponse.json();

    if (!stripeResponse.ok) {
      await base44.asServiceRole.entities.CreditPayment.update(payment.id, { status: "failed" });
      return response({ error: stripeSession?.error?.message || "Could not start checkout" }, 502);
    }

    await base44.asServiceRole.entities.CreditPayment.update(payment.id, {
      stripeSessionId: stripeSession.id,
    });

    return response({
      ok: true,
      checkoutUrl: stripeSession.url,
      paymentId: payment.id,
      credits,
      amountCents,
      currency: STRIPE_CURRENCY,
    });
  } catch (error) {
    console.error("createStripeCheckout failed", error);
    return response({ error: error instanceof Error ? error.message : "Could not create checkout" }, 500);
  }
});
