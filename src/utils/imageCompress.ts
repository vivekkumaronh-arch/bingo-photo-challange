import { computeScaledDimensions } from './cameraHelpers';

export interface CompressedImageResult {
  blob: Blob;
  previewUrl: string;
  mimeType: 'image/webp' | 'image/jpeg';
}

const MAX_DIMENSION = 1200;
const QUALITY = 0.82;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read the selected image. Please try another photo.'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function drawSourceAndCompress(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
): Promise<CompressedImageResult> {
  const { width: targetWidth, height: targetHeight } = computeScaledDimensions(
    srcWidth,
    srcHeight,
    MAX_DIMENSION,
  );

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas image processing is unavailable in this browser.');
  }

  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

  // Try WebP first for smallest size, fallback to JPEG for older browsers
  let blob = await canvasToBlob(canvas, 'image/webp', QUALITY);
  let mimeType: 'image/webp' | 'image/jpeg' = 'image/webp';

  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
    mimeType = 'image/jpeg';
  }

  if (!blob) {
    throw new Error('Failed to process photo for upload.');
  }

  const previewUrl = URL.createObjectURL(blob);
  return { blob, previewUrl, mimeType };
}

export async function compressImageFile(file: File): Promise<CompressedImageResult> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error('Please select a valid photo file (JPEG, PNG, or WebP).');
  }

  const img = await loadImageFromFile(file);
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  return drawSourceAndCompress(img, srcWidth, srcHeight);
}

export async function compressVideoFrame(video: HTMLVideoElement): Promise<CompressedImageResult> {
  const srcWidth = video.videoWidth;
  const srcHeight = video.videoHeight;

  if (!srcWidth || !srcHeight) {
    throw new Error('Camera preview is still loading. Please wait a moment and try again.');
  }

  return drawSourceAndCompress(video, srcWidth, srcHeight);
}
