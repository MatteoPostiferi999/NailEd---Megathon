import { generateNailPreviews } from "./nailPreview";

export type Base44NailPreviewRequest = {
  girlImageUrls: string[];
  inspoImageUrls: string[];
};

export type Base44NailPreviewResult = {
  id: string;
  girlIndex: number;
  attemptIndex: number;
  imageIndex: number;
  mimeType: string;
  base64: string;
  dataUrl: string;
  width: number;
  height: number;
};

export async function createNailPreviews(
  request: Base44NailPreviewRequest,
): Promise<Base44NailPreviewResult[]> {
  const previews = await generateNailPreviews({
    girlImages: request.girlImageUrls,
    inspoImages: request.inspoImageUrls,
    inputMaxSide: 512,
    outputMaxSide: 1024,
    gemini3ThinkingLevel: "MINIMAL",
    gemini3ImageSize: "1K",
  });

  return previews.map((preview) => ({
    id: `girl${preview.girlIndex}-attempt${preview.attemptIndex}-image${preview.imageIndex}`,
    girlIndex: preview.girlIndex,
    attemptIndex: preview.attemptIndex,
    imageIndex: preview.imageIndex,
    mimeType: preview.mimeType,
    base64: preview.base64,
    dataUrl: preview.dataUrl,
    width: preview.size.width,
    height: preview.size.height,
  }));
}

export default createNailPreviews;
