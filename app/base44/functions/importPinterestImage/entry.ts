import { createClientFromRequest } from "npm:@base44/sdk";
import { pinterestHeaders } from "./pinterest.ts";

type UploadRecord = {
  id: string;
  fileUri?: string;
  file_uri?: string;
  fileName?: string;
  contentType?: string;
  source?: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function sanitizeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function inferExtension(contentType: string, imageUrl: string) {
  const normalized = (contentType || "").toLowerCase().split(";")[0].trim();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/jpeg") return "jpg";

  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "png";
  if (pathname.endsWith(".webp")) return "webp";
  if (pathname.endsWith(".gif")) return "gif";
  return "jpg";
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

    const body = await req.json().catch(() => ({}));
    const imageUrl = String(body.imageUrl || "").trim();
    const pinUrl = String(body.pinUrl || "").trim();
    const title = String(body.title || "Pinterest inspiration").trim();

    if (!imageUrl) {
      return response({ error: "Image URL is required" }, 400);
    }

    const imageResponse = await fetch(imageUrl, {
      headers: pinterestHeaders({
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: pinUrl || "https://www.pinterest.com/",
      }),
    });

    if (!imageResponse.ok) {
      return response({ error: `Could not fetch Pinterest image (${imageResponse.status})` }, 502);
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const extension = inferExtension(contentType, imageUrl);
    const fileNameBase = sanitizeFileName(title) || "pinterest-inspiration";
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    const file = new File([bytes], `${fileNameBase}.${extension}`, { type: contentType });

    const uploaded = await base44.integrations.Core.UploadPrivateFile({ file });
    const existing = (await base44.entities.UserUpload.filter({ slot: "inspiration" }, "-created_date", 1)) as UploadRecord[];

    const payload = {
      slot: "inspiration",
      source: "pinterest",
      fileUri: uploaded.file_uri,
      fileName: title,
      contentType,
      sizeBytes: bytes.byteLength,
    };

    const record = existing?.[0]?.id
      ? await base44.entities.UserUpload.update(existing[0].id, payload)
      : await base44.entities.UserUpload.create(payload);

    const signed = await base44.integrations.Core.CreateFileSignedUrl({
      file_uri: uploaded.file_uri,
      expires_in: 3600,
    });

    return response({
      upload: record,
      signedUrl: signed.signed_url,
      pinUrl,
      imageUrl,
    });
  } catch (error) {
    console.error("importPinterestImage failed", error);
    return response({ error: error instanceof Error ? error.message : "Could not import Pinterest image" }, 500);
  }
});
