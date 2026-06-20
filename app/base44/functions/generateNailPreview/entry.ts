import { createClientFromRequest } from "npm:@base44/sdk";
import { GoogleGenAI } from "npm:@google/genai";

const MODEL = "gemini-3.1-flash-image";
const CLOUDINARY_GENERATED_FOLDER = "nailed/generated-previews";

const BASE_PROMPT = `Photo-editing task: virtual nail-art try-on.

The FIRST image is the target photo. The remaining image(s) are REFERENCE nail
design images.

Return the same target photo with the reference nail design applied only to the
visible fingernails. Treat every non-nail part of the target image as locked.

ONLY CHANGE:
- The color, art, finish, and manicure styling on the visible nail plates.
- Nail length/shape only where required to make the reference manicure fit
  plausibly on the existing fingers.

MUST PRESERVE EXACTLY FROM THE TARGET PHOTO:
- Face, hair, body, clothing, skin, makeup, jewelry, rings, accessories.
- Finger count, finger shape, finger length, knuckles, veins, cuticles, skin
  texture, hand proportions, and natural shadows.
- Pose, gesture, camera angle, perspective, crop, framing, background, lighting,
  reflections, color grading, depth of field, and aspect ratio.

MUST REPLICATE FROM THE REFERENCE DESIGN:
- Exact colors, gradients, color placement, patterns, decals, glitter, French
  tips, chrome/shimmer/matte/gloss finish, and overall style.
- Apply the same design consistently across all visible nails.

Do not redraw the person, change the environment, beautify skin, add text,
add watermarks, add fingers, remove fingers, or change the composition. Output
a single photorealistic edited image.`;

const VARIATIONS = [
  "EDIT PASS: conservative nail-only edit. Prioritize preserving the target photo exactly outside the nails.",
  "EDIT PASS: design-fidelity nail-only edit. Prioritize exact reference colors, art placement, and finish while preserving every non-nail detail.",
  "EDIT PASS: natural-integration nail-only edit. Prioritize realistic nail lighting, reflections, and shadows while preserving the target photo.",
];

type UploadRecord = {
  id: string;
  slot?: string;
  storageProvider?: string;
  storage_provider?: string;
  fileUri?: string;
  file_uri?: string;
  cloudinaryPublicId?: string;
  cloudinary_public_id?: string;
  cloudinarySecureUrl?: string;
  cloudinary_secure_url?: string;
  cloudinaryVersion?: number;
  cloudinary_version?: number;
  cloudinaryResourceType?: string;
  cloudinary_resource_type?: string;
  cloudinaryFormat?: string;
  cloudinary_format?: string;
  fileName?: string;
  contentType?: string;
};

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function normalizeCredits(value: unknown) {
  const credits = Number(value);
  return Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
}

function normalizeMimeType(value?: string | null) {
  const lower = value?.toLowerCase().split(";")[0].trim();
  if (lower === "image/jpeg" || lower === "image/jpg") return "image/jpeg";
  if (lower === "image/webp") return "image/webp";
  return "image/png";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

function getInlineData(part: unknown): { data: string; mimeType?: string } | undefined {
  if (!part || typeof part !== "object") return undefined;
  const maybePart = part as {
    inlineData?: { data?: string; mimeType?: string };
    inline_data?: { data?: string; mime_type?: string };
  };

  if (maybePart.inlineData?.data) {
    return {
      data: maybePart.inlineData.data,
      mimeType: maybePart.inlineData.mimeType,
    };
  }

  if (maybePart.inline_data?.data) {
    return {
      data: maybePart.inline_data.data,
      mimeType: maybePart.inline_data.mime_type,
    };
  }

  return undefined;
}

async function signedUrlForUpload(base44: any, upload: UploadRecord) {
  const fileUri = upload.fileUri || upload.file_uri;
  if (!fileUri) throw new Error("Upload is missing file URI");

  const signed = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri: fileUri,
    expires_in: 15 * 60,
  });

  return signed.signed_url as string;
}

function cloudinaryUrlForUpload(upload: UploadRecord) {
  return upload.cloudinarySecureUrl || upload.cloudinary_secure_url || "";
}

async function imageUrlForUpload(base44: any, upload: UploadRecord) {
  const cloudinaryUrl = cloudinaryUrlForUpload(upload);
  if (cloudinaryUrl) return cloudinaryUrl;
  return signedUrlForUpload(base44, upload);
}

async function imagePartFromUpload(base44: any, upload: UploadRecord) {
  const imageUrl = await imageUrlForUpload(base44, upload);
  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    throw new Error(`Could not load ${upload.slot || "upload"} image`);
  }

  const mimeType = normalizeMimeType(upload.contentType || imageResponse.headers.get("content-type"));
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());

  return {
    inlineData: {
      data: bytesToBase64(bytes),
      mimeType,
    },
  };
}

async function uploadGeneratedPreview(cloudinary: CloudinaryConfig, bytes: Uint8Array, mimeType: string, name: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const publicId = `preview-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${sanitizePublicIdPart(name)}`;
  const uploadParams = {
    folder: CLOUDINARY_GENERATED_FOLDER,
    public_id: publicId,
    timestamp,
  };
  const signature = await createCloudinarySignature(uploadParams, cloudinary.apiSecret);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), name);
  form.append("api_key", cloudinary.apiKey);
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  form.append("folder", CLOUDINARY_GENERATED_FOLDER);
  form.append("public_id", publicId);

  const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const uploaded = await uploadResponse.json().catch(() => ({}));

  if (!uploadResponse.ok) {
    throw new Error(uploaded?.error?.message || "Could not upload generated preview");
  }

  return {
    storageProvider: "cloudinary",
    fileUri: "",
    cloudinaryPublicId: uploaded.public_id,
    cloudinarySecureUrl: uploaded.secure_url,
    cloudinaryVersion: uploaded.version,
    cloudinaryResourceType: uploaded.resource_type || "image",
    cloudinaryFormat: uploaded.format || extensionForMimeType(mimeType),
    signedUrl: uploaded.secure_url,
  };
}

async function getOwnUpload(base44: any, id: string, allowedSlots: string[]) {
  const upload = (await base44.entities.UserUpload.get(id)) as UploadRecord;
  if (!upload?.id) throw new Error("Upload not found");
  if (!allowedSlots.includes(String(upload.slot))) throw new Error("Invalid upload slot");
  if (!(cloudinaryUrlForUpload(upload) || upload.fileUri || upload.file_uri)) throw new Error("Upload has no saved file");
  return upload;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return response({ error: "Method not allowed" }, 405);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      return response({ error: "Gemini is not configured yet", setupRequired: true }, 501);
    }

    let cloudinary: CloudinaryConfig;
    try {
      cloudinary = getCloudinaryConfig();
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "Cloudinary setup failed", setupRequired: true }, 501);
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

    const currentCredits = normalizeCredits(user.credits);
    if (currentCredits < 1) {
      return response({ error: "Not enough credits", credits: currentCredits }, 402);
    }

    const body = await req.json().catch(() => ({}));
    const targetUploadIds = Array.isArray(body.targetUploadIds)
      ? body.targetUploadIds.map(String).filter(Boolean).slice(0, 3)
      : [];
    const inspoUploadId = String(body.inspoUploadId || "");

    if (targetUploadIds.length === 0) {
      return response({ error: "Upload at least one hand photo" }, 400);
    }

    if (!inspoUploadId) {
      return response({ error: "Upload an inspiration photo first" }, 400);
    }

    const targetUploads = await Promise.all(
      targetUploadIds.map((id) => getOwnUpload(base44, id, ["hand", "chest", "face"])),
    );
    const inspoUpload = await getOwnUpload(base44, inspoUploadId, ["inspiration"]);
    const targetParts = await Promise.all(targetUploads.map((upload) => imagePartFromUpload(base44, upload)));
    const inspoPart = await imagePartFromUpload(base44, inspoUpload);
    const ai = new GoogleGenAI({ apiKey });
    const previews = [];

    for (const [targetIndex, targetPart] of targetParts.entries()) {
      const targetUpload = targetUploads[targetIndex];

      for (const [attemptIndex, variation] of VARIATIONS.entries()) {
        const geminiResponse = await ai.models.generateContent({
          model: MODEL,
          contents: [
            {
              role: "user",
              parts: [
                { text: `${BASE_PROMPT}\n${variation}` },
                { inlineData: targetPart.inlineData },
                { inlineData: inspoPart.inlineData },
              ],
            },
          ],
          config: {
            thinkingConfig: { thinkingLevel: "MINIMAL" },
            imageConfig: { imageSize: "1K" },
            responseModalities: ["IMAGE", "TEXT"],
          },
        } as any);

        const responseParts = geminiResponse.candidates?.[0]?.content?.parts ?? [];
        let imageIndex = 0;

        for (const part of responseParts) {
          const inline = getInlineData(part);
          if (!inline?.data) continue;

          imageIndex += 1;
          const mimeType = normalizeMimeType(inline.mimeType);
          const bytes = base64ToBytes(inline.data);
          const fileName = `nailed-${targetUpload.slot || "target"}-${attemptIndex + 1}-${imageIndex}.${extensionForMimeType(mimeType)}`;
          const stored = await uploadGeneratedPreview(cloudinary, bytes, mimeType, fileName);

          previews.push({
            id: `${targetUpload.id}-${attemptIndex + 1}-${imageIndex}`,
            targetSlot: targetUpload.slot || "hand",
            targetUploadId: targetUpload.id,
            attemptIndex: attemptIndex + 1,
            imageIndex,
            mimeType,
            ...stored,
          });
        }
      }
    }

    if (previews.length === 0) {
      return response({ error: "Gemini did not return an image" }, 502);
    }

    const updatedUser = await base44.asServiceRole.entities.User.update(user.id, {
      credits: currentCredits - 1,
      credits_initialized: true,
      credits_updated_at: new Date().toISOString(),
    });

    return response({
      ok: true,
      model: MODEL,
      previews,
      credits: normalizeCredits(updatedUser.credits),
      user: updatedUser,
    });
  } catch (error) {
    console.error("generateNailPreview failed", error);
    return response({ error: error instanceof Error ? error.message : "Could not generate nail preview" }, 500);
  }
});
