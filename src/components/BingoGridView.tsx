import { useState } from 'react';
import { Camera, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import { resolveMediaUrl } from '../services/api';
import { CHALLENGES, TOTAL_CHALLENGES, type ChallengeDefinition } from '../shared/challenges';
import {
  getParticipantInitials,
  type PhotoSubmissionRecord,
} from '../shared/gameLogic';
import { ChallengeIcon } from './ChallengeIcon';

interface BingoGridViewProps {
  joiningCode: string;
  participantId: string;
  participantName: string;
  submissions: PhotoSubmissionRecord[];
  isExpired: boolean;
  onSelectChallenge: (challenge: ChallengeDefinition) => void;
}

export function BingoGridView({
  joiningCode,
  participantId,
  participantName,
  submissions,
  isExpired,
  onSelectChallenge,
}: BingoGridViewProps) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  const mySubmissionByChallenge = new Map<number, PhotoSubmissionRecord>();
  for (const sub of submissions) {
    if (sub.participantId === participantId) {
      mySubmissionByChallenge.set(sub.challengeId, sub);
    }
  }

  const personalCompleted = mySubmissionByChallenge.size;
  const personalPct = Math.round((personalCompleted / TOTAL_CHALLENGES) * 100);
  const fullBoard = personalCompleted === TOTAL_CHALLENGES;

  const markBroken = (id: string) => {
    setBrokenImages((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Personal Bingo Board Summary Card */}
      <section
        aria-label="Personal Bingo progress"
        className="rounded-2xl sm:rounded-3xl bg-white border border-[#172E4D]/10 px-4 py-3.5 sm:px-5 sm:py-4 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#CFE5D7] text-[#1A5E4B] font-display font-extrabold text-sm flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              {getParticipantInitials(participantName)}
            </div>

            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#218F87] truncate">
                HUMAN BINGO · CODE {joiningCode}
              </p>
              <h1 className="font-display text-base sm:text-lg font-extrabold text-[#172E4D] truncate">
                {participantName}&rsquo;s Board
              </h1>
            </div>
          </div>

          <div className="text-right shrink-0">
            <p
              data-testid="personal-progress-count"
              className="font-mono text-xl sm:text-2xl font-extrabold text-[#172E4D] tabular-nums leading-none"
            >
              {personalCompleted}/{TOTAL_CHALLENGES}
            </p>
            <p className="mt-1 text-[11px] font-bold text-[#218F87] tabular-nums">
              {fullBoard ? 'FULL BINGO!' : `${personalPct}% done`}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <div
            className="h-2.5 w-full rounded-full bg-[#F4F6F8] overflow-hidden"
            role="progressbar"
            aria-valuenow={personalCompleted}
            aria-valuemin={0}
            aria-valuemax={TOTAL_CHALLENGES}
            aria-label="Your personal Bingo board completion"
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${personalPct}%`,
                backgroundColor: fullBoard ? '#F28B78' : '#218F87',
              }}
            />
          </div>
        </div>

        {fullBoard && (
          <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-display font-bold text-[#9E3320]">
            <Sparkles className="w-4 h-4 text-[#F28B78]" aria-hidden="true" />
            <span>Amazing! You completed all 9 Human Bingo challenges.</span>
          </p>
        )}
      </section>

      {/* 3x3 Personal Challenge Cards */}
      <div data-testid="bingo-grid" className="grid grid-cols-3 gap-2 sm:gap-3.5">
        {CHALLENGES.map((challenge) => {
          const mySub = mySubmissionByChallenge.get(challenge.id);

          if (!mySub) {
            // PENDING STATE
            return (
              <button
                key={challenge.id}
                type="button"
                data-testid={`challenge-card-${challenge.id}`}
                onClick={() => onSelectChallenge(challenge)}
                aria-label={`${challenge.numberLabel}. ${challenge.title} — Pending. Tap for camera or gallery upload`}
                style={{
                  backgroundColor: challenge.cardBg,
                  borderColor: challenge.cardBorder,
                }}
                className="group relative flex flex-col justify-between text-left rounded-2xl border p-2 sm:p-4 min-h-[152px] sm:min-h-[192px] transition-transform duration-150 active:scale-[0.97] shadow-xs hover:brightness-[0.98] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172E4D]"
              >
                <div className="flex items-start justify-between gap-1 w-full">
                  <span className="font-mono text-[11px] sm:text-xs font-bold tabular-nums text-[#172E4D]/75">
                    {challenge.numberLabel}
                  </span>

                  <span
                    style={{ backgroundColor: challenge.iconBg, color: challenge.accentText }}
                    className="w-6 h-6 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0 shadow-2xs"
                    aria-hidden="true"
                  >
                    <ChallengeIcon name={challenge.iconName} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </span>
                </div>

                <div className="my-1.5 sm:my-2 min-w-0">
                  <h2 className="font-display text-[11px] sm:text-sm font-extrabold leading-[1.15] text-[#172E4D] uppercase break-words">
                    {challenge.title}
                  </h2>
                  <p className="mt-1 text-[10px] sm:text-xs leading-[1.3] text-[#172E4D]/80 line-clamp-4">
                    {challenge.description}
                  </p>
                </div>

                {/* Camera & Gallery Upload Options Indicator */}
                <div className="pt-1.5 border-t border-[#172E4D]/10 flex items-center justify-between gap-1 w-full text-[9px] sm:text-[11px] font-bold text-[#172E4D]/80">
                  {isExpired ? (
                    <span className="truncate">Ended</span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Camera className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" aria-hidden="true" />
                        <ImageIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 opacity-80" aria-hidden="true" />
                        <span className="hidden sm:inline truncate">Camera / Gallery</span>
                      </span>
                      <span className="font-semibold text-[#172E4D]/70 shrink-0">Add</span>
                    </>
                  )}
                </div>
              </button>
            );
          }

          // COMPLETED STATE (Participant's own uploaded photo)
          const imageBroken = brokenImages.has(mySub.id);

          return (
            <button
              key={challenge.id}
              type="button"
              data-testid={`challenge-card-${challenge.id}`}
              onClick={() => onSelectChallenge(challenge)}
              aria-label={`${challenge.numberLabel}. ${challenge.title} — Completed, tap to view or replace photo`}
              style={{
                backgroundColor: challenge.cardBg,
                borderColor: '#218F87',
              }}
              className="group relative overflow-hidden flex flex-col justify-between text-left rounded-2xl border p-2.5 sm:p-3.5 min-h-[144px] sm:min-h-[192px] ring-2 ring-[#218F87]/55 transition-transform duration-150 active:scale-[0.97] shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172E4D]"
            >
              {!imageBroken && (
                <img
                  src={resolveMediaUrl(mySub.imageUrl)}
                  alt={`${challenge.title} completed by ${participantName}`}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => markBroken(mySub.id)}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              )}

              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-[#172E4D]/92 via-[#172E4D]/30 to-[#172E4D]/55"
              />

              <div className="relative z-10 flex items-start justify-between gap-1 w-full">
                <span className="font-mono text-[11px] sm:text-xs font-bold tabular-nums text-white drop-shadow-xs">
                  {challenge.numberLabel}
                </span>

                <span
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#218F87] text-white flex items-center justify-center shadow-xs shrink-0"
                  title="Completed"
                  aria-hidden="true"
                >
                  <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 stroke-[3]" />
                </span>
              </div>

              <div className="relative z-10 mt-auto pt-4 min-w-0 w-full">
                <h2 className="font-display text-[11px] sm:text-sm font-extrabold leading-[1.15] text-white uppercase break-words drop-shadow-xs">
                  {challenge.title}
                </h2>
                <p className="mt-0.5 text-[10px] sm:text-xs font-semibold text-[#CFE5D7] truncate">
                  Completed
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
