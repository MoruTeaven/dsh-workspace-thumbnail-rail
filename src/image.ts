import type { ThumbnailRecord } from "./types";

/**
 * Browser-side image pipeline: a user-picked file becomes a small square data
 * URL.
 *
 * DSH has no Host-side image service (no sharp/canvas anywhere in the tree), so
 * the compression is done here with the browser's own canvas — the standard
 * approach and dependency-free. The output is centre-cropped to a square (a
 * rail cell is square) and re-encoded as WebP, falling back to JPEG where WebP
 * is unsupported. The encoded size is kept small deliberately: localStorage is
 * roughly 5–10 MB and every workspace's thumbnail shares it.
 */

/** Longest edge of the produced thumbnail, in px. */
const THUMB_SIZE = 128;

/** WebP quality; tuned for a small icon-like image. */
const WEBP_QUALITY = 0.82;

/** JPEG quality used when WebP encoding is unavailable. */
const JPEG_QUALITY = 0.8;

/** Refuse absurd inputs before decoding — a 400-megapixel PNG would hang the tab. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** Raised when the picked file cannot become a thumbnail; message is user-facing. */
export class ThumbnailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThumbnailError";
  }
}

/** Decode a File/Blob into an HTMLImageElement, rejecting on decode failure. */
function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ThumbnailError("无法读取这张图片"));
    };
    image.src = url;
  });
}

/**
 * Pick the best available output format.
 *
 * WebP is tried first and falls back to JPEG when the browser cannot encode it
 * (older Safari). The probe is a 1×1 canvas rather than a feature test so the
 * decision matches what `toDataURL` will actually produce.
 */
function pickFormat(canvas: HTMLCanvasElement): { mime: string; quality: number } {
  const probe = canvas.toDataURL("image/webp");
  return probe.startsWith("data:image/webp")
    ? { mime: "image/webp", quality: WEBP_QUALITY }
    : { mime: "image/jpeg", quality: JPEG_QUALITY };
}

/** Byte length of a data URL's decoded payload, used for the storage budget. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.slice(comma + 1);
  const base64 = payload.startsWith("data:")
    || payload.includes(";base64");
  if (!base64) return payload.length;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** Draw a centre-cropped square of `size` px from `source` onto a fresh canvas. */
function drawCentreSquare(source: HTMLImageElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  /* v8 ignore next -- a 2D context is unavailable only in an exotic environment. */
  if (ctx === null) throw new ThumbnailError("当前环境不支持图片处理");

  // Centre-crop: take the largest square that fits, then centre it.
  const side = Math.min(source.naturalWidth, source.naturalHeight);
  const sx = (source.naturalWidth - side) / 2;
  const sy = (source.naturalHeight - side) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/**
 * Compress a picked image file into a square thumbnail record.
 *
 * @param file - the image the user picked (any format the browser can decode).
 * @returns the thumbnail, ready to persist.
 * @throws ThumbnailError when the file is too large, undecodable, or the
 * canvas cannot encode it.
 */
export async function makeThumbnail(file: File): Promise<ThumbnailRecord> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ThumbnailError("图片太大，请选择 20 MB 以内的图片");
  }
  if (!file.type.startsWith("image/")) {
    throw new ThumbnailError("请选择一张图片文件");
  }

  const image = await decode(file);
  const canvas = drawCentreSquare(image, THUMB_SIZE);
  const { mime, quality } = pickFormat(canvas);
  const src = canvas.toDataURL(mime, quality);

  if (!src.startsWith("data:image/") || src === "data:,") {
    throw new ThumbnailError("图片编码失败，请换一张试试");
  }

  return { src, bytes: dataUrlBytes(src), updatedAt: Date.now() };
}