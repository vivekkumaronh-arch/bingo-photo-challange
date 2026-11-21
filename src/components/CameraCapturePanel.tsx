import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, Loader2, RefreshCw, X } from 'lucide-react';
import {
  mapCameraError,
  requestCameraStream,
  stopMediaStreamTracks,
} from '../utils/cameraHelpers';
import { compressVideoFrame, type CompressedImageResult } from '../utils/imageCompress';

interface CameraCapturePanelProps {
  challengeTitle: string;
  onCaptured: (result: CompressedImageResult) => void;
  onCancel: () => void;
}

type CameraStatus = 'requesting' | 'live' | 'error';

export function CameraCapturePanel({
  challengeTitle,
  onCaptured,
  onCancel,
}: CameraCapturePanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<CameraStatus>('requesting');
  const [videoReady, setVideoReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    stopMediaStreamTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopStream();
    setStatus('requesting');
    setVideoReady(false);
    setErrorMessage(null);

    try {
      const stream = await requestCameraStream();
      if (!mountedRef.current) {
        stopMediaStreamTracks(stream);
        return;
      }

      streamRef.current = stream;

      for (const track of stream.getVideoTracks()) {
        track.onended = () => {
          if (!mountedRef.current) return;
          setErrorMessage('Camera connection ended unexpectedly. Tap Retry Camera to reopen.');
          setStatus('error');
          setVideoReady(false);
        };
      }

      setStatus('live');
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMessage(
        err instanceof Error
          ? err.message
          : mapCameraError(err, {
              isSecureContext: window.isSecureContext,
              hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
            }),
      );
      setStatus('error');
    }
  }, [stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    startCamera();
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [startCamera, stopStream]);

  useEffect(() => {
    if (status !== 'live') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;

    const handleReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoReady(true);
      }
    };

    video.addEventListener('loadedmetadata', handleReady);
    video.addEventListener('canplay', handleReady);
    video.addEventListener('playing', handleReady);

    video.play().catch(() => {
      // Autoplay fallback handled by user interaction or metadata event
    });
    handleReady();

    return () => {
      video.removeEventListener('loadedmetadata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('playing', handleReady);
    };
  }, [status]);

  const handleCapture = async () => {
    if (!videoRef.current || capturing) return;
    setCapturing(true);
    setErrorMessage(null);

    try {
      const captured = await compressVideoFrame(videoRef.current);
      stopStream();
      onCaptured(captured);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to capture photo. Please try again.',
      );
    } finally {
      if (mountedRef.current) {
        setCapturing(false);
      }
    }
  };

  const handleCancel = () => {
    stopStream();
    onCancel();
  };

  return (
    <div data-testid="camera-capture-panel" className="space-y-3.5">
      {status === 'requesting' && (
        <div className="rounded-2xl bg-[#172E4D] text-white aspect-[4/3] flex flex-col items-center justify-center p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#CFE5D7]" aria-hidden="true" />
          <p className="mt-3 font-display text-base font-bold">Requesting camera access...</p>
          <p className="mt-1 text-xs text-white/75">
            Allow camera permission when prompted to capture {challengeTitle}.
          </p>
        </div>
      )}

      {status === 'live' && (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-[#172E4D] border border-[#172E4D]/15">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              data-testid="camera-video-preview"
              aria-label={`Live camera preview for ${challengeTitle}`}
              className="w-full aspect-[4/3] object-cover block bg-[#172E4D]"
            />

            <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-[#172E4D]/80 backdrop-blur-xs px-2.5 py-1 text-[11px] font-bold text-white">
              <span className="w-2 h-2 rounded-full bg-[#218F87] animate-pulse" aria-hidden="true" />
              <span>LIVE CAMERA</span>
            </div>

            {!videoReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#172E4D]/75 text-white">
                <Loader2 className="w-6 h-6 animate-spin text-[#CFE5D7]" aria-hidden="true" />
                <span className="mt-2 text-xs font-semibold">Starting camera preview...</span>
              </div>
            )}
          </div>

          {errorMessage && (
            <div
              role="alert"
              data-testid="camera-error-message"
              className="rounded-2xl bg-[#FAD3CA] border border-[#F28B78] px-4 py-3 text-sm font-medium text-[#172E4D]"
            >
              {errorMessage}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2.5">
            <button
              type="button"
              data-testid="capture-photo-btn"
              onClick={handleCapture}
              disabled={!videoReady || capturing}
              className="w-full min-h-[52px] px-5 py-3 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] disabled:opacity-60 text-white font-display font-bold text-base flex items-center justify-center gap-2.5 shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              {capturing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>Capturing...</span>
                </>
              ) : (
                <>
                  <Camera className="w-5 h-5" aria-hidden="true" />
                  <span>CAPTURE PHOTO</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="cancel-camera-btn"
              onClick={handleCancel}
              disabled={capturing}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#F4F6F8] hover:bg-[#E7EBEF] text-[#172E4D] font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              <span>Cancel Camera</span>
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-3">
          <div
            role="alert"
            data-testid="camera-error-message"
            className="rounded-2xl bg-[#FAD3CA]/70 border border-[#F28B78] p-4 flex items-start gap-3 text-left"
          >
            <AlertCircle className="w-5 h-5 text-[#9E3320] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-display text-sm font-extrabold text-[#172E4D]">
                Camera Unavailable
              </p>
              <p className="text-sm text-[#172E4D]/85 leading-relaxed">
                {errorMessage || 'Unable to access camera.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <button
              type="button"
              data-testid="retry-camera-btn"
              onClick={startCamera}
              className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] text-white font-display font-bold text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>TRY CAMERA AGAIN</span>
            </button>

            <button
              type="button"
              data-testid="cancel-camera-btn"
              onClick={handleCancel}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#F4F6F8] hover:bg-[#E7EBEF] text-[#172E4D] font-semibold text-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
            >
              Back to Upload Options
            </button>
          </div>
        </div>
      )}

      {status === 'requesting' && (
        <button
          type="button"
          data-testid="cancel-camera-btn"
          onClick={handleCancel}
          className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#F4F6F8] hover:bg-[#E7EBEF] text-[#172E4D] font-semibold text-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
