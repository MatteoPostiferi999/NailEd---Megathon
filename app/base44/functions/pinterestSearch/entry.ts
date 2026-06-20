import { createClientFromRequest } from "npm:@base44/sdk";
import { getPinterestCookieHeader, parsePinterestSearchResults, pinterestHeaders } from "./pinterest.ts";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return response({ error: "Method not allowed" }, 405);
    }

    const base44 = createClientFromRequest(req);

    try {
      await base44.auth.me();
    } catch {
      return response({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    const limit = Math.min(30, Math.max(1, Number(body.limit) || 18));

    if (!query) {
      return response({ error: "Search query is required" }, 400);
    }

    const url = new URL("https://www.pinterest.com/search/pins/");
    url.searchParams.set("q", query);

    const cookieHeader = await getPinterestCookieHeader(url.host);
    const searchResponse = await fetch(url, {
      headers: pinterestHeaders({
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      }),
      redirect: "follow",
    });

    if (!searchResponse.ok) {
      return response({ error: `Pinterest search failed (${searchResponse.status})` }, 502);
    }

    const html = await searchResponse.text();
    const results = parsePinterestSearchResults(html, limit);

    return response({ query, results, count: results.length });
  } catch (error) {
    console.error("pinterestSearch failed", error);
    return response({ error: error instanceof Error ? error.message : "Pinterest search failed" }, 500);
  }
});
