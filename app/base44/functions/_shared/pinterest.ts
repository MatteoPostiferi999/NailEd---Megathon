const SEARCH_RESULT_SPLIT = /<div aria-label="Scheda Pin"/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

export type PinterestPin = {
  id: string;
  pinUrl: string;
  imageUrl: string;
  title: string;
  aspectRatio?: number;
};

function decodeHtml(value: string) {
  return value
    .replace(/&(amp|quot|lt|gt|#x27|#39);/g, (entity) => HTML_ENTITY_MAP[entity] || entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanTitle(value: string) {
  return decodeHtml(value)
    .replace(/^Contiene un'immagine di:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePinterestUrl(value: string) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `https://www.pinterest.com${value}`;
  return value;
}

function parseSrcSet(srcSet: string) {
  const candidates = srcSet
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates.at(-1) || candidates[0] || "";
}

function extractPinFromChunk(chunk: string): PinterestPin | null {
  if (chunk.includes("Sponsorizzato")) return null;

  const idMatch = chunk.match(/data-test-pin-id="([^"]+)"/);
  const pinHrefMatch = chunk.match(/href="(\/pin\/[^"]+)"/);
  const imgMatch = chunk.match(/<img[^>]+src="([^"]*i\.pinimg\.com[^"]+)"[^>]*>/i);
  const srcSetMatch = chunk.match(/srcSet="([^"]+)"/i);
  const altMatch = chunk.match(/<img[^>]+alt="([^"]*)"/i);
  const ratioMatch = chunk.match(/padding-bottom:([0-9.]+)%/i);

  const imageUrl = normalizePinterestUrl(parseSrcSet(srcSetMatch?.[1] || "") || imgMatch?.[1] || "");
  const pinUrl = normalizePinterestUrl(pinHrefMatch?.[1] || "");
  const id = decodeHtml(idMatch?.[1] || pinHrefMatch?.[1]?.replace(/\W+/g, "-") || "");

  if (!id || !pinUrl || !imageUrl) return null;

  const title = cleanTitle(altMatch?.[1] || "Pinterest pin");
  const paddingBottom = Number(ratioMatch?.[1]);

  return {
    id,
    pinUrl,
    imageUrl,
    title: title || "Pinterest pin",
    aspectRatio: Number.isFinite(paddingBottom) && paddingBottom > 0 ? paddingBottom / 100 : undefined,
  };
}

export function parsePinterestSearchResults(html: string, limit = 24) {
  const chunks = html.split(SEARCH_RESULT_SPLIT).slice(1);
  const results: PinterestPin[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const pin = extractPinFromChunk(chunk);
    if (!pin || seen.has(pin.id)) continue;
    seen.add(pin.id);
    results.push(pin);
    if (results.length >= limit) break;
  }

  return results;
}

function cookieDomainMatches(domain: string, host: string) {
  const normalized = domain.replace(/^\./, "").toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

export async function getPinterestCookieHeader(host = "www.pinterest.com") {
  const rawCookieHeader = Deno.env.get("PINTEREST_COOKIE_HEADER");
  if (rawCookieHeader?.trim()) return rawCookieHeader.trim();

  const file = Deno.env.get("PINTEREST_COOKIES_TXT") || "";
  if (!file) return "";

  const now = Math.floor(Date.now() / 1000);
  const cookies: string[] = [];

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split("\t");
    if (parts.length < 7) continue;

    const [domain, , path, secureFlag, expiresAt, name, ...rest] = parts;
    const value = rest.join("\t");

    if (!cookieDomainMatches(domain, host)) continue;
    if (!path.startsWith("/")) continue;
    if (secureFlag === "TRUE" && !host.startsWith("www.")) continue;

    const expires = Number(expiresAt);
    if (Number.isFinite(expires) && expires !== 0 && expires < now) continue;

    cookies.push(`${name}=${value}`);
  }

  return cookies.join("; ");
}

export function pinterestHeaders(extra: HeadersInit = {}) {
  return {
    "accept-language": "en-US,en;q=0.9,it;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    ...extra,
  };
}
