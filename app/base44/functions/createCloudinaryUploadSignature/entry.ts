import { createClientFromRequest } from "npm:@base44/sdk";

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

const ALLOWED_SLOTS = new Set(["hand", "chest", "face", "inspiration"]);

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

function sanitizePublicIdPart(value = "image") {
  const [stem] = value.split(".");
  const sanitized = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return sanitized || "image";
}

function stableUserFolderPart(user: Record<string, unknown>) {
  return sanitizePublicIdPart(String(user.id || user.email || "user")).slice(0, 64);
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

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return response({ error: "Method not allowed" }, 405);
    }

    let cloudinary: CloudinaryConfig;
    try {
      cloudinary = getCloudinaryConfig();
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "Cloudinary setup failed", setupRequired: true }, 501);
    }

    const base44 = createClientFromRequest(req);
    let user: Record<string, unknown> | null = null;

    try {
      user = await base44.auth.me();
    } catch {
      return response({ error: "Unauthorized" }, 401);
    }

    if (!user) {
      return response({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const slot = String(body.slot || "");
    if (!ALLOWED_SLOTS.has(slot)) {
      return response({ error: "Invalid upload slot" }, 400);
    }

    const fileName = sanitizePublicIdPart(String(body.fileName || slot));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const folder = `nailed/user-uploads/${stableUserFolderPart(user)}/${slot}`;
    const publicId = `${slot}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fileName}`;
    const uploadParams = {
      folder,
      public_id: publicId,
      timestamp,
    };
    const signature = await createCloudinarySignature(uploadParams, cloudinary.apiSecret);

    return response({
      ok: true,
      cloudName: cloudinary.cloudName,
      apiKey: cloudinary.apiKey,
      resourceType: "image",
      timestamp,
      folder,
      publicId,
      signature,
    });
  } catch (error) {
    console.error("createCloudinaryUploadSignature failed", error);
    return response({ error: error instanceof Error ? error.message : "Could not prepare upload" }, 500);
  }
});
