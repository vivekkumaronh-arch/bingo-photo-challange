export interface ScaledDimensions {
  width: number;
  height: number;
}

export function computeScaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDimension: number,
): ScaledDimensions {
  if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
    throw new Error('Unable to read image dimensions.');
  }
  const safeMax = Math.max(1, maxDimension);
  const scale = Math.min(1, safeMax / Math.max(srcWidth, srcHeight));
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}

export interface CameraEnvironmentInfo {
  isSecureContext: boolean;
  hasMediaDevices: boolean;
}

export function buildRearCameraConstraintAttempts(): MediaStreamConstraints[] {
  return [
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    },
    {
      video: {
        facingMode: 'environment',
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];
}

export function mapCameraError(
  error: unknown,
  env: CameraEnvironmentInfo = { isSecureContext: true, hasMediaDevices: true },
): string {
  if (!env.isSecureContext) {
    return 'Camera access requires a secure HTTPS or localhost connection. Please use Choose From Gallery or open this page over HTTPS.';
  }
  if (!env.hasMediaDevices) {
    return 'Camera access is not supported in this browser. Please use Choose From Gallery instead.';
  }

  const name =
    error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
      ? error.name
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera permission was denied. Please allow camera access in your browser settings and try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. You can still upload a photo using Choose From Gallery.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your camera is currently busy or unavailable. Close any other camera app and try again.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'Unable to start a compatible camera on this device.';
    case 'AbortError':
      return 'Camera startup was interrupted. Please tap Take Photo to try again.';
    default:
      if (error instanceof Error && error.message.trim()) {
        return error.message;
      }
      return 'Unable to access the camera right now. Please check permissions and try again.';
  }
}

export function stopMediaStreamTracks(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore track stop failures
    }
  }
}

export async function requestCameraStream(): Promise<MediaStream> {
  const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
  const hasMediaDevices =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  if (!isSecureContext || !hasMediaDevices) {
    throw new Error(mapCameraError(null, { isSecureContext, hasMediaDevices }));
  }

  const attempts = buildRearCameraConstraintAttempts();
  let lastError: unknown = null;

  for (let i = 0; i < attempts.length; i += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia(attempts[i]);
    } catch (err) {
      lastError = err;
      const errName =
        err && typeof err === 'object' && 'name' in err && typeof err.name === 'string'
          ? err.name
          : '';
      // Permission denied or missing hardware shouldn't retry fallback constraints
      if (
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errName === 'SecurityError' ||
        errName === 'NotFoundError' ||
        errName === 'DevicesNotFoundError' ||
        errName === 'NotReadableError' ||
        errName === 'TrackStartError'
      ) {
        break;
      }
    }
  }

  throw new Error(mapCameraError(lastError, { isSecureContext, hasMediaDevices }));
}
