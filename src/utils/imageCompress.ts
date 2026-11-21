import { computeScaledDimensions } from './cameraHelpers';

export interface CompressedImageResult {
  blob: Blob;
  previewUrl: string;
  mimeType: 'image/webp' | 'image/jpeg';
}

export const MAX_UPLOAD_BYTES = Math.floor(3.5 * 1024 * 1024); // Strictly under Vercel's 4.5 MB limit

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

const COMPRESSION_TIERS = [
  { maxDimension: 1200, quality: 0.82 },
  { maxDimension: 1024, quality: 0.72 },
  { maxDimension: 840, quality: 0.62 },
];

export function isSupportedUploadFile(file: Pick<File, 'type' | 'name'>): boolean {
  const normalizedType = (file.type || '').toLowerCase();
  if (normalizedType) {
    return SUPPORTED_MIME_TYPES.has(normalizedType);
  }
  return SUPPORTED_EXTENSIONS.test(file.name);
}

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
      reject(new Error('Could not read the selected image. Please choose a JPEG, PNG, or WebP photo.'));
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
  for (const tier of COMPRESSION_TIERS) {
    const { width: targetWidth, height: targetHeight } = computeScaledDimensions(
      srcWidth,
      srcHeight,
      tier.maxDimension,
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
    let blob = await canvasToBlob(canvas, 'image/webp', tier.quality);
    let mimeType: 'image/webp' | 'image/jpeg' = 'image/webp';

    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/jpeg', tier.quality);
      mimeType = 'image/jpeg';
    }

    if (!blob) {
      throw new Error('Failed to process photo for upload.');
    }

    if (blob.size <= MAX_UPLOAD_BYTES) {
      const previewUrl = URL.createObjectURL(blob);
      return { blob, previewUrl, mimeType };
    }
  }

  throw new Error('Photo exceeds the 3.5 MB upload limit even after compression. Please choose a smaller photo.');
}

export async function compressImageFile(file: File): Promise<CompressedImageResult> {
  if (!isSupportedUploadFile(file)) {
    throw new Error('Unsupported image format. Please choose a JPEG, PNG, or WebP photo.');
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
