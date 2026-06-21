import { createClientFromRequest } from "npm:@base44/sdk";

type PreviewRecord = {
  id?: string;
  userId?: string;
  user_id?: string;
  userEmail?: string;
  user_email?: string;
  [key: string]: unknown;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function normalizeId(value: unknown) {
  return String(value || "").trim();
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isOwnedByUser(record: PreviewRecord, user: Record<string, unknown>) {
  const recordUserId = normalizeId(record.userId || record.user_id);
  const recordUserEmail = normalizeEmail(record.userEmail || record.user_email);
  const userId = normalizeId(user.id);
  const userEmail = normalizeEmail(user.email);

  return Boolean((userId && recordUserId === userId) || (userEmail && recordUserEmail === userEmail));
}

function dedupeById(records: PreviewRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const id = normalizeId(record.id);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return response({ error: "Method not allowed" }, 405);
    }

    const base44 = createClientFromRequest(req);
    let user: Record<string, unknown>;

    try {
      user = await base44.auth.me();
    } catch {
      return response({ error: "Unauthorized" }, 401);
    }

    if (!user) {
      return response({ error: "Unauthorized" }, 401);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Math.max(Number(body.limit || 90) || 90, 1), 200);
    const userId = normalizeId(user.id);
    const userEmail = normalizeEmail(user.email);
    const records: PreviewRecord[] = [];

    if (userId) {
      records.push(...((await base44.asServiceRole.entities.GeneratedPreview.filter({ userId }, "-created_date", limit)) as PreviewRecord[]));
    }

    if (userEmail && records.length < limit) {
      records.push(...((await base44.asServiceRole.entities.GeneratedPreview.filter({ userEmail }, "-created_date", limit)) as PreviewRecord[]));
    }

    const previews = dedupeById(records)
      .filter((record) => isOwnedByUser(record, user))
      .slice(0, limit);

    return response({ ok: true, previews, count: previews.length });
  } catch (error) {
    console.error("listGeneratedPreviews failed", error);
    return response({ error: error instanceof Error ? error.message : "Could not load generated previews" }, 500);
  }
});
