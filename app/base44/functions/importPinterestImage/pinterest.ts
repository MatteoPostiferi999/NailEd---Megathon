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
