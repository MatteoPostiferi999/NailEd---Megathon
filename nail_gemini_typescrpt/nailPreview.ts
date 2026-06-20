import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

export const NANO_BANANA_2_MODEL = "gemini-3.1-flash-image";

export type ImageInput =
  | string
  | Buffer
  | Uint8Array
  | {
      data: string | Buffer | Uint8Array;
      mimeType?: string;
      name?: string;
    };

export type LoadedImage = {
  data: Buffer;
  mimeType: string;
  name?: string;
};

export type Size = {
  width: number;
  height: number;
};

export type ResizeInfo = {
  before: Size;
  after: Size;
};

export type GeneratedPreview = {
  model: string;
  girlIndex: number;
  attemptIndex: number;
  imageIndex: number;
  mimeType: string;
  base64: string;
  dataUrl: string;
  size: Size;
  resize: ResizeInfo;
};

export type GenerateNailPreviewOptions = {
  apiKey?: string;
  girlImages: ImageInput[];
  inspoImages: ImageInput[];
  inputMaxSide?: number;
  outputMaxSide?: number;
  useOtherGirlPhotosAsIdentityRef?: boolean;
  gemini3ThinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  gemini3ImageSize?: "1K" | "2K" | "4K";
  onLog?: (message: string) => void;
};

const DEFAULT_INPUT_MAX_SIDE = 512;
const DEFAULT_OUTPUT_MAX_SIDE = 1024;

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
];

function targetSize(
  width: number,
  height: number,
  maxSide: number,
  upscale: boolean,
): Size {
  const longest = Math.max(width, height);
  if (longest <= 0) {
    throw new Error("Image dimensions must be positive");
  }
  if (longest <= maxSide && !upscale) {
    return { width, height };
  }

  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function normalizeMimeType(mimeType?: string | null): string {
  const lower = mimeType?.toLowerCase().split(";")[0].trim();
  if (lower === "image/jpeg" || lower === "image/jpg") return "image/jpeg";
  if (lower === "image/webp") return "image/webp";
  return "image/png";
}

function extensionToMimeType(value: string): string | undefined {
  const clean = value.split("?")[0].split("#")[0].toLowerCase();
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  return undefined;
}

function parseDataUrl(value: string): LoadedImage | undefined {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return undefined;

  return {
    data: Buffer.from(match[2], "base64"),
    mimeType: normalizeMimeType(match[1]),
  };
}

function looksLikeBase64(value: string): boolean {
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return false;
  }
  return /^[A-Za-z0-9+/=\s]+$/.test(value) && value.replace(/\s/g, "").length > 100;
}

async function loadImage(input: ImageInput): Promise<LoadedImage> {
  if (Buffer.isBuffer(input)) {
    return { data: input, mimeType: "image/png" };
  }

  if (input instanceof Uint8Array) {
    return { data: Buffer.from(input), mimeType: "image/png" };
  }

  if (typeof input === "object" && "data" in input) {
    const loaded = await loadImage(input.data);
    return {
      ...loaded,
      mimeType: normalizeMimeType(input.mimeType ?? loaded.mimeType),
      name: input.name,
    };
  }

  const dataUrl = parseDataUrl(input);
  if (dataUrl) return dataUrl;

  if (input.startsWith("http://") || input.startsWith("https://")) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Could not fetch image ${input}: ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    const mimeType =
      response.headers.get("content-type") ??
      extensionToMimeType(input) ??
      "image/png";
    return { data, mimeType: normalizeMimeType(mimeType), name: input };
  }

  if (looksLikeBase64(input)) {
    return { data: Buffer.from(input.replace(/\s/g, ""), "base64"), mimeType: "image/png" };
  }

  const { readFile } = await import("node:fs/promises");
  return {
    data: await readFile(input),
    mimeType: normalizeMimeType(extensionToMimeType(input)),
    name: input,
  };
}

async function resizeImageBytes(
  data: Buffer,
  mimeType: string,
  maxSide: number,
  upscale: boolean,
): Promise<{ data: Buffer; mimeType: string; resize: ResizeInfo }> {
  const orientedData = await sharp(data, { failOn: "none" }).rotate().toBuffer();
  const metadata = await sharp(orientedData).metadata();
  const before = {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
  const after = targetSize(before.width, before.height, maxSide, upscale);
  const outputMimeType = normalizeMimeType(mimeType);

  let pipeline = sharp(orientedData).resize(after.width, after.height, {
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  });

  if (outputMimeType === "image/jpeg") {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 95 });
  } else if (outputMimeType === "image/webp") {
    pipeline = pipeline.webp({ quality: 95 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  return {
    data: await pipeline.toBuffer(),
    mimeType: outputMimeType,
    resize: { before, after },
  };
}

async function loadPart(input: ImageInput, inputMaxSide: number) {
  const loaded = await loadImage(input);
  const resized = await resizeImageBytes(
    loaded.data,
    loaded.mimeType,
    inputMaxSide,
    false,
  );

  return {
    part: {
      inlineData: {
        data: resized.data.toString("base64"),
        mimeType: resized.mimeType,
      },
    },
    resize: resized.resize,
    name: loaded.name,
  };
}

function buildConfig(
  model: string,
  thinkingLevel: GenerateNailPreviewOptions["gemini3ThinkingLevel"],
  imageSize: GenerateNailPreviewOptions["gemini3ImageSize"],
) {
  if (model.startsWith("gemini-3")) {
    return {
      thinkingConfig: {
        thinkingLevel: thinkingLevel ?? "MINIMAL",
      },
      imageConfig: {
        imageSize: imageSize ?? "1K",
      },
      responseModalities: ["IMAGE", "TEXT"],
    };
  }

  return {
    responseModalities: ["IMAGE", "TEXT"],
  };
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

export async function generateNailPreviews(
  options: GenerateNailPreviewOptions,
): Promise<GeneratedPreview[]> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  if (!options.girlImages.length) {
    throw new Error("At least one girl image is required");
  }
  if (!options.inspoImages.length) {
    throw new Error("At least one inspo image is required");
  }

  const log = options.onLog ?? (() => undefined);
  const inputMaxSide = options.inputMaxSide ?? DEFAULT_INPUT_MAX_SIDE;
  const outputMaxSide = options.outputMaxSide ?? DEFAULT_OUTPUT_MAX_SIDE;
  const ai = new GoogleGenAI({ apiKey });

  const inspoParts = await Promise.all(
    options.inspoImages.map((image) => loadPart(image, inputMaxSide)),
  );
  const girlParts = await Promise.all(
    options.girlImages.map((image) => loadPart(image, inputMaxSide)),
  );

  inspoParts.forEach((item, index) => {
    log(
      `inspo ${index + 1}: ${item.resize.before.width}x${item.resize.before.height} -> ${item.resize.after.width}x${item.resize.after.height}`,
    );
  });
  girlParts.forEach((item, index) => {
    log(
      `girl ${index + 1}: ${item.resize.before.width}x${item.resize.before.height} -> ${item.resize.after.width}x${item.resize.after.height}`,
    );
  });

  const previews: GeneratedPreview[] = [];

  const config = buildConfig(
    NANO_BANANA_2_MODEL,
    options.gemini3ThinkingLevel,
    options.gemini3ImageSize,
  );

  log(`=== Nano Banana 2: ${NANO_BANANA_2_MODEL} ===`);

  for (const [girlIndex, girl] of girlParts.entries()) {
    const identityRefs =
      options.useOtherGirlPhotosAsIdentityRef === true
        ? girlParts
            .filter((_, index) => index !== girlIndex)
            .map((item) => item.part)
        : [];

    for (const [attemptIndex, variation] of VARIATIONS.entries()) {
      log(`- girl ${girlIndex + 1}, attempt ${attemptIndex + 1}`);

      const prompt = `${BASE_PROMPT}\n${variation}`;
      const parts = [
        { text: prompt },
        girl.part,
        ...inspoParts.map((item) => item.part),
        ...identityRefs,
      ];

      const response = await ai.models.generateContent({
        model: NANO_BANANA_2_MODEL,
        contents: [{ role: "user", parts }],
        config,
      } as any);

      const responseParts = response.candidates?.[0]?.content?.parts ?? [];
      let imageIndex = 0;

      for (const part of responseParts) {
        const inline = getInlineData(part);
        if (!inline?.data) continue;

        imageIndex += 1;
        const output = await resizeImageBytes(
          Buffer.from(inline.data, "base64"),
          inline.mimeType ?? "image/png",
          outputMaxSide,
          true,
        );
        const base64 = output.data.toString("base64");

        previews.push({
          model: NANO_BANANA_2_MODEL,
          girlIndex: girlIndex + 1,
          attemptIndex: attemptIndex + 1,
          imageIndex,
          mimeType: output.mimeType,
          base64,
          dataUrl: `data:${output.mimeType};base64,${base64}`,
          size: output.resize.after,
          resize: output.resize,
        });
      }
    }
  }

  return previews;
}
