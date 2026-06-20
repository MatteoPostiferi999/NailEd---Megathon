import { createClientFromRequest } from "npm:@base44/sdk";
import { GoogleGenAI } from "npm:@google/genai";

const MODEL = "gemini-3.1-flash-image";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

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
  fileUri?: string;
  file_uri?: string;
  fileName?: string;
  contentType?: string;
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

async function imagePartFromUpload(base44: any, upload: UploadRecord) {
  const signedUrl = await signedUrlForUpload(base44, upload);
  const imageResponse = await fetch(signedUrl);

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

async function uploadGeneratedPreview(base44: any, bytes: Uint8Array, mimeType: string, name: string) {
  const file = new File([bytes], name, { type: mimeType });
  const uploaded = await base44.integrations.Core.UploadPrivateFile({ file });
  const signed = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri: uploaded.file_uri,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });

  return {
    fileUri: uploaded.file_uri,
    signedUrl: signed.signed_url,
  };
}

async function getOwnUpload(base44: any, id: string, allowedSlots: string[]) {
  const upload = (await base44.entities.UserUpload.get(id)) as UploadRecord;
  if (!upload?.id) throw new Error("Upload not found");
  if (!allowedSlots.includes(String(upload.slot))) throw new Error("Invalid upload slot");
  if (!(upload.fileUri || upload.file_uri)) throw new Error("Upload has no saved file");
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
          const stored = await uploadGeneratedPreview(base44, bytes, mimeType, fileName);

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
