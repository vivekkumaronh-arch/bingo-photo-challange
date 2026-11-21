import { useState } from 'react';
import { ArrowLeft, Camera, Check, Clock, Eye, Search, X } from 'lucide-react';
import { resolveMediaUrl } from '../services/api';
import {
  CHALLENGES,
  TOTAL_CHALLENGES,
  getChallengeById,
  type ChallengeDefinition,
} from '../shared/challenges';
import {
  filterParticipantsByName,
  formatRelativeTime,
  getParticipantInitials,
  type ParticipantRecord,
  type PhotoSubmissionRecord,
} from '../shared/gameLogic';
import { ChallengeIcon } from './ChallengeIcon';

interface PlayersViewProps {
  participants: ParticipantRecord[];
  submissions: PhotoSubmissionRecord[];
  currentParticipantId: string;
  isExpired: boolean;
  onSelectOwnChallenge: (challenge: ChallengeDefinition) => void;
}

const AVATAR_COLORS = [
  { bg: '#F9E7AE', text: '#7D5A08' },
  { bg: '#FAD3CA', text: '#9E3320' },
  { bg: '#CFE5D7', text: '#1A5E4B' },
  { bg: '#DCD3F0', text: '#49357B' },
  { bg: '#D5E4F5', text: '#1E4C7A' },
  { bg: '#FBE0C4', text: '#874811' },
];

function avatarStyleForIndex(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function LazyThumb({
  src,
  alt,
  fallbackBg,
}: {
  src: string;
  alt: string;
  fallbackBg: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div
      style={{ backgroundColor: fallbackBg }}
      className="relative w-full aspect-square rounded-md overflow-hidden"
    >
      {!loaded && !failed && (
        <div className="absolute inset-0 bg-[#172E4D]/10 animate-pulse" aria-hidden="true" />
      )}
      {!failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`w-full h-full object-cover block transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}

export function PlayersView({
  participants,
  submissions,
  currentParticipantId,
  isExpired,
  onSelectOwnChallenge,
}: PlayersViewProps) {
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoSubmissionRecord | null>(null);
  const [brokenCards, setBrokenCards] = useState<Set<string>>(new Set());

  const byParticipant = new Map<string, Map<number, PhotoSubmissionRecord>>();
  for (const sub of submissions) {
    let map = byParticipant.get(sub.participantId);
    if (!map) {
      map = new Map<number, PhotoSubmissionRecord>();
      byParticipant.set(sub.participantId, map);
    }
    map.set(sub.challengeId, sub);
  }

  const filteredParticipants = filterParticipantsByName(participants, searchQuery);

  // Sort participants: highest completion count first, tie-breaking by join time
  const sortedParticipants = [...filteredParticipants].sort((a, b) => {
    const aCount = byParticipant.get(a.id)?.size ?? 0;
    const bCount = byParticipant.get(b.id)?.size ?? 0;
    if (bCount !== aCount) return bCount - aCount;
    return a.joinedAt - b.joinedAt;
  });

  const selectedParticipant = selectedParticipantId
    ? participants.find((p) => p.id === selectedParticipantId) ?? null
    : null;

  const markBroken = (id: string) => {
    setBrokenCards((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // INDIVIDUAL PARTICIPANT FULL 9-CARD BOARD VIEW
  if (selectedParticipant) {
    const playerSubs = byParticipant.get(selectedParticipant.id) ?? new Map<number, PhotoSubmissionRecord>();
    const completedCount = playerSubs.size;
    const pct = Math.round((completedCount / TOTAL_CHALLENGES) * 100);
    const isMe = selectedParticipant.id === currentParticipantId;
    const colorIdx = Math.max(0, participants.findIndex((p) => p.id === selectedParticipant.id));
    const avatar = avatarStyleForIndex(colorIdx);

    return (
      <div className="space-y-4" data-testid="participant-detail-view">
        <button
          type="button"
          onClick={() => {
            setSelectedParticipantId(null);
            setLightboxPhoto(null);
          }}
          className="inline-flex items-center gap-2 min-h-[44px] px-3 py-2 -ml-1 rounded-xl text-sm font-bold text-[#172E4D] hover:bg-white transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#218F87]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>All Players</span>
        </button>

        {/* Participant Header Card */}
        <section className="rounded-2xl sm:rounded-3xl bg-white border border-[#172E4D]/10 px-4 py-4 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                style={{ backgroundColor: avatar.bg, color: avatar.text }}
                className="w-11 h-11 rounded-2xl flex items-center justify-center font-display font-extrabold text-sm shrink-0"
                aria-hidden="true"
              >
                {getParticipantInitials(selectedParticipant.name)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#172E4D] truncate">
                    {selectedParticipant.name}
                  </h2>
                  {isMe && <span className="text-xs font-bold text-[#218F87] shrink-0">· You</span>}
                </div>
                <p className="text-xs font-medium text-[#172E4D]/65 inline-flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {isMe
                      ? 'Your Bingo Board · Tap any card to edit'
                      : 'Read-only Bingo Board'}
                  </span>
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <p
                data-testid="participant-detail-score"
                className="font-mono text-lg sm:text-xl font-bold text-[#172E4D] tabular-nums"
              >
                {completedCount}/{TOTAL_CHALLENGES}
              </p>
              <p className="text-[11px] font-semibold text-[#218F87] tabular-nums">{pct}%</p>
            </div>
          </div>

          <div
            className="mt-3 h-2.5 w-full rounded-full bg-[#F4F6F8] overflow-hidden"
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={TOTAL_CHALLENGES}
            aria-label={`${selectedParticipant.name} completion progress`}
          >
            <div
              className="h-full rounded-full bg-[#218F87] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </section>

        {/* Full 3x3 Challenge Grid */}
        <div
          data-testid="participant-detail-grid"
          className="grid grid-cols-3 gap-2 sm:gap-3.5"
        >
          {CHALLENGES.map((challenge) => {
            const sub = playerSubs.get(challenge.id);

            if (!sub) {
              if (isMe && !isExpired) {
                return (
                  <button
                    key={challenge.id}
                    type="button"
                    data-testid={`detail-cell-${challenge.id}`}
                    onClick={() => onSelectOwnChallenge(challenge)}
                    style={{
                      backgroundColor: challenge.cardBg,
                      borderColor: challenge.cardBorder,
                    }}
                    className="flex flex-col justify-between text-left rounded-2xl border p-2.5 sm:p-4 min-h-[136px] sm:min-h-[182px] cursor-pointer active:scale-[0.98] transition-transform focus-visible:outline-2 focus-visible:outline-[#172E4D]"
                  >
                    <div className="flex items-start justify-between gap-1 w-full">
                      <span className="font-mono text-[11px] sm:text-xs font-bold tabular-nums text-[#172E4D]/70">
                        {challenge.numberLabel}
                      </span>
                      <span
                        style={{ backgroundColor: challenge.iconBg, color: challenge.accentText }}
                        className="w-6 h-6 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        <ChallengeIcon name={challenge.iconName} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </span>
                    </div>

                    <div className="my-1.5 sm:my-2 min-w-0">
                      <h3 className="font-display text-[11px] sm:text-sm font-extrabold leading-[1.15] text-[#172E4D] uppercase break-words">
                        {challenge.title}
                      </h3>
                      <p className="mt-1 text-[10px] sm:text-xs leading-snug text-[#172E4D]/75 line-clamp-2 sm:line-clamp-3">
                        {challenge.description}
                      </p>
                    </div>

                    <div className="pt-1 flex items-center gap-1 text-[10px] sm:text-xs font-bold text-[#218F87]">
                      <Camera className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>Add photo</span>
                    </div>
                  </button>
                );
              }

              return (
                <div
                  key={challenge.id}
                  data-testid={`detail-cell-${challenge.id}`}
                  style={{
                    backgroundColor: challenge.cardBg,
                    borderColor: challenge.cardBorder,
                  }}
                  className="flex flex-col justify-between rounded-2xl border p-2.5 sm:p-4 min-h-[136px] sm:min-h-[182px] opacity-90"
                >
                  <div className="flex items-start justify-between gap-1 w-full">
                    <span className="font-mono text-[11px] sm:text-xs font-bold tabular-nums text-[#172E4D]/70">
                      {challenge.numberLabel}
                    </span>
                    <span
                      style={{ backgroundColor: challenge.iconBg, color: challenge.accentText }}
                      className="w-6 h-6 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      <ChallengeIcon name={challenge.iconName} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </span>
                  </div>

                  <div className="my-1.5 sm:my-2 min-w-0">
                    <h3 className="font-display text-[11px] sm:text-sm font-extrabold leading-[1.15] text-[#172E4D] uppercase break-words">
                      {challenge.title}
                    </h3>
                    <p className="mt-1 text-[10px] sm:text-xs leading-snug text-[#172E4D]/75 line-clamp-2 sm:line-clamp-3">
                      {challenge.description}
                    </p>
                  </div>

                  <div className="pt-1 flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-[#172E4D]/65">
                    <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>Pending</span>
                  </div>
                </div>
              );
            }

            const broken = brokenCards.has(sub.id);

            return (
              <button
                key={challenge.id}
                type="button"
                data-testid={`detail-cell-${challenge.id}`}
                onClick={() => (isMe ? onSelectOwnChallenge(challenge) : setLightboxPhoto(sub))}
                aria-label={
                  isMe
                    ? `View or update your photo for ${challenge.numberLabel}. ${challenge.title}`
                    : `View ${selectedParticipant.name}'s photo for ${challenge.numberLabel}. ${challenge.title}`
                }
                style={{ backgroundColor: challenge.cardBg, borderColor: '#218F87' }}
                className="group relative overflow-hidden flex flex-col justify-between text-left rounded-2xl border p-2.5 sm:p-3.5 min-h-[136px] sm:min-h-[182px] shadow-sm cursor-pointer active:scale-[0.98] transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172E4D]"
              >
                {!broken && (
                  <img
                    src={resolveMediaUrl(sub.imageUrl)}
                    alt={`${challenge.title} photo by ${selectedParticipant.name}`}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => markBroken(sub.id)}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                )}

                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-[#172E4D]/92 via-[#172E4D]/30 to-[#172E4D]/55"
                />

                <div className="relative z-10 flex items-start justify-between gap-1 w-full">
                  <span className="font-mono text-[11px] sm:text-xs font-bold tabular-nums text-white">
                    {challenge.numberLabel}
                  </span>
                  <span
                    className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#218F87] text-white flex items-center justify-center shadow-xs shrink-0"
                    aria-hidden="true"
                  >
                    <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 stroke-[3]" />
                  </span>
                </div>

                <div className="relative z-10 mt-auto pt-4 min-w-0 w-full">
                  <h3 className="font-display text-[11px] sm:text-sm font-extrabold leading-[1.15] text-white uppercase break-words drop-shadow-xs">
                    {challenge.title}
                  </h3>
                  <p className="mt-0.5 text-[10px] sm:text-xs font-semibold text-white/90 truncate">
                    {formatRelativeTime(sub.updatedAt || sub.createdAt)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Read-Only Photo Lightbox (for other participants' photos) */}
        {lightboxPhoto && (
          <div
            className="fixed inset-0 z-50 bg-[#172E4D]/85 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Submitted photo details"
            onClick={() => setLightboxPhoto(null)}
          >
            <div
              className="w-full max-w-lg rounded-3xl bg-white overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative bg-[#172E4D]/5">
                <img
                  src={resolveMediaUrl(lightboxPhoto.imageUrl)}
                  alt={`${lightboxPhoto.participantName} challenge photo`}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-[68dvh] object-contain mx-auto block bg-[#172E4D]"
                />
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(null)}
                  aria-label="Close photo preview"
                  className="absolute top-3 right-3 min-w-[44px] min-h-[44px] rounded-full bg-white/90 text-[#172E4D] flex items-center justify-center shadow-md cursor-pointer focus-visible:outline-2 focus-visible:outline-[#218F87]"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              <div className="p-4 sm:p-5">
                <p className="font-display text-base sm:text-lg font-bold text-[#172E4D] truncate">
                  {lightboxPhoto.participantName}
                </p>
                {(() => {
                  const c = getChallengeById(lightboxPhoto.challengeId);
                  return (
                    <>
                      <p className="text-xs sm:text-sm font-semibold text-[#218F87]">
                        {c ? `${c.numberLabel}. ${c.title}` : `Challenge ${lightboxPhoto.challengeId}`}{' '}
                        <span className="font-normal text-[#172E4D]/65">
                          · {formatRelativeTime(lightboxPhoto.updatedAt || lightboxPhoto.createdAt)}
                        </span>
                      </p>
                      {c && <p className="mt-1 text-xs text-[#172E4D]/70">{c.description}</p>}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // PARTICIPANTS DIRECTORY WITH SEARCH & MINIATURE 3x3 GRIDS
  return (
    <div className="space-y-3.5 sm:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-extrabold text-[#172E4D]">
            Players ({participants.length})
          </h1>
          <p className="text-xs sm:text-sm text-[#172E4D]/70">
            Tap any player to view their complete 9-card Bingo board.
          </p>
        </div>

        {/* Participant Name Search Field */}
        <div className="relative w-full sm:w-64">
          <Search
            className="w-4 h-4 text-[#172E4D]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search players by name..."
            aria-label="Search participants by name"
            className="w-full min-h-[44px] pl-10 pr-10 rounded-2xl bg-white border border-[#172E4D]/12 text-sm text-[#172E4D] placeholder:text-[#172E4D]/45 shadow-xs focus:outline-none focus:ring-2 focus:ring-[#218F87]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear participant search"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] rounded-xl flex items-center justify-center text-[#172E4D]/55 hover:text-[#172E4D] cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {sortedParticipants.length === 0 ? (
        <section className="rounded-3xl bg-white border border-[#172E4D]/10 px-6 py-10 text-center shadow-xs">
          <p className="font-display text-base font-bold text-[#172E4D]">
            No players found matching &ldquo;{searchQuery.trim()}&rdquo;
          </p>
          <p className="mt-1 text-xs sm:text-sm text-[#172E4D]/65">
            Try a different spelling or clear the search field.
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="mt-4 min-h-[44px] px-5 py-2 rounded-2xl bg-[#CFE5D7] hover:bg-[#BEDBC9] text-sm font-bold text-[#1A5E4B] cursor-pointer transition-colors"
          >
            Clear search
          </button>
        </section>
      ) : (
        <div
          data-testid="players-grid"
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4"
        >
          {sortedParticipants.map((p) => {
            const pSubs = byParticipant.get(p.id) ?? new Map<number, PhotoSubmissionRecord>();
            const completed = pSubs.size;
            const pct = Math.round((completed / TOTAL_CHALLENGES) * 100);
            const isMe = p.id === currentParticipantId;
            const originalIndex = Math.max(0, participants.findIndex((item) => item.id === p.id));
            const avatar = avatarStyleForIndex(originalIndex);

            return (
              <button
                key={p.id}
                type="button"
                data-testid={`player-card-${p.id}`}
                onClick={() => setSelectedParticipantId(p.id)}
                aria-label={`Open ${p.name}'s Bingo grid (${completed} of ${TOTAL_CHALLENGES} completed)`}
                className={`text-left rounded-2xl bg-white border p-2.5 sm:p-3.5 shadow-xs hover:shadow-md active:scale-[0.98] transition-all flex flex-col justify-between gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#218F87] ${
                  isMe ? 'border-[#218F87] ring-1 ring-[#218F87]/35' : 'border-[#172E4D]/10'
                }`}
              >
                <div className="space-y-2.5 w-full">
                  {/* Header: Avatar + Name + Completion Count */}
                  <div className="flex items-center gap-2 min-w-0 w-full">
                    <div
                      style={{ backgroundColor: avatar.bg, color: avatar.text }}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center font-display font-extrabold text-xs shrink-0"
                      aria-hidden="true"
                    >
                      {getParticipantInitials(p.name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs sm:text-sm font-bold text-[#172E4D] truncate">
                          {p.name}
                        </p>
                        <span className="font-mono text-[11px] sm:text-xs font-bold text-[#218F87] tabular-nums shrink-0">
                          {completed}/{TOTAL_CHALLENGES}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-[#F4F6F8] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: completed === TOTAL_CHALLENGES ? '#F28B78' : '#218F87',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Miniature 3x3 Bingo Grid */}
                  <div
                    data-testid={`mini-grid-${p.id}`}
                    className="grid grid-cols-3 gap-1 w-full"
                  >
                    {CHALLENGES.map((challenge) => {
                      const sub = pSubs.get(challenge.id);
                      if (!sub) {
                        return (
                          <div
                            key={challenge.id}
                            style={{ backgroundColor: challenge.cardBg }}
                            className="aspect-square rounded-md flex items-center justify-center border border-[#172E4D]/8"
                          >
                            <span className="font-mono text-[9px] font-bold text-[#172E4D]/55 tabular-nums">
                              {challenge.numberLabel}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div key={challenge.id} className="relative aspect-square rounded-md overflow-hidden">
                          <LazyThumb
                            src={resolveMediaUrl(sub.imageUrl)}
                            alt={`${p.name} — ${challenge.title}`}
                            fallbackBg={challenge.cardBg}
                          />
                          <span
                            className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-[#218F87] text-white flex items-center justify-center shadow-xs"
                            aria-hidden="true"
                          >
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <p
                  className={`text-[10px] font-bold ${
                    isMe ? 'text-[#218F87]' : 'text-[#172E4D]/50'
                  }`}
                >
                  {isMe ? 'Your Board · Tap to open' : 'Tap to view board'}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
