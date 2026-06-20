# Base44 Usage

Use `base44NailPreviewAction.ts` as the function/action entrypoint and keep
`nailPreview.ts` next to it. It is intentionally single-model: Nano Banana 2
only (`gemini-3.1-flash-image`). Do not call Gemini from the browser with a
public API key.

## Dependencies

```bash
npm install @google/genai sharp
```

## Environment

Set this secret in Base44:

```bash
GEMINI_API_KEY=your_key_here
```

## Backend Function Shape

Pass Base44 upload URLs into the action. The lower-level `generateNailPreviews`
function also accepts data URLs, raw base64 strings, `Buffer`s, or `Uint8Array`s.

```ts
import { createNailPreviews } from "./base44NailPreviewAction";

export async function nailPreviewAction({
  girlImageUrls,
  inspoImageUrls,
}: {
  girlImageUrls: string[];
  inspoImageUrls: string[];
}) {
  return createNailPreviews({
    girlImageUrls,
    inspoImageUrls,
  });
}
```

Each returned `dataUrl` is ready to show in an `<img src={...} />`. If Base44
has a storage API, store `base64` with `mimeType` instead of returning large
data URLs directly to the UI.

## Typecheck

```bash
npm install
npm run typecheck
```
