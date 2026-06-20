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

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function getCloudinaryConfig(): CloudinaryConfig {
  const cloudinaryUrl = Deno.env.get("CLOUDINARY_URL");
  if (!cloudinaryUrl) {
    throw new Error("Cloudinary is not configured yet");
  }

  const parsed = new URL(cloudinaryUrl);
  if (parsed.protocol !== "cloudinary:" || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("Cloudinary URL is invalid");
  }

  return {
    cloudName: parsed.hostname,
    apiKey: decodeURIComponent(parsed.username),
    apiSecret: decodeURIComponent(parsed.password),
  };
}

function sanitizeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function stableUserFolderPart(user: Record<string, unknown>) {
  return sanitizeFileName(String(user.id || user.email || "user")).slice(0, 64);
}

async function sha1Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createCloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return sha1Hex(`${serialized}${apiSecret}`);
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

async function uploadPinterestImageToCloudinary({
  bytes,
  cloudinary,
  contentType,
  extension,
  fileNameBase,
  user,
}: {
  bytes: Uint8Array;
  cloudinary: CloudinaryConfig;
  contentType: string;
  extension: string;
  fileNameBase: string;
  user: Record<string, unknown>;
}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = `nailed/user-uploads/${stableUserFolderPart(user)}/inspiration`;
  const publicId = `inspiration-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fileNameBase}`;
  const uploadParams = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = await createCloudinarySignature(uploadParams, cloudinary.apiSecret);
  const form = new FormData();

  form.append("file", new Blob([bytes], { type: contentType }), `${fileNameBase}.${extension}`);
  form.append("api_key", cloudinary.apiKey);
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("public_id", publicId);

  const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const uploaded = await uploadResponse.json().catch(() => ({}));

  if (!uploadResponse.ok) {
    throw new Error(uploaded?.error?.message || "Could not upload Pinterest image");
  }

  return uploaded;
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

    let cloudinary: CloudinaryConfig;
    try {
      cloudinary = getCloudinaryConfig();
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "Cloudinary setup failed", setupRequired: true }, 501);
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
    const uploaded = await uploadPinterestImageToCloudinary({
      bytes,
      cloudinary,
      contentType,
      extension,
      fileNameBase,
      user,
    });

    const existing = (await base44.entities.UserUpload.filter({ slot: "inspiration" }, "-created_date", 1)) as UploadRecord[];

    const payload = {
      slot: "inspiration",
      source: "pinterest",
      fileUri: "",
      storageProvider: "cloudinary",
      cloudinaryPublicId: uploaded.public_id,
      cloudinarySecureUrl: uploaded.secure_url,
      cloudinaryVersion: uploaded.version,
      cloudinaryResourceType: uploaded.resource_type || "image",
      cloudinaryFormat: uploaded.format || extension,
      fileName: title,
      contentType,
      sizeBytes: bytes.byteLength,
    };

    const record = existing?.[0]?.id
      ? await base44.entities.UserUpload.update(existing[0].id, payload)
      : await base44.entities.UserUpload.create(payload);

    return response({
      upload: record,
      signedUrl: uploaded.secure_url,
      pinUrl,
      imageUrl,
    });
  } catch (error) {
    console.error("importPinterestImage failed", error);
    return response({ error: error instanceof Error ? error.message : "Could not import Pinterest image" }, 500);
  }
});
