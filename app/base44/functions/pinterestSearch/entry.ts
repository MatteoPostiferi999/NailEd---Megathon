import { createClientFromRequest } from "npm:@base44/sdk";
import { getPinterestSession, parsePinterestApiResults, parsePinterestSearchResults, pinterestHeaders } from "./pinterest.ts";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function pinterestResourceBody(query: string, limit: number) {
  return new URLSearchParams({
    source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
    data: JSON.stringify({
      options: {
        url: "/v3/search/pins/",
        data: {
          query,
          page_size: limit,
          fields: [
            "pin.id",
            "pin.title",
            "pin.description",
            "pin.images[236x]",
            "pin.images[474x]",
            "pin.images[736x]",
            "pin.pin_join()",
            "pinjoin.visual_annotation",
          ],
        },
      },
      context: {},
    }),
  });
}

async function searchPinterestApi(query: string, limit: number) {
  const { cookieHeader, csrfToken } = await getPinterestSession();

  if (!cookieHeader || !csrfToken) {
    throw new Error("No CSRF cookie");
  }

  const apiResponse = await fetch("https://www.pinterest.com/resource/ApiResource/get/", {
    method: "POST",
    headers: pinterestHeaders({
      accept: "application/json, text/javascript, */*, q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie: cookieHeader,
      referer: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
      "x-csrftoken": csrfToken,
      "x-requested-with": "XMLHttpRequest",
    }),
    body: pinterestResourceBody(query, limit),
    redirect: "follow",
  });

  if (!apiResponse.ok) {
    throw new Error(`Pinterest API search failed (${apiResponse.status})`);
  }

  const contentType = apiResponse.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Pinterest API search returned a non-JSON response");
  }

  const data = await apiResponse.json();
  return parsePinterestApiResults(data, limit);
}

async function searchPinterestHtml(query: string, limit: number) {
  const url = new URL("https://www.pinterest.com/search/pins/");
  url.searchParams.set("q", query);

  const { cookieHeader } = await getPinterestSession(url.host);
  const searchResponse = await fetch(url, {
    headers: pinterestHeaders({
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    }),
    redirect: "follow",
  });

  if (!searchResponse.ok) {
    throw new Error(`Pinterest search failed (${searchResponse.status})`);
  }

  const html = await searchResponse.text();
  return parsePinterestSearchResults(html, limit);
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

    let results = await searchPinterestApi(query, limit).catch(async (error) => {
      console.warn("Pinterest API search failed; falling back to HTML search", error);
      return await searchPinterestHtml(query, limit);
    });

    return response({ query, results, count: results.length });
  } catch (error) {
    console.error("pinterestSearch failed", error);
    return response({ error: error instanceof Error ? error.message : "Pinterest search failed" }, 500);
  }
});
