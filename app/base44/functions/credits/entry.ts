import { createClientFromRequest } from "npm:@base44/sdk";

const IRL_CREDITS = 2;
const FRESH_SIGNUP_WINDOW_MS = 30 * 60 * 1000;

function normalizeCredits(value: unknown) {
  const credits = Number(value);
  return Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
}

function getCreatedAt(user: Record<string, unknown>) {
  const rawDate = user.created_date || user.created_at || user.createdAt;
  if (!rawDate) return null;
  const createdAt = new Date(String(rawDate)).getTime();
  return Number.isFinite(createdAt) ? createdAt : null;
}

function isFreshSignup(user: Record<string, unknown>) {
  const createdAt = getCreatedAt(user);
  if (!createdAt) return false;
  return Date.now() - createdAt <= FRESH_SIGNUP_WINDOW_MS;
}

function parseJsonBody(req: Request) {
  if (req.method === "GET") return {};
  return req.json().catch(() => ({}));
}

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user;

    try {
      user = await base44.auth.me();
    } catch (error) {
      return response({ error: "Unauthorized" }, 401);
    }

    if (!user) {
      return response({ error: "Unauthorized" }, 401);
    }

    const body = await parseJsonBody(req);
    const action = String(body.action || "initialize");
    const now = new Date().toISOString();
    const currentCredits = normalizeCredits(user.credits);
    let patch: Record<string, unknown> = {};

    if (action === "initialize") {
      const promoCode = String(body.promoCode || "").toLowerCase();
      const alreadyInitialized = Boolean(user.credits_initialized);
      const canApplyIrlPromo =
        promoCode === "irl" &&
        !alreadyInitialized &&
        !user.irl_promo_applied &&
        isFreshSignup(user);

      patch = {
        credits: canApplyIrlPromo ? IRL_CREDITS : currentCredits,
        credits_initialized: true,
        signup_source: canApplyIrlPromo ? "irl" : user.signup_source || "direct",
        credits_promo_code: canApplyIrlPromo ? "irl" : user.credits_promo_code,
        irl_promo_applied: Boolean(user.irl_promo_applied || canApplyIrlPromo),
        credits_updated_at: alreadyInitialized ? user.credits_updated_at || now : now,
      };
    } else if (action === "spend") {
      const amount = Math.max(1, Math.min(10, normalizeCredits(body.amount || 1)));

      if (currentCredits < amount) {
        return response({ error: "Not enough credits", credits: currentCredits }, 402);
      }

      patch = {
        credits: currentCredits - amount,
        credits_initialized: true,
        credits_updated_at: now,
      };
    } else {
      return response({ error: "Invalid action" }, 400);
    }

    const updatedUser = await base44.asServiceRole.entities.User.update(user.id, patch);

    return response({
      ok: true,
      credits: normalizeCredits(updatedUser.credits),
      promoApplied: Boolean(patch.credits_promo_code === "irl" && patch.irl_promo_applied),
      user: updatedUser,
    });
  } catch (error) {
    console.error("credits function failed", error);
    return response({ error: error instanceof Error ? error.message : "Credit update failed" }, 500);
  }
});
