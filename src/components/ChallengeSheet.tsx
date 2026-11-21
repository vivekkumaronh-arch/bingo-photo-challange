import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Grid3X3,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { resolveMediaUrl } from '../services/api';
import type { ChallengeDefinition } from '../shared/challenges';
import { formatRelativeTime, type PhotoSubmissionRecord } from '../shared/gameLogic';
import { compressImageFile, type CompressedImageResult } from '../utils/imageCompress';
import { CameraCapturePanel } from './CameraCapturePanel';
import { ChallengeIcon } from './ChallengeIcon';

interface ChallengeSheetProps {
  challenge: ChallengeDefinition | null;
  mySubmission: PhotoSubmissionRecord | undefined;
  isExpired: boolean;
  onClose: () => void;
  onViewMyGrid: () => void;
  onConfirmUpload: (challengeId: number, blob: Blob) => Promise<void>;
}

type CaptureSource = 'camera' | 'gallery' | null;

export function ChallengeSheet({
  challenge,
  mySubmission,
  isExpired,
  onClose,
  onViewMyGrid,
  onConfirmUpload,
}: ChallengeSheetProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [captureSource, setCaptureSource] = useState<CaptureSource>(null);
  const [pendingImage, setPendingImage] = useState<CompressedImageResult | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setCameraOpen(false);
    setCaptureSource(null);
    setError(null);
    setPreparing(false);
    setUploading(false);
    setSubmittedSuccess(false);
  }, [challenge?.id]);

  useEffect(() => {
    if (!challenge) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [challenge, uploading, onClose]);

  if (!challenge) return null;

  const handleGalleryFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setSubmittedSuccess(false);
    setCameraOpen(false);
    setPreparing(true);
    try {
      const compressed = await compressImageFile(file);
      setPendingImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return compressed;
      });
      setCaptureSource('gallery');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process this photo.');
    } finally {
      setPreparing(false);
    }
  };

  const handleCameraCaptured = (result: CompressedImageResult) => {
    setCameraOpen(false);
    setError(null);
    setSubmittedSuccess(false);
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return result;
    });
    setCaptureSource('camera');
  };

  const handleOpenCamera = () => {
    setError(null);
    setSubmittedSuccess(false);
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setCaptureSource(null);
    setCameraOpen(true);
  };

  const handleRetake = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
    setError(null);
    setCaptureSource(null);
    setCameraOpen(true);
  };

  const handleConfirm = async () => {
    if (!pendingImage) return;
    setError(null);
    setUploading(true);
    try {
      await onConfirmUpload(challenge.id, pendingImage.blob);
      URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage(null);
      setCaptureSource(null);
      setSubmittedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDiscardPreview = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
    setCaptureSource(null);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#172E4D]/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-sheet-title"
      onClick={() => {
        if (!uploading) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle (Mobile) */}
        <div className="pt-3 pb-1 flex justify-center sm:hidden">
          <div className="w-10 h-1.5 rounded-full bg-[#172E4D]/15" />
        </div>

        {/* Pastel Challenge Header */}
        <div
          style={{ backgroundColor: challenge.cardBg }}
          className="px-5 py-4 flex items-start justify-between gap-3 border-b border-[#172E4D]/10"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              style={{ backgroundColor: challenge.iconBg, color: challenge.accentText }}
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-xs"
            >
              <ChallengeIcon name={challenge.iconName} className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#172E4D]/70">
                <span className="font-mono tabular-nums">Challenge {challenge.numberLabel}</span>
                {mySubmission && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-[#218F87]">
                      <Check className="w-3.5 h-3.5 stroke-[3]" aria-hidden="true" />
                      Completed
                    </span>
                  </>
                )}
              </div>
              <h2
                id="challenge-sheet-title"
                className="font-display text-lg sm:text-xl font-extrabold text-[#172E4D] leading-tight mt-0.5"
              >
                {challenge.title}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            aria-label="Close challenge details"
            className="min-w-[44px] min-h-[44px] -mr-2 -mt-1 rounded-full flex items-center justify-center text-[#172E4D]/70 hover:text-[#172E4D] hover:bg-white/50 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {submittedSuccess ? (
            <div
              data-testid="upload-success-panel"
              role="status"
              className="space-y-4 text-center py-2"
            >
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#CFE5D7] text-[#218F87] flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
              </div>

              <div>
                <h3 className="font-display text-xl font-extrabold text-[#172E4D]">
                  Photo submitted successfully!
                </h3>
                <p className="mt-1 text-sm text-[#172E4D]/75">
                  Saved to Challenge {challenge.numberLabel}. {challenge.title}
                </p>
              </div>

              {mySubmission && (
                <div className="rounded-2xl overflow-hidden bg-[#F4F6F8] border border-[#172E4D]/10 max-w-xs mx-auto">
                  <img
                    src={resolveMediaUrl(mySubmission.imageUrl)}
                    alt={`${challenge.title} submitted photo`}
                    referrerPolicy="no-referrer"
                    className="w-full h-44 object-cover block"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onViewMyGrid}
                  className="w-full min-h-[52px] px-5 py-3 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] text-white font-display font-bold text-base flex items-center justify-center gap-2 shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                >
                  <Grid3X3 className="w-5 h-5" aria-hidden="true" />
                  <span>VIEW MY BINGO GRID</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full min-h-[48px] px-5 py-2.5 rounded-2xl bg-[#F4F6F8] hover:bg-[#E7EBEF] active:scale-[0.98] text-[#172E4D] font-display font-bold text-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                >
                  CONTINUE PLAYING
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm sm:text-base text-[#172E4D]/85 leading-relaxed">
                {challenge.description}
              </p>

              {/* Dedicated Gallery Picker Input (Separate from Live Camera) */}
              <input
                ref={galleryInputRef}
                data-testid="gallery-file-input"
                type="file"
                accept="image/*"
                onChange={handleGalleryFileChange}
                className="hidden"
                aria-label="Choose photo from gallery"
              />

              {cameraOpen ? (
                <CameraCapturePanel
                  challengeTitle={challenge.title}
                  onCaptured={handleCameraCaptured}
                  onCancel={() => setCameraOpen(false)}
                />
              ) : pendingImage ? (
                <div data-testid="photo-preview-panel" className="space-y-3">
                  <div className="rounded-2xl overflow-hidden bg-[#F5F6F8] border border-[#172E4D]/10">
                    <img
                      src={pendingImage.previewUrl}
                      alt="Captured challenge photo preview"
                      className="w-full max-h-64 object-cover block"
                    />
                  </div>

                  {mySubmission && (
                    <p className="text-xs font-semibold text-[#172E4D]/70 text-center">
                      Uploading this photo will replace your previous submission.
                    </p>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="rounded-2xl bg-[#FAD3CA] border border-[#F28B78] px-4 py-3 text-sm font-medium text-[#172E4D]"
                    >
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2.5">
                    <button
                      type="button"
                      data-testid="confirm-upload-btn"
                      onClick={handleConfirm}
                      disabled={uploading}
                      className="w-full min-h-[52px] px-5 py-3 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] disabled:opacity-60 text-white font-display font-bold text-base flex items-center justify-center gap-2 shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                          <span>Uploading photo...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-5 h-5" aria-hidden="true" />
                          <span>CONFIRM &amp; UPLOAD</span>
                        </>
                      )}
                    </button>

                    {captureSource === 'camera' ? (
                      <button
                        type="button"
                        data-testid="retake-photo-btn"
                        onClick={handleRetake}
                        disabled={uploading}
                        className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#F5F6F8] hover:bg-[#E9ECF0] text-[#172E4D] font-bold text-sm flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                      >
                        <RotateCcw className="w-4 h-4" aria-hidden="true" />
                        <span>RETAKE</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDiscardPreview}
                        disabled={uploading}
                        className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#F5F6F8] hover:bg-[#E9ECF0] text-[#172E4D] font-semibold text-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                      >
                        Choose Another Photo
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Personal Photo Section ONLY (Never shows other participants' photos) */}
                  <div data-testid="personal-submission-section" className="space-y-2">
                    {mySubmission ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#218F87]">
                            YOUR SUBMITTED PHOTO
                          </h3>
                          <span className="text-[11px] font-medium text-[#172E4D]/60">
                            {formatRelativeTime(mySubmission.updatedAt || mySubmission.createdAt)}
                          </span>
                        </div>

                        <div className="rounded-2xl bg-[#F5F6F8] border border-[#218F87]/35 overflow-hidden">
                          <img
                            src={resolveMediaUrl(mySubmission.imageUrl)}
                            alt={`Your submitted photo for ${challenge.title}`}
                            referrerPolicy="no-referrer"
                            className="w-full max-h-56 object-cover block bg-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <div
                        data-testid="personal-empty-photo-state"
                        className="rounded-2xl bg-[#F5F6F8] border border-dashed border-[#172E4D]/20 px-4 py-5 text-center"
                      >
                        <p className="font-display text-xs font-extrabold uppercase tracking-wider text-[#172E4D]/70">
                          YOU HAVEN&rsquo;T UPLOADED A PHOTO YET
                        </p>
                        <p className="mt-1 text-xs text-[#172E4D]/60">
                          Take a live photo or choose one from your gallery to complete this challenge.
                        </p>
                      </div>
                    )}
                  </div>

                  {preparing && (
                    <div className="flex items-center justify-center gap-2 py-2 text-sm font-semibold text-[#218F87]">
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>Optimising photo...</span>
                    </div>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="rounded-2xl bg-[#FAD3CA] border border-[#F28B78] px-4 py-3 text-sm font-medium text-[#172E4D]"
                    >
                      {error}
                    </div>
                  )}

                  {isExpired ? (
                    <div className="rounded-2xl bg-[#F5D98B]/40 border border-[#EBD182] px-4 py-3 text-sm font-medium text-[#172E4D]">
                      This 48-hour game has ended. Photos are preserved, and new uploads are closed.
                    </div>
                  ) : (
                    <div className="space-y-2.5 pb-safe pt-2 border-t border-[#172E4D]/10">
                      <p className="text-xs font-semibold text-[#172E4D]/75 flex items-center gap-1.5">
                        {mySubmission ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 text-[#218F87]" aria-hidden="true" />
                            <span>Replace your submitted photo:</span>
                          </>
                        ) : (
                          <span>Submit your photo for this challenge:</span>
                        )}
                      </p>

                      <button
                        type="button"
                        data-testid="take-photo-btn"
                        onClick={handleOpenCamera}
                        disabled={preparing}
                        className="w-full min-h-[50px] px-5 py-3 rounded-2xl bg-[#218F87] hover:bg-[#1B7871] active:scale-[0.98] disabled:opacity-60 text-white font-display font-bold text-base flex items-center justify-center gap-2.5 shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                      >
                        <Camera className="w-5 h-5" aria-hidden="true" />
                        <span>TAKE PHOTO</span>
                      </button>

                      <button
                        type="button"
                        data-testid="choose-gallery-btn"
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={preparing}
                        className="w-full min-h-[50px] px-5 py-3 rounded-2xl bg-[#D5E4F5] hover:bg-[#C3D8F0] active:scale-[0.98] disabled:opacity-60 text-[#172E4D] font-display font-bold text-base flex items-center justify-center gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                      >
                        <ImageIcon className="w-5 h-5" aria-hidden="true" />
                        <span>CHOOSE FROM GALLERY</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
